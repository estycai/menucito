import { describe, expect, it } from "vitest";
import { DELIVERY_ADDRESS_MESSAGES, ORDER_MESSAGES, ORDERS_MESSAGES } from "@menucito/shared";
import type { StorageLike } from "./cart-store";
import {
  EMPTY_ORDER_FORM,
  getFormErrors,
  minOrderShortfallCents,
  offeredFulfillments,
  offeredPaymentMethods,
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
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe("order form storage (scenario 11)", () => {
  it("remembers the values per restaurant including phone, but never the address", () => {
    const storage = fakeStorage();
    const values = { name: "Juan", phone: "11 5555 1234", fulfillment: "delivery", address: "Calle 1", payment: "cash" } as const;
    writeOrderForm(storage, "a", values);
    expect(Object.keys(storage.data)).toEqual(["menucito:order-form:a"]);
    expect(storage.data["menucito:order-form:a"]).not.toContain("Calle 1");
    expect(readOrderForm(storage, "a")).toEqual({ ...values, address: "" });
    expect(readOrderForm(storage, "b")).toEqual(EMPTY_ORDER_FORM);
  });

  it("ignores an address remembered by an older version", () => {
    const key = orderFormStorageKey("a");
    const storage = fakeStorage({ [key]: JSON.stringify({ v: 1, name: "Juan", address: "Calle 1" }) });
    expect(readOrderForm(storage, "a").address).toBe("");
  });

  it("drops a fulfillment the restaurant no longer offers", () => {
    const storage = fakeStorage();
    writeOrderForm(storage, "a", { name: "Juan", phone: "", fulfillment: "delivery", address: "Calle 1", payment: "cash" });
    expect(readOrderForm(storage, "a", ["takeaway"]).fulfillment).toBe("");
  });

  it("drops a payment method the restaurant no longer offers", () => {
    const storage = fakeStorage();
    writeOrderForm(storage, "a", { name: "Juan", phone: "", fulfillment: "delivery", address: "Calle 1", payment: "transfer" });
    expect(readOrderForm(storage, "a", ["delivery"], ["cash"]).payment).toBe("");
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
    expect(loaded).toEqual({ name: "n".repeat(60), phone: "", fulfillment: "", address: "", payment: "" });
    expect(readOrderForm(null, "a")).toEqual(EMPTY_ORDER_FORM);
  });
});

describe("offeredPaymentMethods", () => {
  it("extracts methods in order", () => {
    expect(offeredPaymentMethods({ paymentMethods: [{ method: "cash" }, { method: "transfer" }] })).toEqual(["cash", "transfer"]);
    expect(offeredPaymentMethods({ paymentMethods: [{ method: "cash" }] })).toEqual(["cash"]);
  });
});

describe("offeredFulfillments (scenario 10)", () => {
  it("follows the restaurant flags", () => {
    expect(offeredFulfillments({ takeaway: true, delivery: true })).toEqual(["takeaway", "delivery"]);
    expect(offeredFulfillments({ takeaway: true, delivery: false })).toEqual(["takeaway"]);
    expect(offeredFulfillments({ takeaway: false, delivery: true })).toEqual(["delivery"]);
  });
});

describe("getFormErrors", () => {
  const valid = {
    name: "Juan",
    phone: "11 5555 1234",
    fulfillment: "delivery",
    address: "Calle 1",
    payment: "cash",
  } as const;
  const both = ["takeaway", "delivery"] as const;
  const methods = ["cash", "transfer"] as const;

  it("accepts a complete form", () => {
    expect(getFormErrors(valid, both, methods)).toEqual({});
    expect(getFormErrors({ ...valid, fulfillment: "takeaway", address: "" }, both, methods)).toEqual({});
  });

  it("flags every missing field on an empty form", () => {
    expect(getFormErrors(EMPTY_ORDER_FORM, both, methods)).toEqual({
      name: ORDER_MESSAGES.nameRequired,
      phone: ORDERS_MESSAGES.phoneRequired,
      fulfillment: ORDER_MESSAGES.fulfillmentRequired,
      payment: ORDER_MESSAGES.paymentRequired,
    });
  });

  it("treats whitespace as empty and checks the length limits", () => {
    expect(getFormErrors({ ...valid, name: "   " }, both, methods).name).toBe(ORDER_MESSAGES.nameRequired);
    expect(getFormErrors({ ...valid, name: "n".repeat(61) }, both, methods).name).toBe(ORDER_MESSAGES.nameTooLong);
    expect(getFormErrors({ ...valid, address: " " }, both, methods).address).toBe(ORDER_MESSAGES.addressRequired);
    expect(getFormErrors({ ...valid, address: "a".repeat(201) }, both, methods).address).toBe(
      ORDER_MESSAGES.addressTooLong,
    );
  });

  it("rejects a phone that is not an Argentine WhatsApp number", () => {
    expect(getFormErrors({ ...valid, phone: "1234" }, both, methods).phone).toBe(ORDERS_MESSAGES.phoneInvalid);
  });

  it("asks for the geocoded address instead of the typed one in zones mode", () => {
    const chosen = {
      placeId: null,
      lat: -34.6,
      lng: -58.4,
      formattedAddress: "Av. Corrientes 1500",
      locality: null,
      unit: null,
      betweenStreets: null,
      label: null,
    };
    expect(getFormErrors({ ...valid, address: "" }, both, methods, { address: null }).address).toBe(
      DELIVERY_ADDRESS_MESSAGES.addressRequired,
    );
    expect(getFormErrors({ ...valid, address: "" }, both, methods, { address: chosen })).toEqual({});
    expect(getFormErrors({ ...valid, fulfillment: "takeaway" }, both, methods, { address: null })).toEqual({});
  });

  it("rejects choices the restaurant does not offer", () => {
    const errors = getFormErrors(valid, ["takeaway"], ["transfer"]);
    expect(errors.fulfillment).toBe(ORDER_MESSAGES.fulfillmentRequired);
    expect(errors.payment).toBe(ORDER_MESSAGES.paymentRequired);
  });
});

describe("minOrderShortfallCents", () => {
  it("returns what is missing below the minimum and null otherwise", () => {
    expect(minOrderShortfallCents(800_000, 1_000_000)).toBe(200_000);
    expect(minOrderShortfallCents(1_000_000, 1_000_000)).toBeNull();
    expect(minOrderShortfallCents(1_200_000, 1_000_000)).toBeNull();
    expect(minOrderShortfallCents(100, null)).toBeNull();
  });
});
