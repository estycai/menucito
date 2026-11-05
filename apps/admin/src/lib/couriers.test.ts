import { describe, expect, it } from "vitest";
import type { CourierFilterOption, CourierSummaryRow } from "@menucito/shared";
import {
  ASSIGN_ERROR_MESSAGES,
  assignFailureMessage,
  courierName,
  courierSummaryPath,
  courierTotals,
  filterCourierRows,
  inProgressText,
} from "./couriers";
import { ORDERS_UI_MESSAGES } from "./orders-messages";
import { ApiError } from "./restaurant";

describe("courierName", () => {
  it("joins first and last name, trimming an empty last name", () => {
    expect(courierName({ firstName: "Ana", lastName: "Gómez" })).toBe("Ana Gómez");
    expect(courierName({ firstName: "Ana", lastName: "" })).toBe("Ana");
  });
});

describe("inProgressText", () => {
  it("labels a courier with no orders on the way as free (13 design, AsignarRepartidor)", () => {
    expect(inProgressText(0)).toBe("Libre");
  });

  it("counts the orders on the way, singular and plural", () => {
    expect(inProgressText(1)).toBe("1 en camino");
    expect(inProgressText(2)).toBe("2 en camino");
  });
});

const row = (
  memberId: string | null,
  delivered: number,
  shippingCents: number,
  tipCents: number,
): CourierSummaryRow => ({
  memberId,
  firstName: memberId ? "Ana" : null,
  lastName: memberId ? "Gómez" : null,
  active: memberId ? true : null,
  delivered,
  inProgress: 0,
  shippingCents,
  tipCents,
});

describe("courier summary (13 scenario 30)", () => {
  it("builds the path of the summary of a date range", () => {
    expect(courierSummaryPath("2026-11-05", "2026-11-06")).toBe(
      "/api/couriers/summary?from=2026-11-05&to=2026-11-06&status=delivered",
    );
    expect(courierSummaryPath("2026-11-05", "2026-11-05", "sent")).toBe(
      "/api/couriers/summary?from=2026-11-05&to=2026-11-05&status=sent",
    );
  });

  const rows = [row("a", 2, 100_000, 50_000), row("b", 1, 50_000, 0), row(null, 1, 20_000, 10_000)];

  it("keeps every row with 'Todos' and only the chosen courier otherwise", () => {
    expect(filterCourierRows(rows, "")).toEqual(rows);
    expect(filterCourierRows(rows, null)).toEqual(rows);
    expect(filterCourierRows(rows, "b").map((r) => r.memberId)).toEqual(["b"]);
  });

  it("shows the chosen courier's zero row when the range has none of his deliveries (13 scenario 48)", () => {
    const options: CourierFilterOption[] = [
      { memberId: "a", firstName: "Ana", lastName: "Gómez", active: true },
      { memberId: "c", firstName: "Carla", lastName: "Paz", active: true },
    ];
    expect(filterCourierRows(rows, "c", options)).toEqual([
      { memberId: "c", firstName: "Carla", lastName: "Paz", active: true, delivered: 0, inProgress: 0, shippingCents: 0, tipCents: 0 },
    ]);
    expect(filterCourierRows(rows, "unknown", options)).toEqual([]);
  });

  it("adds the delivered orders, the shipping and the tips of the shown rows", () => {
    expect(courierTotals(rows)).toEqual({ delivered: 4, inProgress: 0, shippingCents: 170_000, tipCents: 60_000 });
    expect(courierTotals(filterCourierRows(rows, "a"))).toEqual({
      delivered: 2,
      inProgress: 0,
      shippingCents: 100_000,
      tipCents: 50_000,
    });
  });
});

describe("assignFailureMessage", () => {
  const apiError = (status: number, code: string) => new ApiError(status, code, "x");

  it("names the reason of each assignment error", () => {
    expect(assignFailureMessage(apiError(422, "VALIDATION_ERROR"))).toBe(ASSIGN_ERROR_MESSAGES.courierUnavailable);
    expect(assignFailureMessage(apiError(409, "INVALID_TRANSITION"))).toBe(ASSIGN_ERROR_MESSAGES.orderChanged);
    expect(assignFailureMessage(apiError(409, "CONCURRENT_MODIFICATION"))).toBe(ASSIGN_ERROR_MESSAGES.concurrent);
    expect(assignFailureMessage(apiError(404, "ORDER_NOT_FOUND"))).toBe(ASSIGN_ERROR_MESSAGES.orderGone);
  });

  it("keeps the generic message for anything else", () => {
    expect(assignFailureMessage(apiError(500, "INTERNAL"))).toBe(ORDERS_UI_MESSAGES.assignFailed);
    expect(assignFailureMessage(new TypeError("Failed to fetch"))).toBe(ORDERS_UI_MESSAGES.assignFailed);
  });
});
