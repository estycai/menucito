import { createRateLimitsRepository, type RateLimitsRepository } from "../repositories/rate-limits";
import { RateLimitedError } from "./errors";

export interface RateLimitPolicy {
  /** Most requests one key may make per window. */
  limit: number;
  windowMs: number;
}

/**
 * Address search of the menu: every call is billed by Google, so each IP gets 30 calls per menu every
 * 10 minutes (a diner searching, picking and moving the pin a few times uses well under that).
 */
export const PLACES_RATE_LIMIT: RateLimitPolicy = { limit: 30, windowMs: 10 * 60_000 };

export interface RateLimiter {
  /** Counts one request of `key`; throws `RateLimitedError` once the key is over the limit. */
  consume(key: string): Promise<void>;
}

/**
 * Fixed-window limiter over D1. The Workers Rate Limiting binding only supports 10 or 60 second
 * periods and counts per location, so it cannot express "30 per 10 minutes".
 */
export function createRateLimiter(
  repo: RateLimitsRepository,
  policy: RateLimitPolicy,
  now: () => number = () => Date.now(),
): RateLimiter {
  return {
    async consume(key) {
      const windowStart = Math.floor(now() / policy.windowMs) * policy.windowMs;
      const count = await repo.hit(key, windowStart);
      if (count > policy.limit) throw new RateLimitedError();
    },
  };
}

export function placesRateLimiterFor(db: D1Database): RateLimiter {
  return createRateLimiter(createRateLimitsRepository(db), PLACES_RATE_LIMIT);
}
