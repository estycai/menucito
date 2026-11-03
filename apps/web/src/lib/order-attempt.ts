import type { StorageLike } from "./cart-store";

export const ORDER_ATTEMPT_STORAGE_VERSION = 1;

export const orderAttemptStorageKey = (slug: string) => `menucito:order-attempt:${slug}`;

/**
 * Tokens that could not be persisted (no storage, private mode, quota), per slug. Without it a retry
 * after a timeout would send a new token and could create the same order twice. It only holds a token
 * while storage is unusable, so a token another tab cleared from storage is never resurrected.
 */
const memoryTokens = new Map<string, string>();

function parseToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (
      data &&
      typeof data === "object" &&
      data.v === ORDER_ATTEMPT_STORAGE_VERSION &&
      typeof data.token === "string" &&
      data.token
    ) {
      return data.token;
    }
  } catch {
    // Corrupt or unparseable data
  }
  return null;
}

function newToken(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
}

/** The idempotency token of the current order attempt: the same one until `clearToken` (scenario 60). */
export function getOrCreateToken(storage: StorageLike | null, slug: string): string {
  const key = orderAttemptStorageKey(slug);
  let readable = storage !== null;
  let stored: string | null = null;
  try {
    stored = parseToken(storage?.getItem(key));
  } catch {
    readable = false;
  }
  if (stored) return stored;

  const token = memoryTokens.get(slug) ?? newToken();
  let persisted = false;
  if (readable) {
    try {
      storage?.setItem(key, JSON.stringify({ v: ORDER_ATTEMPT_STORAGE_VERSION, token }));
      persisted = true;
    } catch {
      // Storage full or unavailable: keep the token in memory instead.
    }
  }

  if (persisted) memoryTokens.delete(slug);
  else memoryTokens.set(slug, token);
  return token;
}

export function clearToken(storage: StorageLike | null, slug: string): void {
  memoryTokens.delete(slug);
  try {
    storage?.removeItem(orderAttemptStorageKey(slug));
  } catch {
    // Ignore storage errors
  }
}
