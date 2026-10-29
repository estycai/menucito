import {
  addToCart,
  parseStoredLines,
  reconcileCart,
  removeLine,
  setLineQuantity,
  type AddToCartResult,
  type CartLine,
  type MenuProduct,
  type PricedProduct,
  type Quantities,
} from "@menucito/shared";

/** Bump when the stored shape changes; an unknown version is treated as an empty cart. */
export const CART_STORAGE_VERSION = 1;

/** One cart per restaurant: a diner may open two menus, and lines must never mix. */
export const cartStorageKey = (slug: string) => `menucito:cart:${slug}`;

/** The part of `Storage` the cart needs (and what tests fake). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage`, or `null` when the browser blocks it (private mode, disabled storage) or there is no window. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the stored lines. Missing, corrupt, foreign-version or blocked storage all give an empty cart. */
export function readLines(storage: StorageLike | null, slug: string): CartLine[] {
  try {
    const raw = storage?.getItem(cartStorageKey(slug));
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || (data as { v?: unknown }).v !== CART_STORAGE_VERSION) return [];
    return parseStoredLines((data as { lines?: unknown }).lines);
  } catch {
    return [];
  }
}

/** Saves the lines; a failure (quota, blocked storage) is ignored and the cart lives in memory only. */
export function writeLines(storage: StorageLike | null, slug: string, lines: readonly CartLine[]): void {
  try {
    storage?.setItem(cartStorageKey(slug), JSON.stringify({ v: CART_STORAGE_VERSION, lines }));
  } catch {
    // Storage is full or blocked: keep working with the in-memory cart.
  }
}

export interface CartState {
  /** `false` until the stored cart was read (the server render never has it). */
  ready: boolean;
  lines: CartLine[];
  /** The stored cart was adjusted to a changed menu; the UI says so until dismissed. */
  notice: boolean;
}

export const INITIAL_CART_STATE: CartState = { ready: false, lines: [], notice: false };

/**
 * The cart of one restaurant: the lines, persisted to `storage` on every change, with subscriptions
 * so every island of the page shows the same cart. All price and merge rules live in `@menucito/shared`.
 */
export function createCartStore(slug: string, storage: StorageLike | null) {
  let state: CartState = INITIAL_CART_STATE;
  let menu: ReadonlyMap<string, MenuProduct> | null = null;
  const listeners = new Set<() => void>();

  const update = (next: Partial<CartState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  const commit = (lines: CartLine[]) => {
    writeLines(storage, slug, lines);
    update({ lines });
  };

  /** Reads the stored cart once. */
  const load = () => {
    if (!state.ready) update({ ready: true, lines: readLines(storage, slug) });
  };

  /** Re-reads the stored cart (another tab changed it) and adapts it to the menu already known. */
  const sync = () => {
    const lines = readLines(storage, slug);
    const result = menu ? reconcileCart(lines, menu) : { lines, changed: false };
    update({ ready: true, lines: result.lines });
    if (result.changed) writeLines(storage, slug, result.lines);
  };

  return {
    getState: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    load,
    sync,

    /** Adapts the stored cart to the current menu; tells the diner once if something changed. */
    reconcile(products: readonly MenuProduct[]) {
      load();
      menu = new Map(products.map((product) => [product.id, product]));
      const result = reconcileCart(state.lines, menu);
      if (result.changed) {
        commit(result.lines);
        update({ notice: true });
      }
    },

    add(
      product: PricedProduct & { id: string },
      quantities: Quantities,
      quantity: number,
    ): AddToCartResult {
      load();
      const result = addToCart(state.lines, product, quantities, quantity);
      if (result.ok) commit(result.lines);
      return result;
    },

    setQuantity(key: string, quantity: number) {
      commit(setLineQuantity(state.lines, key, quantity));
    },

    remove(key: string) {
      commit(removeLine(state.lines, key));
    },

    dismissNotice() {
      update({ notice: false });
    },
  };
}

export type CartStore = ReturnType<typeof createCartStore>;

const stores = new Map<string, CartStore>();

/**
 * The single store of `slug` in this page, shared by every island (they live in one module graph),
 * and kept in sync with other tabs through the `storage` event.
 */
export function cartStoreFor(slug: string): CartStore {
  let store = stores.get(slug);
  if (!store) {
    store = createCartStore(slug, browserStorage());
    stores.set(slug, store);
    const created = store;
    window.addEventListener("storage", (event) => {
      if (event.key === null || event.key === cartStorageKey(slug)) created.sync();
    });
  }
  return store;
}
