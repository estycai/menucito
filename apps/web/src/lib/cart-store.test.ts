import { describe, expect, it, vi } from "vitest";
import type { Ingredient, MenuProduct } from "@menucito/shared";
import {
  CART_STORAGE_VERSION,
  cartStorageKey,
  createCartStore,
  readLines,
  writeLines,
  type StorageLike,
} from "./cart-store";

const bacon: Ingredient = { name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_000 };
const burger: MenuProduct = { id: "p1", priceCents: 900_000, available: true, ingredients: [bacon] };
const drink: MenuProduct = { id: "p2", priceCents: 350_000, available: true, ingredients: [] };

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const stored = (slug: string, lines: unknown, v: number = CART_STORAGE_VERSION) =>
  ({ [cartStorageKey(slug)]: JSON.stringify({ v, lines }) }) as Record<string, string>;

describe("readLines and writeLines (scenario 7)", () => {
  it("round-trips the cart under a key per restaurant", () => {
    const storage = fakeStorage();
    const line = { key: "k", productId: "p1", quantity: 2, choices: {}, unitPriceCents: 10 };
    writeLines(storage, "lo-de-marta", [line]);
    expect(Object.keys(storage.data)).toEqual(["menucito:cart:lo-de-marta"]);
    expect(readLines(storage, "lo-de-marta")).toEqual([line]);
    expect(readLines(storage, "otro-local")).toEqual([]);
  });

  it.each([
    ["missing", {}],
    ["not json", { "menucito:cart:a": "{nope" }],
    ["a foreign version", stored("a", [{ key: "k", productId: "p", quantity: 1, choices: {}, unitPriceCents: 1 }], 99)],
    ["no lines", { "menucito:cart:a": JSON.stringify({ v: 1 }) }],
    ["a bare list", { "menucito:cart:a": "[]" }],
    ["null", { "menucito:cart:a": "null" }],
  ])("gives an empty cart for %s storage", (_name, data) => {
    expect(readLines(fakeStorage(data), "a")).toEqual([]);
  });

  it("works without storage and when storage throws", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readLines(null, "a")).toEqual([]);
    expect(readLines(broken, "a")).toEqual([]);
    expect(() => writeLines(null, "a", [])).not.toThrow();
    expect(() => writeLines(broken, "a", [])).not.toThrow();
  });
});

describe("cart store", () => {
  it("starts empty and not ready until it loads", () => {
    const store = createCartStore("a", fakeStorage(stored("a", [])));
    expect(store.getState()).toEqual({ ready: false, lines: [], notice: false });
    store.load();
    expect(store.getState().ready).toBe(true);
  });

  it("adds, merges, changes quantity and removes, persisting and notifying every time", () => {
    const storage = fakeStorage();
    const store = createCartStore("a", storage);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.add(burger, { Bacon: 2 }, 1).ok).toBe(true);
    expect(store.add(burger, { Bacon: 2 }, 1).ok).toBe(true);
    expect(store.add(burger, {}, 1).ok).toBe(true);
    expect(store.getState().lines.map((line) => line.quantity)).toEqual([2, 1]);

    const key = store.getState().lines[0]?.key ?? "";
    store.setQuantity(key, 5);
    expect(store.getState().lines[0]?.quantity).toBe(5);
    store.setQuantity(key, 0);
    expect(store.getState().lines).toHaveLength(1);

    store.remove(store.getState().lines[0]?.key ?? "");
    expect(store.getState().lines).toEqual([]);
    expect(listener).toHaveBeenCalled();
    expect(readLines(storage, "a")).toEqual([]);
  });

  it("persists the cart so a new store of the same restaurant restores it", () => {
    const storage = fakeStorage();
    createCartStore("a", storage).add(drink, {}, 3);
    const restored = createCartStore("a", storage);
    restored.load();
    expect(restored.getState().lines[0]).toMatchObject({ productId: "p2", quantity: 3 });
  });

  it("refuses beyond the line limit without changing the cart", () => {
    const store = createCartStore("a", fakeStorage());
    store.add(drink, {}, 20);
    const result = store.add(drink, {}, 1);
    expect(result.ok).toBe(false);
    expect(store.getState().lines[0]?.quantity).toBe(20);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createCartStore("a", fakeStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.add(drink, {}, 1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("works in memory when storage is not available", () => {
    const store = createCartStore("a", null);
    expect(store.add(drink, {}, 2).ok).toBe(true);
    expect(store.getState().lines[0]?.quantity).toBe(2);
  });
});

describe("reconcile (scenario 7)", () => {
  const seeded = () => {
    const storage = fakeStorage();
    const first = createCartStore("a", storage);
    first.add(burger, { Bacon: 3 }, 1);
    first.add(drink, {}, 2);
    return storage;
  };

  it("keeps an unchanged cart and shows no notice", () => {
    const store = createCartStore("a", seeded());
    store.reconcile([burger, drink]);
    expect(store.getState().lines).toHaveLength(2);
    expect(store.getState().notice).toBe(false);
  });

  it("drops a sold out or removed product, saves the result and shows the notice once", () => {
    const storage = seeded();
    const store = createCartStore("a", storage);
    store.reconcile([burger, { ...drink, available: false }]);
    expect(store.getState().lines.map((line) => line.productId)).toEqual(["p1"]);
    expect(store.getState().notice).toBe(true);
    expect(readLines(storage, "a")).toHaveLength(1);

    // Reconciling again (another island) finds nothing new, and a new page load has nothing to report.
    store.dismissNotice();
    store.reconcile([burger, { ...drink, available: false }]);
    expect(store.getState().notice).toBe(false);
    const next = createCartStore("a", storage);
    next.reconcile([burger, { ...drink, available: false }]);
    expect(next.getState().notice).toBe(false);
  });

  it("uses the current price and ingredient range", () => {
    const store = createCartStore("a", seeded());
    store.reconcile([{ ...burger, ingredients: [{ ...bacon, maxQty: 2 }] }, { ...drink, priceCents: 400_000 }]);
    const [first, second] = store.getState().lines;
    expect(first?.choices).toEqual({ Bacon: 2 });
    expect(second?.unitPriceCents).toBe(400_000);
    expect(store.getState().notice).toBe(true);
  });

  it("adapts to the menu when another tab changes the stored cart", () => {
    const storage = seeded();
    const store = createCartStore("a", storage);
    store.reconcile([burger, drink]);
    storage.data[cartStorageKey("a")] = JSON.stringify({
      v: 1,
      lines: [{ key: "ghost", productId: "gone", quantity: 1, choices: {}, unitPriceCents: 1 }],
    });
    store.sync();
    expect(store.getState().lines).toEqual([]);
  });
});
