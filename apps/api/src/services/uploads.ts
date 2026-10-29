import { MEDIA_CONTENT_TYPE } from "@menucito/shared";
import { keyFromPublicPath, type MediaStorage } from "../storage/media";
import { DomainError } from "./errors";

export class FileTooLargeError extends DomainError {
  readonly code = "FILE_TOO_LARGE";
  /** `subject` names the file in the message, e.g. "logo" or "photo". */
  constructor(subject: string, maxBytes: number) {
    super(`The ${subject} must be at most ${maxBytes} bytes`);
  }
}

export class UnsupportedMediaTypeError extends DomainError {
  readonly code = "UNSUPPORTED_MEDIA_TYPE";
  constructor(message: string) {
    super(message);
  }
}

/** An uploaded image, as received by the route (already read from the multipart body). */
export interface ImageUpload {
  bytes: ArrayBuffer;
  contentType: string;
}

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/** True when the bytes start with the WebP container signature `RIFF....WEBP`. */
export function hasWebpSignature(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
}

/**
 * Accepts only a WebP of at most `maxBytes`, declared as `image/webp` and with the WebP signature.
 * Throws `FileTooLargeError` or `UnsupportedMediaTypeError`.
 */
export function assertWebpUpload(upload: ImageUpload, subject: string, maxBytes: number): void {
  if (upload.bytes.byteLength > maxBytes) throw new FileTooLargeError(subject, maxBytes);
  const mime = upload.contentType.split(";")[0]?.trim().toLowerCase();
  if (mime !== MEDIA_CONTENT_TYPE || !hasWebpSignature(upload.bytes)) {
    throw new UnsupportedMediaTypeError(`The ${subject} must be a WebP image`);
  }
}

/**
 * Deletes the object behind a public media path. Best effort: an orphan object is cheaper than
 * failing a request that already succeeded, so failures are logged under `scope`, not raised.
 */
export async function deleteMediaQuietly(storage: MediaStorage, publicPath: string | null, scope: string) {
  const key = publicPath ? keyFromPublicPath(publicPath) : null;
  if (!key) return;
  try {
    await storage.delete(key);
  } catch (error) {
    console.error(`[${scope}] could not delete object`, key, error);
  }
}
