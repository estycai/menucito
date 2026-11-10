import { describe, expect, it } from "vitest";
import type { ReportTrendPoint } from "@menucito/shared";
import { buildTrendSeries } from "./report-series";

const point = (date: string, billedCents: number, orders: number, productsCents = billedCents): ReportTrendPoint => ({
  date,
  billedCents,
  orders,
  productsCents,
  deliveryCents: billedCents,
  deliveryOrders: orders,
  takeawayCents: 0,
  takeawayOrders: 0,
});

describe("buildTrendSeries", () => {
  it("groups by day with the gaps in zero and totals the period", () => {
    const series = buildTrendSeries(
      {
        days: [point("2026-06-01", 100_000, 2), point("2026-06-03", 300_000, 1)],
        previous: [],
        year: [],
      },
      { from: "2026-06-01", to: "2026-06-03" },
      "day",
      "billed",
    );
    expect(series.labels).toEqual(["01/06", "02/06", "03/06"]);
    expect(series.current).toEqual([100_000, 0, 300_000]);
    expect(series.total).toBe(400_000);
  });

  it("computes the ticket of the period, not the sum of the daily tickets", () => {
    const series = buildTrendSeries(
      {
        days: [point("2026-06-01", 100_000, 2, 80_000), point("2026-06-02", 300_000, 1, 300_000)],
        previous: [],
        year: [],
      },
      { from: "2026-06-01", to: "2026-06-02" },
      "day",
      "ticket",
    );
    expect(series.current).toEqual([40_000, 300_000]);
    expect(series.total).toBe(Math.round(380_000 / 3));
  });

  it("groups weeks from Monday and months", () => {
    const week = buildTrendSeries(
      {
        days: [point("2026-06-01", 100, 1), point("2026-06-08", 200, 2)],
        previous: [],
        year: [],
      },
      { from: "2026-06-01", to: "2026-06-14" },
      "week",
      "orders",
    );
    expect(week.labels).toEqual(["Sem 01/06", "Sem 08/06"]);
    expect(week.current).toEqual([1, 2]);

    const month = buildTrendSeries(
      {
        days: [point("2026-06-15", 100, 1), point("2026-07-02", 200, 2)],
        previous: [],
        year: [],
      },
      { from: "2026-06-01", to: "2026-07-31" },
      "month",
      "orders",
    );
    expect(month.labels).toEqual(["06/2026", "07/2026"]);
    expect(month.current).toEqual([1, 2]);
  });
});
