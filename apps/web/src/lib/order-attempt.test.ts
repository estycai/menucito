import { describe, expect, it } from "vitest";
import type { StorageLike } from "./cart-store";
import { clearToken, getOrCreateToken, orderAttemptStorageKey } from "./order-attempt";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe("order-attempt", () => {
  it("generates a new token and persists it", () => {
    const storage = new MemoryStorage();
    const token1 = getOrCreateToken(storage, "marta");
    expect(token1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // Second call retrieves the same token
    const token2 = getOrCreateToken(storage, "marta");
    expect(token2).toBe(token1);
  });

  it("handles corrupt storage by generating a new token", () => {
    const storage = new MemoryStorage();
    storage.setItem(orderAttemptStorageKey("marta"), "corrupt-json{");

    const token = getOrCreateToken(storage, "marta");
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("clears the saved token", () => {
    const storage = new MemoryStorage();
    const token1 = getOrCreateToken(storage, "marta");
    clearToken(storage, "marta");

    const token2 = getOrCreateToken(storage, "marta");
    expect(token2).not.toBe(token1);
  });

  it("works safely with null storage", () => {
    const token = getOrCreateToken(null, "marta");
    expect(token).toBeDefined();
    clearToken(null, "marta");
  });
});
