import type { Context, ErrorHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { ApiErrorBody } from "@menucito/shared";
import type { AppEnv } from "../env";
import { DomainError } from "../services/errors";
import { FileTooLargeError } from "../services/uploads";

/** Shared HTTP plumbing of the JSON routers: error bodies, domain error mapping, bodies and uploads. */

export function errorResponse(c: Context<AppEnv>, status: ContentfulStatusCode, code: string, message: string) {
  return c.json<ApiErrorBody>({ error: { code, message } }, status);
}

/** HTTP status of each domain error code. Unknown codes answer 400. */
const STATUS_BY_CODE: Readonly<Record<string, ContentfulStatusCode>> = {
  PLAN_LIMIT: 403,
  PLAN_SWITCH_DISABLED: 403,
  RESTAURANT_NOT_FOUND: 404,
  CATEGORY_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  SLUG_TAKEN: 409,
  ALREADY_HAS_RESTAURANT: 409,
  CATEGORY_NAME_TAKEN: 409,
  CATEGORY_NOT_EMPTY: 409,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_ERROR: 422,
};

export function statusFor(error: DomainError): ContentfulStatusCode {
  return STATUS_BY_CODE[error.code] ?? 400;
}

/** `onError` handler: domain errors become `{error}` bodies, anything else is logged as a 500. */
export function domainErrorHandler(scope: string): ErrorHandler<AppEnv> {
  return (error, c) => {
    if (error instanceof DomainError) return errorResponse(c, statusFor(error), error.code, error.message);
    console.error(`[${scope}] unexpected error`, error);
    return errorResponse(c, 500, "INTERNAL_ERROR", "Unexpected error");
  };
}

/** 422 `VALIDATION_ERROR` naming the first invalid field. */
export function validationErrorResponse(c: Context<AppEnv>, error: z.ZodError) {
  const first = error.issues[0];
  const message = first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid input";
  return errorResponse(c, 422, "VALIDATION_ERROR", message);
}

/** Parses the JSON body with `schema`. A malformed body is validated as `undefined` (so it is a 422). */
export async function parseJsonBody<T extends z.ZodType>(
  c: Context<AppEnv>,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  return parsed.success ? { data: parsed.data } : { response: validationErrorResponse(c, parsed.error) };
}

/** Room for the multipart envelope; the exact file size limit is a service rule. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

/** Rejects oversized upload bodies (413 `FILE_TOO_LARGE`) before reading them into memory. */
export function uploadBodyLimit(subject: string, maxBytes: number) {
  return bodyLimit({
    maxSize: maxBytes + MULTIPART_OVERHEAD_BYTES,
    onError: (c) => {
      const error = new FileTooLargeError(subject, maxBytes);
      return errorResponse(c as Context<AppEnv>, 413, error.code, error.message);
    },
  });
}

/**
 * Reads the `file` field of a multipart body: the file, or the error response to return
 * (415 when the body is not multipart, 422 when the field is missing).
 */
export async function readUploadedFile(
  c: Context<AppEnv>,
  subject: string,
): Promise<{ file: File } | { response: Response }> {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return { response: errorResponse(c, 415, "UNSUPPORTED_MEDIA_TYPE", `Send the ${subject} as multipart/form-data`) };
  }
  const form = await c.req.parseBody().catch(() => null);
  const file = form?.file;
  if (!(file instanceof File)) return { response: errorResponse(c, 422, "VALIDATION_ERROR", "file: a file is required") };
  return { file };
}
