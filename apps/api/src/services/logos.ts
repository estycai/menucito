import { LOGO_CONTENT_TYPE, LOGO_MAX_BYTES, type LogoUploadResult } from "@menucito/shared";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { createMediaStorage, keyFromPublicPath, publicPathFor, type MediaStorage } from "../storage/media";
import { DomainError, RestaurantNotFoundError } from "./restaurants";

export class LogoTooLargeError extends DomainError {
  readonly code = "FILE_TOO_LARGE";
  constructor() {
    super(`The logo must be at most ${LOGO_MAX_BYTES} bytes`);
  }
}

export class UnsupportedLogoTypeError extends DomainError {
  readonly code = "UNSUPPORTED_MEDIA_TYPE";
  constructor() {
    super("The logo must be a WebP image");
  }
}

/** The uploaded logo, as received by the route (already read from the multipart body). */
export interface LogoUpload {
  bytes: ArrayBuffer;
  contentType: string;
}

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/** True when the bytes start with the WebP container signature `RIFF....WEBP`. */
export function hasWebpSignature(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
}

function validate(upload: LogoUpload) {
  if (upload.bytes.byteLength > LOGO_MAX_BYTES) throw new LogoTooLargeError();
  const mime = upload.contentType.split(";")[0]?.trim().toLowerCase();
  if (mime !== LOGO_CONTENT_TYPE || !hasWebpSignature(upload.bytes)) throw new UnsupportedLogoTypeError();
}

/**
 * Logo of the owner's restaurant. Available on every plan: this service deliberately never reads
 * `restaurants.plan`.
 */
export function createLogoService(repository: RestaurantsRepository, storage: MediaStorage) {
  /** Best effort: an orphan object is cheaper than failing a request that already succeeded. */
  async function deleteQuietly(logoUrl: string | null) {
    const key = logoUrl ? keyFromPublicPath(logoUrl) : null;
    if (!key) return;
    try {
      await storage.delete(key);
    } catch (error) {
      console.error("[logos] could not delete object", key, error);
    }
  }

  async function restaurantOf(ownerId: string) {
    const restaurant = await repository.findByOwner(ownerId);
    if (!restaurant) throw new RestaurantNotFoundError();
    return restaurant;
  }

  return {
    /**
     * Stores a new logo and replaces the previous one. Order: write the new object, point the
     * restaurant at it, then delete the old object (a failed delete is logged, not raised).
     */
    async uploadLogo(ownerId: string, upload: LogoUpload): Promise<LogoUploadResult> {
      validate(upload);
      const restaurant = await restaurantOf(ownerId);

      // Random name per upload, so cached copies of an older logo never go stale.
      const key = `logos/${restaurant.id}/${crypto.randomUUID()}.webp`;
      const logoUrl = publicPathFor(key);
      await storage.put(key, upload.bytes, LOGO_CONTENT_TYPE);

      try {
        await repository.updateLogoUrl(restaurant.id, logoUrl, new Date());
      } catch (error) {
        await deleteQuietly(logoUrl);
        throw error;
      }

      await deleteQuietly(restaurant.logoUrl);
      return { logoUrl };
    },

    /** Removes the logo (no-op when there is none). The object is deleted after the database update. */
    async removeLogo(ownerId: string): Promise<void> {
      const restaurant = await restaurantOf(ownerId);
      if (!restaurant.logoUrl) return;
      await repository.updateLogoUrl(restaurant.id, null, new Date());
      await deleteQuietly(restaurant.logoUrl);
    },
  };
}

export type LogoService = ReturnType<typeof createLogoService>;

/** Wires the service with D1 and the R2 media bucket. */
export function logoServiceFor(db: D1Database, bucket: R2Bucket): LogoService {
  return createLogoService(createRestaurantsRepository(db), createMediaStorage(bucket));
}
