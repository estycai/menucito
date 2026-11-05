import { describe, expect, it } from "vitest";
import { activeNavItem } from "./nav";
import { DEFAULT_USERS_TAB_PATH, USERS_TABS, usersTabPath } from "./users-tabs";

describe("USERS_TABS", () => {
  it("has the two tabs of the spec, in order, each with its own URL", () => {
    expect(USERS_TABS.map((tab) => tab.label)).toEqual(["Usuarios", "Roles y permisos"]);
    expect(USERS_TABS.map(usersTabPath)).toEqual(["/usuarios/lista", "/usuarios/roles"]);
  });

  it("keeps Usuarios active in the menu on every tab and defaults to the list", () => {
    for (const tab of USERS_TABS) expect(activeNavItem(usersTabPath(tab))?.label).toBe("Usuarios");
    expect(DEFAULT_USERS_TAB_PATH).toBe("/usuarios/lista");
  });
});
