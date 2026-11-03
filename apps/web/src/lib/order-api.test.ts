import { describe, expect, it, vi } from "vitest";
import type { CreateOrderRequest, CreateOrderResponse } from "@menucito/shared";
import {
  ORDER_SUBMIT_MESSAGES,
  ORDER_SUBMIT_TIMEOUT_MS,
  buildOrderRequest,
  orderFailureAction,
  refreshMenu,
  submitOrder,
} from "./order-api";

const sampleBody: CreateOrderRequest = {
  items: [{ productId: "p1", quantity: 1, choices: {} }],
  customer: { name: "Juan", phone: "5491155551234", address: "Calle 1" },
  fulfillment: "delivery",
  paymentMethod: "cash",
  clientOrderId: "10000000-0000-4000-8000-000000000001",
  expectedTotalCents: 500_000,
};

const sampleSuccessResponse: CreateOrderResponse = {
  order: {
    number: 1,
    fulfillment: "delivery",
    paymentMethod: "cash",
    customerName: "Juan",
    customerPhone: "5491155551234",
    deliveryAddress: "Calle 1",
    subtotalCents: 500_000,
    shippingCents: 0,
    discountCents: 0,
    totalCents: 500_000,
    items: [],
  },
  whatsappUrl: "https://wa.me/5491112345678?text=test",
  payment: null,
};

describe("submitOrder", () => {
  it("returns ok: true on 201 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(sampleSuccessResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await submitOrder("http://api.local", "marta", sampleBody, mockFetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(201);
      expect(result.data.order.number).toBe(1);
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns ok: false with error code on 409 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "PRICE_CHANGED", message: "Price changed" } }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await submitOrder("http://api.local", "marta", sampleBody, mockFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("PRICE_CHANGED");
    }
  });

  it("handles network failure and returns NETWORK_ERROR", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const result = await submitOrder("http://api.local", "marta", sampleBody, mockFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NETWORK_ERROR");
    }
  });
});

describe("refreshMenu", () => {
  it("fetches public menu with cache: no-store", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ restaurant: { name: "Lo de Marta" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const menu = await refreshMenu("http://api.local", "marta", mockFetch);
    expect(menu?.restaurant.name).toBe("Lo de Marta");
    expect(mockFetch).toHaveBeenCalledWith("http://api.local/api/public/menus/marta", {
      cache: "no-store",
    });
  });

  it("returns null on fetch error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("404"));
    const menu = await refreshMenu("http://api.local", "marta", mockFetch);
    expect(menu).toBeNull();
  });
});

describe("orderFailureAction (scenarios 60 and 61)", () => {
  it.each([
    ["PRICE_CHANGED", { kind: "refreshMenu" }],
    ["PRODUCT_UNAVAILABLE", { kind: "refreshMenu" }],
    ["STORE_PAUSED", { kind: "paused" }],
    ["BELOW_MINIMUM", { kind: "belowMinimum" }],
    ["PAYMENT_METHOD_NOT_ACCEPTED", { kind: "refreshPaymentMethods" }],
    ["FULFILLMENT_NOT_OFFERED", { kind: "refreshFulfillments" }],
  ])("maps 409 %s", (code, action) => {
    expect(orderFailureAction({ status: 409, code })).toEqual(action);
  });

  it("maps 429 TOO_MANY_ORDERS to its message", () => {
    expect(orderFailureAction({ status: 429, code: "TOO_MANY_ORDERS" })).toEqual({
      kind: "message",
      message: "Ya enviaste varios pedidos. Esperá unos minutos o escribile al local.",
    });
  });

  it.each([
    [422, "VALIDATION_ERROR"],
    [0, "NETWORK_ERROR"],
    [500, "INTERNAL_ERROR"],
    [503, "UNKNOWN"],
    [413, "BODY_TOO_LARGE"],
  ])("maps %i %s to the generic retry message", (status, code) => {
    expect(orderFailureAction({ status, code })).toEqual({
      kind: "message",
      message: "No pudimos enviar tu pedido. Probá de nuevo.",
    });
    expect(ORDER_SUBMIT_MESSAGES.retry).toBe("No pudimos enviar tu pedido. Probá de nuevo.");
  });

  it("treats an aborted (timed out) request as a network error", async () => {
    const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    const result = await submitOrder("http://api.local", "marta", sampleBody, vi.fn().mockRejectedValue(abort));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(orderFailureAction(result)).toEqual({ kind: "message", message: ORDER_SUBMIT_MESSAGES.retry });
  });
});

describe("submitOrder timeout", () => {
  it("keeps the timeout armed while the response body is read", async () => {
    vi.useFakeTimers();
    try {
      const stalledFetch = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
              );
            }),
        } as unknown as Response),
      );
      const pending = submitOrder("http://api.local", "marta", sampleBody, stalledFetch as unknown as typeof fetch);
      await vi.advanceTimersByTimeAsync(ORDER_SUBMIT_TIMEOUT_MS);
      const result = await pending;
      expect(result).toMatchObject({ ok: false, status: 0, code: "NETWORK_ERROR" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildOrderRequest", () => {
  const lines = [{ productId: "p1", quantity: 2, choices: { Queso: 2 } }];
  const token = "10000000-0000-4000-8000-000000000001";

  it("builds a delivery order with trimmed text and the address", () => {
    const values = { name: " Juan ", phone: " 11 5555 1234 ", fulfillment: "delivery", address: " Calle 1 ", payment: "cash" } as const;
    expect(buildOrderRequest(values, lines, token, 123_000)).toEqual({
      clientOrderId: token,
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      expectedTotalCents: 123_000,
      items: [{ productId: "p1", quantity: 2, choices: { Queso: 2 } }],
    });
  });

  it("drops the address on takeaway orders", () => {
    const values = { name: "Juan", phone: "1155551234", fulfillment: "takeaway", address: "Calle 1", payment: "transfer" } as const;
    const request = buildOrderRequest(values, lines, token, 100);
    expect(request.fulfillment).toBe("takeaway");
    expect(request.customer.address).toBeNull();
    expect(request.paymentMethod).toBe("transfer");
  });

  it("copies the choices instead of sharing the cart object", () => {
    const values = { name: "Juan", phone: "1155551234", fulfillment: "takeaway", address: "", payment: "cash" } as const;
    const request = buildOrderRequest(values, lines, token, 100);
    expect(request.items[0]?.choices).toEqual(lines[0]?.choices);
    expect(request.items[0]?.choices).not.toBe(lines[0]?.choices);
  });
});
