import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  filtersFromSearch,
  presetOfRange,
  searchWithFilters,
  searchWithTab,
  tabFromSearch,
  withDefaultRange,
} from "./report-filters";

const NOW = new Date("2026-11-10T15:00:00Z");

describe("Reports URL filters", () => {
  it("reads the Spanish names of the URL and ignores invalid values", () => {
    const search = new URLSearchParams(
      "desde=2026-11-01&hasta=2026-11-10&turno=690-930&modo=delivery&medio=split&origen=local&repartidor=m1&tab=evolucion",
    );
    expect(filtersFromSearch(search)).toEqual({
      from: "2026-11-01",
      to: "2026-11-10",
      shift: "690-930",
      fulfillment: "delivery",
      payment: "split",
      source: "local",
      courier: "m1",
    });
    expect(tabFromSearch(search)).toBe("evolucion");

    expect(filtersFromSearch(new URLSearchParams("desde=2026-02-31&modo=pickup&medio=bitcoin&origen=phone"))).toEqual({
      from: undefined,
      to: undefined,
      shift: undefined,
      fulfillment: undefined,
      payment: undefined,
      source: undefined,
      courier: undefined,
    });
  });

  it("writes the filters without losing the tab and drops the empty ones", () => {
    const search = searchWithTab(new URLSearchParams("tab=evolucion&turno=690-930&desde=2026-11-01"), "evolucion");
    const next = searchWithFilters(search, {
      from: "2026-11-01",
      to: "2026-11-10",
      shift: "690-930",
      fulfillment: undefined,
      payment: "cash",
      source: undefined,
      courier: undefined,
    });
    expect(next.toString()).toBe("tab=evolucion&turno=690-930&desde=2026-11-01&hasta=2026-11-10&medio=cash");
  });

  it("recognizes the shortcuts and counts the active filters", () => {
    expect(presetOfRange({ from: "2026-11-04", to: "2026-11-10" }, NOW)).toBe("7d");
    expect(presetOfRange({ from: "2026-10-01", to: "2026-11-10" }, NOW)).toBe("quarter");
    expect(presetOfRange({ from: "2026-11-02", to: "2026-11-10" }, NOW)).toBeNull();
    expect(activeFilterCount({ payment: "cash", source: "web" })).toBe(2);
    expect(activeFilterCount({ payment: "cash", source: "web" }, ["stats.f.payment"])).toBe(1);
    expect(activeFilterCount({})).toBe(0);
  });
});

describe("withDefaultRange", () => {
  const now = new Date("2026-11-10T15:00:00Z");
  it("uses today when the URL has no range, so Hoy is the active shortcut", () => {
    expect(withDefaultRange({ source: "web" }, true, now)).toEqual({ source: "web", from: "2026-11-10", to: "2026-11-10" });
    expect(withDefaultRange({ from: "2026-11-01", to: "2026-11-05" }, true, now)).toEqual({ from: "2026-11-01", to: "2026-11-05" });
  });
  it("drops the range without the date filter", () => {
    expect(withDefaultRange({ from: "2026-11-01", to: "2026-11-05" }, false, now)).toEqual({ from: undefined, to: undefined });
  });
});
