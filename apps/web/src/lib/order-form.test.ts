import { describe, expect, it } from "vitest";
import type { StorageLike } from "./cart-store";
import {
  EMPTY_ORDER_FORM,
  offeredFulfillments,
  orderFormStorageKey,
  readOrderForm,
  writeOrderForm,
} from "./order-form";

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

describe("order form storage (scenario 11)", () => {
  it("remembers the values per restaurant", () => {
    const storage = fakeStorage();
    const values = { name: "Juan", fulfillment: "delivery", address: "Calle 1", payment: "cash" } as const;
    writeOrderForm(storage, "a", values);
    expect(Object.keys(storage.data)).toEqual(["menucito:order-form:a"]);
    expect(readOrderForm(storage, "a")).toEqual(values);
    expect(readOrderForm(storage, "b")).toEqual(EMPTY_ORDER_FORM);
  });

  it("drops a fulfillment the restaurant no longer offers", () => {
    const storage = fakeStorage();
    writeOrderForm(storage, "a", { name: "Juan", fulfillment: "delivery", address: "Calle 1", payment: "cash" });
    expect(readOrderForm(storage, "a", ["takeaway"]).fulfillment).toBe("");
  });

  it("is tolerant of corrupt, foreign or oversized data", () => {
    const key = orderFormStorageKey("a");
    expect(readOrderForm(fakeStorage({ [key]: "{nope" }), "a")).toEqual(EMPTY_ORDER_FORM);
    expect(readOrderForm(fakeStorage({ [key]: JSON.stringify({ v: 9, name: "x" }) }), "a")).toEqual(EMPTY_ORDER_FORM);
    expect(readOrderForm(fakeStorage({ [key]: "null" }), "a")).toEqual(EMPTY_ORDER_FORM);
    const loaded = readOrderForm(
      fakeStorage({
        [key]: JSON.stringify({ v: 1, name: "n".repeat(500), fulfillment: 3, address: 7, payment: "bitcoin" }),
      }),
      "a",
    );
    expect(loaded).toEqual({ name: "n".repeat(60), fulfillment: "", address: "", payment: "" });
    expect(readOrderForm(null, "a")).toEqual(EMPTY_ORDER_FORM);
  });
});

describe("offeredFulfillments (scenario 10)", () => {
  it("follows the restaurant flags", () => {
    expect(offeredFulfillments({ takeaway: true, delivery: true })).toEqual(["takeaway", "delivery"]);
    expect(offeredFulfillments({ takeaway: true, delivery: false })).toEqual(["takeaway"]);
    expect(offeredFulfillments({ takeaway: false, delivery: true })).toEqual(["delivery"]);
  });
});
