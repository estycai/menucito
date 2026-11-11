import { describe, expect, it } from "vitest";
import type { OrderMessageTemplate, OrderSummary, WhatsappNoticeConfig } from "@menucito/shared";
import { manualNoticeUrlFor, shouldOpenManualNotice } from "./whatsapp";

const template = (targetStatus: OrderMessageTemplate["targetStatus"], body: string): OrderMessageTemplate => ({
  fulfillment: "takeaway",
  targetStatus,
  body,
});

const config = (overrides: Partial<WhatsappNoticeConfig> = {}): WhatsappNoticeConfig => ({
  available: true,
  connected: true,
  autoSend: true,
  templates: [template("preparing", "Hola {nombre}, el pedido #{numero} de {local} está listo. Total {total}")],
  ...overrides,
});

const order = (overrides: Partial<OrderSummary> = {}): OrderSummary =>
  ({
    id: "o1",
    number: 12,
    customerName: "Juan",
    customerPhone: "5491155551234",
    totalCents: 900_000,
    fulfillment: "takeaway",
    whatsappOptIn: true,
    whatsappWindowOpen: false,
    ...overrides,
  }) as OrderSummary;

describe("shouldOpenManualNotice", () => {
  it("opens when the connection, the switch, the permission and a message all line up", () => {
    expect(shouldOpenManualNotice(order(), "preparing", config())).toBe(true);
  });

  it("does not open with the window open, without permission, without a message or with the switch off", () => {
    expect(shouldOpenManualNotice(order({ whatsappWindowOpen: true }), "preparing", config())).toBe(false);
    expect(shouldOpenManualNotice(order({ whatsappOptIn: false }), "preparing", config())).toBe(false);
    expect(shouldOpenManualNotice(order(), "ready", config())).toBe(false);
    expect(shouldOpenManualNotice(order(), "preparing", config({ autoSend: false }))).toBe(false);
    expect(shouldOpenManualNotice(order(), "preparing", config({ connected: false }))).toBe(false);
    expect(shouldOpenManualNotice(order(), "preparing", config({ available: false }))).toBe(false);
  });
});

describe("manualNoticeUrlFor", () => {
  it("renders the message and encodes it for wa.me", () => {
    expect(manualNoticeUrlFor(order(), "preparing", config(), "Lo de Marta")).toBe(
      `https://wa.me/5491155551234?text=${encodeURIComponent("Hola Juan, el pedido #12 de Lo de Marta está listo. Total $9.000")}`,
    );
  });

  it("is null when the notice is not manual", () => {
    expect(manualNoticeUrlFor(order({ whatsappWindowOpen: true }), "preparing", config(), "Lo de Marta")).toBeNull();
  });
});
