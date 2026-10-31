import { COVER_MAX_BYTES, MEDIA_CONTENT_TYPE, type CoverUploadResult } from "@menucito/shared";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { createMediaStorage, publicPathFor, type MediaStorage } from "../storage/media";
import { RestaurantNotFoundError } from "./errors";
import { assertWebpUpload, deleteMediaQuietly, type ImageUpload } from "./uploads";

/** The uploaded cover, as received by the route (already read from the multipart body). */
export type CoverUpload = ImageUpload;

/**
 * Cover of the owner's restaurant. Available on every plan: this service deliberately never reads
 * `restaurants.plan`. Same flow as the logo (`logos.ts`).
 */
export function createCoverService(repository: RestaurantsRepository, storage: MediaStorage) {
  const deleteQuietly = (coverUrl: string | null) => deleteMediaQuietly(storage, coverUrl, "covers");

  async function restaurantOf(ownerId: string) {
    const restaurant = await repository.findByOwner(ownerId);
    if (!restaurant) throw new RestaurantNotFoundError();
    return restaurant;
  }

  return {
    /**
     * Stores a new cover and replaces the previous one. Order: write the new object, point the
     * restaurant at it, then delete the old object (a failed delete is logged, not raised).
     */
    async uploadCover(ownerId: string, upload: CoverUpload): Promise<CoverUploadResult> {
      assertWebpUpload(upload, "cover", COVER_MAX_BYTES);
      const restaurant = await restaurantOf(ownerId);

      // Random name per upload, so cached copies of an older cover never go stale.
      const key = `covers/${restaurant.id}/${crypto.randomUUID()}.webp`;
      const coverUrl = publicPathFor(key);
      await storage.put(key, upload.bytes, MEDIA_CONTENT_TYPE);

      try {
        await repository.updateCoverUrl(restaurant.id, coverUrl, new Date());
      } catch (error) {
        await deleteQuietly(coverUrl);
        throw error;
      }

      await deleteQuietly(restaurant.coverUrl);
      return { coverUrl };
    },

    /** Removes the cover (no-op when there is none). The object is deleted after the database update. */
    async removeCover(ownerId: string): Promise<void> {
      const restaurant = await restaurantOf(ownerId);
      if (!restaurant.coverUrl) return;
      await repository.updateCoverUrl(restaurant.id, null, new Date());
      await deleteQuietly(restaurant.coverUrl);
    },
  };
}

export type CoverService = ReturnType<typeof createCoverService>;

/** Wires the service with D1 and the R2 media bucket. */
export function coverServiceFor(db: D1Database, bucket: R2Bucket): CoverService {
  return createCoverService(createRestaurantsRepository(db), createMediaStorage(bucket));
}
