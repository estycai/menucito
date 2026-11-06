import { describe, expect, it } from "vitest";
import type { OrderDetail } from "@menucito/shared";
import { ordersToCsv } from "../src/services/orders-csv";

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "o1",
    number: 1,
    status: "new",
    paymentStatus: "pending",
    fulfillment: "takeaway",
    paymentMethod: "cash",
    splitCashCents: null,
    cashTenderedCents: null,
    paymentBreakdown: { cashCents: 900_000, transferCents: 0, tenderedCents: null, changeCents: null },
    customerName: "Juan",
    customerPhone: "5491155551234",
    source: "web",
    deliveryAddress: null,
    deliveryLocation: null,
    notes: null,
    subtotalCents: 900_000,
    shippingCents: 0,
    discountCents: 0,
    tipCents: 0,
    totalCents: 900_000,
    items: [],
    createdAt: Date.UTC(2026, 10, 2, 15, 0),
    updatedAt: Date.UTC(2026, 10, 2, 15, 0),
    courier: null,
    sentAt: null,
    deliveredAt: null,
    paidAt: null,
    cashSessionId: null,
    settledAt: null,
    ...overrides,
  };
}

const dataRow = (csv: string) => csv.split("\r\n")[1]!;

describe("ordersToCsv (scenario 37)", () => {
  it.each(["=1+1", "+1", "-1", "@SUM", "\tcmd", "\rcmd"])("neutralises a cell starting with %j", (name) => {
    const row = dataRow(ordersToCsv([order({ customerName: name })]));
    const cells = row.split(";").map((cell) => cell.replace(/^"|"$/g, ""));
    expect(cells[10]).toBe(`'${name}`);
  });

  it("separates the options of an item with a comma and a space", () => {
    const row = dataRow(
      ordersToCsv([
        order({
          items: [
            {
              id: "i1",
              orderId: "o1",
              productId: null,
              position: 0,
              name: "Hamburguesa",
              unitPriceCents: 1_050_000,
              quantity: 1,
              notes: null,
              options: [
                { name: "Bacon", quantity: 2, includedQty: 1, extraPriceCents: 150_000 },
                { name: "Cebolla", quantity: 0, includedQty: 1, extraPriceCents: 0 },
              ],
            },
          ],
        }),
      ]),
    );
    expect(row).toContain("1x Hamburguesa (Bacon x2 (+$1.500), Sin cebolla)");
  });

  it("adds Origen and Comentario at the end of the row", () => {
    const csv = ordersToCsv([order({ source: "whatsapp", notes: "timbre 2B" })]);
    const [headers, row] = csv.slice(1).split("\r\n");
    expect(headers!.split(";").slice(-2)).toEqual(["Origen", "Comentario"]);
    expect(row!.split(";").slice(-2)).toEqual(["WhatsApp", "timbre 2B"]);
  });
});
