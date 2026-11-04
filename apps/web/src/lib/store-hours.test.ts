import { describe, expect, it } from "vitest";
import type { HoursSlot } from "@menucito/shared";
import { orderHoursNotice } from "./store-hours";

// 2026-11-02 is a Monday; Argentina is UTC-3.
const at = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

const dinner: HoursSlot = { weekday: 1, opensAt: 19 * 60, closesAt: 60, fulfillment: "all" };
const tuesdayLunch: HoursSlot = { weekday: 2, opensAt: 12 * 60, closesAt: 15 * 60, fulfillment: "takeaway" };
const slots = [dinner, tuesdayLunch];

describe("orderHoursNotice", () => {
  it("says nothing for a store without hours or while open", () => {
    expect(orderHoursNotice({ slots: [], acceptOrdersOutsideHours: false }, at("2026-11-02T10:00:00"), "")).toEqual({
      canOrder: true,
      text: null,
    });
    expect(orderHoursNotice({ slots, acceptOrdersOutsideHours: false }, at("2026-11-03T00:30:00"), "delivery")).toEqual({
      canOrder: true,
      text: null,
    });
  });

  it("blocks the order while closed and says when it opens", () => {
    expect(orderHoursNotice({ slots, acceptOrdersOutsideHours: false }, at("2026-11-02T10:00:00"), "")).toEqual({
      canOrder: false,
      text: "Cerrado ahora. Abrimos hoy a las 19:00.",
    });
    expect(orderHoursNotice({ slots, acceptOrdersOutsideHours: false }, at("2026-11-03T02:00:00"), "takeaway").text).toBe(
      "Cerrado ahora. Abrimos hoy a las 12:00.",
    );
    expect(orderHoursNotice({ slots, acceptOrdersOutsideHours: false }, at("2026-11-03T02:00:00"), "delivery").text).toBe(
      "Cerrado ahora. Abrimos el lunes a las 19:00.",
    );
    expect(orderHoursNotice({ slots: [dinner], acceptOrdersOutsideHours: false }, at("2026-11-01T10:00:00"), "").text).toBe(
      "Cerrado ahora. Abrimos mañana a las 19:00.",
    );
  });

  it("takes the order while closed when the store accepts orders outside its hours", () => {
    expect(orderHoursNotice({ slots, acceptOrdersOutsideHours: true }, at("2026-11-02T10:00:00"), "takeaway")).toEqual({
      canOrder: true,
      text: "Estamos cerrados. Tu pedido se va a preparar cuando abramos, hoy a las 19:00.",
    });
  });

  it("omits the time when no slot takes the chosen fulfillment", () => {
    const takeawayOnly = [tuesdayLunch];
    expect(orderHoursNotice({ slots: takeawayOnly, acceptOrdersOutsideHours: false }, at("2026-11-02T10:00:00"), "delivery")).toEqual({
      canOrder: false,
      text: "Cerrado ahora.",
    });
    expect(orderHoursNotice({ slots: takeawayOnly, acceptOrdersOutsideHours: true }, at("2026-11-02T10:00:00"), "delivery").text).toBe(
      "Estamos cerrados. Tu pedido se va a preparar cuando abramos.",
    );
  });
});
