import { DrizzleQueryError } from "drizzle-orm";
import type { Context, ErrorHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { ApiErrorBody } from "@menucito/shared";
import type { AppEnv } from "../env";
import { DomainError } from "../services/errors";
import { FileTooLargeError } from "../services/uploads";

/** Shared HTTP plumbing of the JSON routers: error bodies, domain error mapping, bodies and uploads. */

export function errorResponse(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
) {
  return c.json<ApiErrorBody>({ error: { code, message, ...details } }, status);
}

/** HTTP status of each domain error code. Unknown codes answer 400. */
const STATUS_BY_CODE: Readonly<Record<string, ContentfulStatusCode>> = {
  PLAN_LIMIT: 403,
  PLAN_FEATURE: 403,
  PLAN_SWITCH_DISABLED: 403,
  FORBIDDEN: 403,
  MEMBER_INACTIVE: 403,
  OWNER_ONLY: 403,
  RESTAURANT_NOT_FOUND: 404,
  CATEGORY_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  PLACE_NOT_FOUND: 404,
  MEMBER_NOT_FOUND: 404,
  ROLE_NOT_FOUND: 404,
  SLUG_TAKEN: 409,
  ALREADY_HAS_RESTAURANT: 409,
  CATEGORY_NAME_TAKEN: 409,
  CATEGORY_NOT_EMPTY: 409,
  EMAIL_IN_USE: 409,
  OWNER_IMMUTABLE: 409,
  SYSTEM_ROLE: 409,
  ROLE_IN_USE: 409,
  ROLE_NAME_TAKEN: 409,
  STORE_PAUSED: 409,
  STORE_CLOSED: 409,
  BELOW_MINIMUM: 409,
  PAYMENT_METHOD_NOT_ACCEPTED: 409,
  FULFILLMENT_NOT_OFFERED: 409,
  PRODUCT_UNAVAILABLE: 409,
  PRICE_CHANGED: 409,
  INVALID_TRANSITION: 409,
  COURIER_REQUIRED: 409,
  CONCURRENT_MODIFICATION: 409,
  MEMBER_HAS_HISTORY: 409,
  NOT_A_COURIER: 403,
  DELIVERY_ZONES_DISABLED: 409,
  DELIVERY_LOCATION_REQUIRED: 409,
  FILE_TOO_LARGE: 413,
  BODY_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_ERROR: 422,
  EXPORT_TOO_LARGE: 422,
  OUT_OF_COVERAGE: 422,
  TOO_MANY_ORDERS: 429,
  RATE_LIMITED: 429,
  ORDER_NUMBER_CONFLICT: 503,
  MAPS_UNAVAILABLE: 503,
};

export function statusFor(error: DomainError): ContentfulStatusCode {
  return STATUS_BY_CODE[error.code] ?? 400;
}

export interface SafeErrorSummary {
  name: string;
  message: string | null;
  stack: string[];
}

/**
 * What may be logged about an unexpected error. A `DrizzleQueryError` message (and so its stack
 * header) embeds the bound params, which carry customer data, so only the driver's cause message
 * is kept; stacks are reduced to their frames.
 */
export function safeErrorSummary(error: unknown): SafeErrorSummary {
  if (!(error instanceof Error)) return { name: typeof error, message: null, stack: [] };
  const isQueryError = error instanceof DrizzleQueryError;
  const message = isQueryError ? (error.cause instanceof Error ? error.cause.message : null) : error.message;
  const stack = (error.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
  // Drizzle does not set `name`, so it would log as a plain "Error".
  return { name: isQueryError ? "DrizzleQueryError" : error.name, message, stack };
}

/** `onError` handler: domain errors become `{error}` bodies, anything else is logged as a 500. */
export function domainErrorHandler(scope: string): ErrorHandler<AppEnv> {
  return (error, c) => {
    if (error instanceof DomainError) return errorResponse(c, statusFor(error), error.code, error.message, error.details);
    console.error(`[${scope}] unexpected error`, safeErrorSummary(error));
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

/** Parses the query string with `schema`; a mismatch is a 422 naming the first invalid parameter. */
export function parseQuery<T extends z.ZodType>(
  c: Context<AppEnv>,
  schema: T,
): { data: z.infer<T> } | { response: Response } {
  const parsed = schema.safeParse(c.req.query());
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

/** Rejects JSON request bodies exceeding `maxBytes` (413 `BODY_TOO_LARGE`). */
export function orderBodyLimit(maxBytes: number) {
  return bodyLimit({
    maxSize: maxBytes,
    onError: (c) => {
      return errorResponse(c as Context<AppEnv>, 413, "BODY_TOO_LARGE", "El cuerpo del pedido supera el límite permitido");
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
