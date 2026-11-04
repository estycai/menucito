import { lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { rateLimits } from "../db/schema";

export interface RateLimitsRepository {
  /**
   * Counts one request of `key` in the window that began at `windowStart` (epoch ms) and returns the
   * count so far in that window. A key last seen in an older window starts again at 1. Rows of
   * windows older than `windowStart` are deleted in the same batch, so the table stays small.
   */
  hit(key: string, windowStart: number): Promise<number>;
}

export function createRateLimitsRepository(d1: D1Database): RateLimitsRepository {
  const db = drizzle(d1);

  return {
    async hit(key, windowStart) {
      const [, counted] = await db.batch([
        db.delete(rateLimits).where(lt(rateLimits.windowStart, windowStart)),
        // One atomic upsert: concurrent requests of the same key never lose a count.
        db
          .insert(rateLimits)
          .values({ key, windowStart, count: 1 })
          .onConflictDoUpdate({
            target: rateLimits.key,
            set: {
              count: sql`CASE WHEN ${rateLimits.windowStart} = excluded.window_start THEN ${rateLimits.count} + 1 ELSE 1 END`,
              windowStart: sql`excluded.window_start`,
            },
          })
          .returning({ count: rateLimits.count }),
      ]);
      return counted[0]?.count ?? 1;
    },
  };
}
