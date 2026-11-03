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

  it("reuses the same token without storage until it is cleared", () => {
    const token1 = getOrCreateToken(null, "no-storage");
    expect(getOrCreateToken(null, "no-storage")).toBe(token1);
    expect(getOrCreateToken(null, "other-slug")).not.toBe(token1);

    clearToken(null, "no-storage");
    expect(getOrCreateToken(null, "no-storage")).not.toBe(token1);
    clearToken(null, "no-storage");
    clearToken(null, "other-slug");
  });

  it("reuses the same token when storage throws (private mode)", () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const token1 = getOrCreateToken(throwing, "private");
    expect(getOrCreateToken(throwing, "private")).toBe(token1);

    clearToken(throwing, "private");
    expect(getOrCreateToken(throwing, "private")).not.toBe(token1);
    clearToken(throwing, "private");
  });

  it("reuses the same token when storage reads but cannot write (quota)", () => {
    const readOnly: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    const token1 = getOrCreateToken(readOnly, "quota");
    expect(getOrCreateToken(readOnly, "quota")).toBe(token1);
    clearToken(readOnly, "quota");
  });

  it("does not resurrect a token another tab cleared from working storage", () => {
    const storage = new MemoryStorage();
    const token1 = getOrCreateToken(storage, "shared");
    storage.removeItem(orderAttemptStorageKey("shared"));
    expect(getOrCreateToken(storage, "shared")).not.toBe(token1);
    clearToken(storage, "shared");
  });
});
