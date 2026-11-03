import type { StorageLike } from "./cart-store";

export const ORDER_ATTEMPT_STORAGE_VERSION = 1;

export const orderAttemptStorageKey = (slug: string) => `menucito:order-attempt:${slug}`;

export function getOrCreateToken(storage: StorageLike | null, slug: string): string {
  try {
    const raw = storage?.getItem(orderAttemptStorageKey(slug));
    if (raw) {
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
    }
  } catch {
    // Corrupt or unparseable data
  }

  const token = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

  try {
    storage?.setItem(orderAttemptStorageKey(slug), JSON.stringify({ v: ORDER_ATTEMPT_STORAGE_VERSION, token }));
  } catch {
    // Storage full or unavailable
  }

  return token;
}

export function clearToken(storage: StorageLike | null, slug: string): void {
  try {
    storage?.removeItem(orderAttemptStorageKey(slug));
  } catch {
    // Ignore storage errors
  }
}
