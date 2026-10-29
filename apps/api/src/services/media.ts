import { MEDIA_CONTENT_TYPE } from "@menucito/shared";
import { createMediaStorage, keyFromPublicPath, type MediaStorage, type StoredObject } from "../storage/media";
import { DomainError } from "./errors";

export class MediaNotFoundError extends DomainError {
  readonly code = "NOT_FOUND";
  constructor() {
    super("Media not found");
  }
}

/**
 * Only keys written by the logo and catalog services are public:
 * `logos/<restaurantId>/<random>.webp` and `products/<restaurantId>/<random>.webp`.
 */
const PUBLIC_KEY_PATTERN = /^(logos|products)\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.webp$/;

export function createMediaService(storage: MediaStorage) {
  return {
    /**
     * Public read of the object behind `path` (e.g. `/api/media/logos/<id>/<random>.webp`).
     * Throws `MediaNotFoundError` for unknown or non-public keys.
     */
    async read(path: string): Promise<StoredObject & { contentType: string }> {
      const key = keyFromPublicPath(path);
      if (!key || !PUBLIC_KEY_PATTERN.test(key)) throw new MediaNotFoundError();
      const object = await storage.get(key);
      if (!object) throw new MediaNotFoundError();
      // Everything public is stored as WebP; never trust anything else as a content type.
      return { ...object, contentType: MEDIA_CONTENT_TYPE };
    },
  };
}

export type MediaService = ReturnType<typeof createMediaService>;

export function mediaServiceFor(bucket: R2Bucket): MediaService {
  return createMediaService(createMediaStorage(bucket));
}
