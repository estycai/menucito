import { describe, expect, it } from "vitest";
import { ORDER_ADDRESS_MAX_LENGTH, ORDER_NAME_MAX_LENGTH } from "./order";
import {
  ORDER_LINE_QUANTITY_MAX,
  ORDER_MAX_LINES,
  ORDER_STATUSES,
  ORDER_STATUS_FILTERS,
  ORDER_STATUS_LABELS,
  ACTIVE_ORDER_STATUSES,
  buildOrderMessage,
  canTransition,
  createOrderRequestSchema,
  describeOrderOptions,
  nextStatus,
  orderFiltersQuerySchema,
  orderTotals,
  type OrderStatus,
} from "./orders";
import {
  ALIAS_MAX_LENGTH,
  HOLDER_NAME_MAX_LENGTH,
  MAX_MONEY_CENTS,
  settingsProblem,
  updateSettingsSchema,
  type StoreSettings,
} from "./settings";
import { isCalendarDateKey, localDateKey, localDayRange } from "./time";

describe("Scenario 1: orderTotals", () => {
  it("calculates total = subtotal + shipping only for delivery, 0 shipping for takeaway", () => {
    expect(orderTotals({ subtotalCents: 500000, shippingCents: 150000, fulfillment: "delivery" })).toEqual({
      subtotalCents: 500000,
      shippingCents: 150000,
      totalCents: 650000,
    });

    expect(orderTotals({ subtotalCents: 500000, shippingCents: 150000, fulfillment: "takeaway" })).toEqual({
      subtotalCents: 500000,
      shippingCents: 0,
      totalCents: 500000,
    });

    expect(orderTotals({ subtotalCents: 500000, shippingCents: 0, fulfillment: "delivery" })).toEqual({
      subtotalCents: 500000,
      shippingCents: 0,
      totalCents: 500000,
    });
  });
});

describe("Scenario 2: canTransition", () => {
  it("allows valid forward transitions and cancellations, rejects backward and terminal moves", () => {
    for (const fulfillment of ["delivery", "takeaway"] as const) {
      // Valid transitions
      expect(canTransition("new", "preparing", fulfillment)).toBe(true);
      expect(canTransition("new", "ready", fulfillment)).toBe(true);
      expect(canTransition("new", "delivered", fulfillment)).toBe(true);
      expect(canTransition("new", "cancelled", fulfillment)).toBe(true);

      expect(canTransition("preparing", "ready", fulfillment)).toBe(true);
      expect(canTransition("preparing", "delivered", fulfillment)).toBe(true);
      expect(canTransition("preparing", "cancelled", fulfillment)).toBe(true);

      expect(canTransition("ready", "delivered", fulfillment)).toBe(true);
      expect(canTransition("ready", "cancelled", fulfillment)).toBe(true);

      // Rejects backward moves
      expect(canTransition("preparing", "new", fulfillment)).toBe(false);
      expect(canTransition("ready", "new", fulfillment)).toBe(false);
      expect(canTransition("ready", "preparing", fulfillment)).toBe(false);
      expect(canTransition("delivered", "ready", fulfillment)).toBe(false);
      expect(canTransition("delivered", "new", fulfillment)).toBe(false);

      // Terminal states cannot transition anywhere
      for (const status of ORDER_STATUSES) {
        expect(canTransition("delivered", status, fulfillment)).toBe(false);
        expect(canTransition("cancelled", status, fulfillment)).toBe(false);
      }

      // Unknown status
      expect(canTransition("new", "unknown" as OrderStatus, fulfillment)).toBe(false);
    }
  });

  it("nextStatus steps through the pipeline", () => {
    for (const fulfillment of ["delivery", "takeaway"] as const) {
      expect(nextStatus("new", fulfillment)).toBe("preparing");
      expect(nextStatus("preparing", fulfillment)).toBe("ready");
      expect(nextStatus("delivered", fulfillment)).toBeNull();
      expect(nextStatus("cancelled", fulfillment)).toBeNull();
    }
  });
});

describe("11b scenario 7: the sent status", () => {
  it("lists sent between ready and delivered, as an active status labelled Enviado", () => {
    expect(ORDER_STATUSES).toEqual(["new", "preparing", "ready", "sent", "delivered", "cancelled"]);
    expect(ACTIVE_ORDER_STATUSES).toEqual(["new", "preparing", "ready", "sent"]);
    expect(ORDER_STATUS_LABELS.sent).toBe("Enviado");
    expect(ORDER_STATUS_FILTERS).toContain("sent");
  });
});

describe("11b scenario 8: canTransition depends on the fulfillment", () => {
  it("lets a delivery order move forward through sent, skipping steps, and be cancelled while sent", () => {
    expect(canTransition("new", "sent", "delivery")).toBe(true);
    expect(canTransition("preparing", "sent", "delivery")).toBe(true);
    expect(canTransition("ready", "sent", "delivery")).toBe(true);
    expect(canTransition("sent", "delivered", "delivery")).toBe(true);
    expect(canTransition("sent", "cancelled", "delivery")).toBe(true);
  });

  it("rejects moving back from sent and leaving final statuses", () => {
    expect(canTransition("sent", "ready", "delivery")).toBe(false);
    expect(canTransition("sent", "new", "delivery")).toBe(false);
    expect(canTransition("sent", "sent", "delivery")).toBe(false);
    expect(canTransition("delivered", "sent", "delivery")).toBe(false);
    expect(canTransition("cancelled", "sent", "delivery")).toBe(false);
  });

  it("never sends a takeaway order", () => {
    for (const from of ORDER_STATUSES) {
      expect(canTransition(from, "sent", "takeaway")).toBe(false);
    }
  });
});

describe("11b scenario 9: nextStatus depends on the fulfillment", () => {
  it("goes from ready to sent with delivery and to delivered with takeaway", () => {
    expect(nextStatus("ready", "delivery")).toBe("sent");
    expect(nextStatus("ready", "takeaway")).toBe("delivered");
    expect(nextStatus("sent", "delivery")).toBe("delivered");
  });
});

describe("Scenario 3: createOrderRequestSchema", () => {
  const validOrder = {
    items: [{ productId: "prod-1", quantity: 2, choices: { Bacon: 2 } }],
    customer: {
      name: "Juan Pérez",
      phone: "11 5555-1234",
      address: "Av. Siempre Viva 742",
    },
    fulfillment: "delivery",
    paymentMethod: "cash",
    clientOrderId: "123e4567-e89b-12d3-a456-426614174000",
    expectedTotalCents: 2100000,
  };

  it("accepts a valid order and normalizes the Argentine phone number", () => {
    const res1 = createOrderRequestSchema.safeParse(validOrder);
    expect(res1.success).toBe(true);
    if (res1.success) expect(res1.data.customer.phone).toBe("5491155551234");

    const res2 = createOrderRequestSchema.safeParse({
      ...validOrder,
      customer: { ...validOrder.customer, phone: "+54 9 11 5555 1234" },
    });
    expect(res2.success).toBe(true);
    if (res2.success) expect(res2.data.customer.phone).toBe("5491155551234");

    const res3 = createOrderRequestSchema.safeParse({
      ...validOrder,
      customer: { ...validOrder.customer, phone: "011 15 5555 1234" },
    });
    expect(res3.success).toBe(true);
    if (res3.success) expect(res3.data.customer.phone).toBe("5491155551234");
  });

  it("ignores the address for takeaway", () => {
    const res = createOrderRequestSchema.safeParse({
      ...validOrder,
      fulfillment: "takeaway",
      customer: { ...validOrder.customer, address: "" },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.customer.address).toBeNull();
    }
  });

  it("rejects invalid inputs with Spanish messages", () => {
    // more than 30 lines
    const thirtyOneItems = Array.from({ length: ORDER_MAX_LINES + 1 }, (_, i) => ({
      productId: `prod-${i}`,
      quantity: 1,
    }));
    expect(createOrderRequestSchema.safeParse({ ...validOrder, items: thirtyOneItems }).success).toBe(false);

    // quantities: 0, 21, 1.5
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        items: [{ productId: "p1", quantity: 0 }],
      }).success
    ).toBe(false);
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        items: [{ productId: "p1", quantity: ORDER_LINE_QUANTITY_MAX + 1 }],
      }).success
    ).toBe(false);
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        items: [{ productId: "p1", quantity: 1.5 }],
      }).success
    ).toBe(false);

    // customer name: empty or > 60
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        customer: { ...validOrder.customer, name: "   " },
      }).success
    ).toBe(false);
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        customer: { ...validOrder.customer, name: "a".repeat(ORDER_NAME_MAX_LENGTH + 1) },
      }).success
    ).toBe(false);

    // delivery without address or address > 120
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        customer: { ...validOrder.customer, address: "" },
      }).success
    ).toBe(false);
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        customer: { ...validOrder.customer, address: "a".repeat(ORDER_ADDRESS_MAX_LENGTH + 1) },
      }).success
    ).toBe(false);

    // invalid phone
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        customer: { ...validOrder.customer, phone: "123" },
      }).success
    ).toBe(false);

    // clientOrderId not UUID
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        clientOrderId: "not-a-uuid",
      }).success
    ).toBe(false);

    // expectedTotalCents negative or non-integer
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        expectedTotalCents: -100,
      }).success
    ).toBe(false);
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        expectedTotalCents: 15.5,
      }).success
    ).toBe(false);

    // unknown fulfillment or paymentMethod
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        fulfillment: "drone",
      }).success
    ).toBe(false);
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        paymentMethod: "crypto",
      }).success
    ).toBe(false);
  });
});

describe("Scenario 4: updateSettingsSchema and settingsProblem", () => {
  const validState: StoreSettings = {
    acceptingOrders: true,
    acceptOrdersOutsideHours: false,
    minOrderCents: 500000,
    shippingCents: 150000,
    paymentMethods: [
      { method: "cash", enabled: true, alias: null, holderName: null },
      { method: "transfer", enabled: true, alias: "mi.local.mp", holderName: "Juan Pérez" },
    ],
  };

  it("accepts valid store settings and updates", () => {
    expect(settingsProblem(validState)).toBeNull();

    // only cash enabled, min null, shipping 0
    const onlyCash: StoreSettings = {
      acceptingOrders: true,
      acceptOrdersOutsideHours: false,
      minOrderCents: null,
      shippingCents: 0,
      paymentMethods: [
        { method: "cash", enabled: true, alias: null, holderName: null },
        { method: "transfer", enabled: false, alias: null, holderName: null },
      ],
    };
    expect(settingsProblem(onlyCash)).toBeNull();
  });

  it("rejects state with no payment methods enabled", () => {
    const noMethods: StoreSettings = {
      ...validState,
      paymentMethods: [
        { method: "cash", enabled: false, alias: null, holderName: null },
        { method: "transfer", enabled: false, alias: null, holderName: null },
      ],
    };
    expect(settingsProblem(noMethods)?.field).toBe("paymentMethods");
  });

  it("rejects transfer enabled without alias or without holderName or too long", () => {
    const missingAlias: StoreSettings = {
      ...validState,
      paymentMethods: [
        { method: "cash", enabled: true, alias: null, holderName: null },
        { method: "transfer", enabled: true, alias: "", holderName: "Juan Pérez" },
      ],
    };
    expect(settingsProblem(missingAlias)?.field).toBe("alias");
    // A change that does not touch the payment methods does not require them (scenario 48)
    expect(settingsProblem(missingAlias, { transferDetails: false })).toBeNull();

    const aliasTooLong: StoreSettings = {
      ...validState,
      paymentMethods: [
        { method: "cash", enabled: true, alias: null, holderName: null },
        { method: "transfer", enabled: true, alias: "a".repeat(ALIAS_MAX_LENGTH + 1), holderName: "Juan Pérez" },
      ],
    };
    expect(settingsProblem(aliasTooLong)?.field).toBe("alias");

    const missingHolder: StoreSettings = {
      ...validState,
      paymentMethods: [
        { method: "cash", enabled: true, alias: null, holderName: null },
        { method: "transfer", enabled: true, alias: "mi.alias", holderName: "   " },
      ],
    };
    expect(settingsProblem(missingHolder)?.field).toBe("holderName");

    const holderTooLong: StoreSettings = {
      ...validState,
      paymentMethods: [
        { method: "cash", enabled: true, alias: null, holderName: null },
        { method: "transfer", enabled: true, alias: "mi.alias", holderName: "a".repeat(HOLDER_NAME_MAX_LENGTH + 1) },
      ],
    };
    expect(settingsProblem(holderTooLong)?.field).toBe("holderName");
  });

  it("rejects minOrder 0, negative, decimal or greater than 100.000.000", () => {
    expect(settingsProblem({ ...validState, minOrderCents: 0 })?.field).toBe("minOrderCents");
    expect(settingsProblem({ ...validState, minOrderCents: -500 })?.field).toBe("minOrderCents");
    expect(settingsProblem({ ...validState, minOrderCents: 15.5 })?.field).toBe("minOrderCents");
    expect(settingsProblem({ ...validState, minOrderCents: MAX_MONEY_CENTS + 1 })?.field).toBe("minOrderCents");
  });

  it("rejects shipping negative or greater than 100.000.000", () => {
    expect(settingsProblem({ ...validState, shippingCents: -1 })?.field).toBe("shippingCents");
    expect(settingsProblem({ ...validState, shippingCents: MAX_MONEY_CENTS + 1 })?.field).toBe("shippingCents");
  });

  it("updateSettingsSchema rejects empty body and invalid fields", () => {
    expect(updateSettingsSchema.safeParse({}).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ minOrderCents: 0 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ minOrderCents: null }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ shippingCents: 0 }).success).toBe(true);
  });
});

describe("Scenario 5: localDayRange and localDateKey", () => {
  it("resolves day range from 03:00 UTC to 03:00 UTC next day in America/Argentina/Buenos_Aires", () => {
    const [startMs, endMs] = localDayRange("2026-11-02");
    expect(new Date(startMs).toISOString()).toBe("2026-11-02T03:00:00.000Z");
    expect(new Date(endMs).toISOString()).toBe("2026-11-03T03:00:00.000Z");

    // 02:30 UTC on Nov 3 is 23:30 on Nov 2 local time
    const lateNightMs = Date.UTC(2026, 10, 3, 2, 30);
    expect(localDateKey(lateNightMs)).toBe("2026-11-02");
    expect(lateNightMs >= startMs && lateNightMs < endMs).toBe(true);
  });
});

describe("Scenario 6: buildOrderMessage", () => {
  it("matches Whatsapp.dc.html format and carries order number, items, options, subtotal, shipping, total, fulfillment, payment, customer", () => {
    const order = {
      number: 12,
      subtotalCents: 2100000,
      shippingCents: 100000,
      totalCents: 2200000,
      fulfillment: "delivery" as const,
      paymentMethod: "transfer" as const,
      customerName: "Juan",
      customerPhone: "5491155551234",
      deliveryAddress: "Av. Siempre Viva 742",
      items: [
        {
          quantity: 2,
          name: "Hamburguesa completa",
          unitPriceCents: 1050000,
          options: [
            { name: "Bacon", quantity: 2, includedQty: 1, extraPriceCents: 150000 },
            { name: "Cebolla", quantity: 0, includedQty: 1, extraPriceCents: 0 },
          ],
        },
      ],
    };

    const message = buildOrderMessage(order, {
      payment: { alias: "mi.local.mp", holderName: "Marta Gómez" },
    });

    const expected = [
      "Hola! Quiero hacer el pedido #12:",
      "",
      "2x Hamburguesa completa ($21.000)",
      "   - Bacon x2 (+$1.500)",
      "   - Sin cebolla",
      "",
      "Subtotal: $21.000",
      "Envío: $1.000",
      "Total: $22.000",
      "",
      "Envío a: Av. Siempre Viva 742",
      "Pago: Transferencia (alias mi.local.mp, titular Marta Gómez)",
      "Nombre: Juan",
      "Teléfono: 5491155551234",
    ].join("\n");

    expect(message).toBe(expected);

    // Verify it encodes with encodeURIComponent and has no unwanted control characters (only \n)
    const hasControl = Array.from(message).some((ch) => {
      const code = ch.charCodeAt(0);
      return (code < 32 && code !== 10) || code === 127;
    });
    expect(hasControl).toBe(false);
    const encoded = encodeURIComponent(message);
    expect(encoded).toContain("%0A");
  });

  it("formats takeaway and free shipping correctly", () => {
    const order = {
      number: 5,
      subtotalCents: 1500000,
      shippingCents: 0,
      totalCents: 1500000,
      fulfillment: "takeaway" as const,
      paymentMethod: "cash" as const,
      customerName: "Ana",
      customerPhone: "5491199998888",
      deliveryAddress: null,
      items: [
        {
          quantity: 1,
          name: "Pizza Napolitana",
          unitPriceCents: 1500000,
          options: [],
        },
      ],
    };

    const message = buildOrderMessage(order);
    expect(message).toContain("Retiro en el local");
    expect(message).toContain("Pago: Efectivo");
    expect(message).not.toContain("Envío:");
  });
});

describe("Scenario 7: describeOrderOptions", () => {
  it("generates option lines from snapshot options_json", () => {
    const options = [
      { name: "Bacon", quantity: 2, includedQty: 1, extraPriceCents: 150000 },
      { name: "Cebolla", quantity: 0, includedQty: 1, extraPriceCents: 0 },
    ];

    expect(describeOrderOptions(options)).toEqual(["Bacon x2 (+$1.500)", "Sin cebolla"]);
  });
});

describe("orderFiltersQuerySchema", () => {
  it("treats empty parameters as absent and coerces the numeric ones", () => {
    const parsed = orderFiltersQuerySchema.parse({ status: "", fulfillment: "delivery", limit: "20", before: "7", extra: "x" });
    expect(parsed).toEqual({ fulfillment: "delivery", limit: 20, before: 7 });
  });

  it("accepts the active status and an inclusive date range", () => {
    expect(orderFiltersQuerySchema.parse({ status: "active", from: "2026-11-02", to: "2026-11-02" })).toEqual({
      status: "active",
      from: "2026-11-02",
      to: "2026-11-02",
    });
  });

  it.each([
    { status: "flying" },
    { fulfillment: "drone" },
    { paymentMethod: "bitcoin" },
    { paymentStatus: "maybe" },
    { from: "2026-02-31" },
    { to: "2026-13-01" },
    { from: "not-a-date" },
    { from: "2026-11-03", to: "2026-11-02" },
    { limit: "0" },
    { limit: "abc" },
    { before: "1.5" },
  ])("rejects %o", (query) => {
    expect(orderFiltersQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("isCalendarDateKey", () => {
  it("accepts real days and rejects impossible or malformed ones", () => {
    expect(isCalendarDateKey("2028-02-29")).toBe(true);
    expect(isCalendarDateKey("2026-02-29")).toBe(false);
    expect(isCalendarDateKey("2026-1-01")).toBe(false);
  });
});
