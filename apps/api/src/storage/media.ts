/** A stored object as read back from the media bucket. */
export interface StoredObject {
  body: ReadableStream;
  contentType: string | undefined;
  size: number;
  etag: string;
}

/**
 * Media bucket access (Cloudflare R2). Only services use it; routes never touch storage directly.
 */
export interface MediaStorage {
  put(key: string, body: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export function createMediaStorage(bucket: R2Bucket): MediaStorage {
  return {
    async put(key, body, contentType) {
      await bucket.put(key, body, { httpMetadata: { contentType } });
    },

    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        body: object.body,
        contentType: object.httpMetadata?.contentType,
        size: object.size,
        etag: object.httpEtag,
      };
    },

    async delete(key) {
      await bucket.delete(key);
    },
  };
}

/** Public route that serves the bucket (see `GET /api/media/*`). */
export const MEDIA_PUBLIC_PREFIX = "/api/media/";

/** `logos/a/b.webp` -> `/api/media/logos/a/b.webp`. */
export function publicPathFor(key: string): string {
  return `${MEDIA_PUBLIC_PREFIX}${key}`;
}

/** Inverse of `publicPathFor`; `null` when the path is not served by the media route. */
export function keyFromPublicPath(path: string): string | null {
  return path.startsWith(MEDIA_PUBLIC_PREFIX) ? path.slice(MEDIA_PUBLIC_PREFIX.length) : null;
}
