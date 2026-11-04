import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_TAB_PATH, LOCAL_TABS, localTabPath } from "./local-tabs";
import { activeNavItem } from "./nav";

describe("LOCAL_TABS", () => {
  it("keeps the display order", () => {
    expect(LOCAL_TABS.map((tab) => tab.label)).toEqual(["Apariencia", "General", "Horarios", "Métodos de pago", "Zonas de entrega"]);
  });

  it("gives every tab its own URL under /local", () => {
    const paths = LOCAL_TABS.map(localTabPath);
    expect(paths).toEqual(["/local/apariencia", "/local/general", "/local/horarios", "/local/pagos", "/local/zonas"]);
  });

  it("keeps Mi local active on every tab", () => {
    for (const tab of LOCAL_TABS) expect(activeNavItem(localTabPath(tab))?.label).toBe("Mi local");
  });

  it("defaults to Apariencia", () => {
    expect(DEFAULT_LOCAL_TAB_PATH).toBe("/local/apariencia");
  });
});
