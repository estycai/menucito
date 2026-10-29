import { describe, expect, it } from "vitest";
import { NAV_ITEMS, activeNavItem, documentTitle } from "./nav";

describe("NAV_ITEMS", () => {
  it("keeps the canvas order", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Resumen",
      "Mi menú",
      "Mi local",
      "Link y QR",
      "Estadísticas",
      "Plan y pagos",
    ]);
  });

  it("flags only Estadísticas as pro", () => {
    expect(NAV_ITEMS.filter((item) => item.pro).map((item) => item.label)).toEqual(["Estadísticas"]);
  });
});

describe("activeNavItem", () => {
  it.each([
    ["/", "Resumen"],
    ["/menu", "Mi menú"],
    ["/menu/products/new", "Mi menú"],
    ["/menu/products/abc123", "Mi menú"],
    ["/local", "Mi local"],
    ["/qr", "Link y QR"],
    ["/estadisticas", "Estadísticas"],
    ["/plan", "Plan y pagos"],
  ])("%s -> %s", (pathname, label) => {
    expect(activeNavItem(pathname)?.label).toBe(label);
  });

  it("matches `/` only exactly", () => {
    expect(activeNavItem("/unknown")).toBeNull();
    expect(activeNavItem("/login")).toBeNull();
  });

  it("respects the segment boundary", () => {
    expect(activeNavItem("/menuX")).toBeNull();
    expect(activeNavItem("/menu-old/x")).toBeNull();
    expect(activeNavItem("/planes")).toBeNull();
  });

  it("tolerates a trailing slash", () => {
    expect(activeNavItem("/menu/")?.label).toBe("Mi menú");
    expect(activeNavItem("/local/")?.label).toBe("Mi local");
  });

  it("returns null for unknown paths", () => {
    expect(activeNavItem("/nope")).toBeNull();
    expect(activeNavItem("")).toBeNull();
  });
});

describe("documentTitle", () => {
  it("appends the product name", () => {
    expect(documentTitle("Mi menú")).toBe("Mi menú · Menucito");
  });
});
