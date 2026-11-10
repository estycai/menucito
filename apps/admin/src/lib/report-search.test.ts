import { describe, expect, it } from "vitest";
import { normalizeSearch } from "./report-search";

describe("normalizeSearch", () => {
  it("ignores case, accents and the edges", () => {
    expect(normalizeSearch("  Hamburguesa ")).toBe("hamburguesa");
    expect(normalizeSearch("Café")).toBe("cafe");
    expect(normalizeSearch("Sin categoría")).toBe("sin categoria");
  });

  it("matches a term against the name and the category", () => {
    const haystack = normalizeSearch("Pizza Napolitana");
    expect(haystack.includes(normalizeSearch("NAPOLITANA"))).toBe(true);
    expect(haystack.includes(normalizeSearch("empanada"))).toBe(false);
  });
});
