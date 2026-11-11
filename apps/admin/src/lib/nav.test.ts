import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, type Access, type PermissionKey } from "@menucito/shared";
import { NAV_ITEMS, activeNavItem, canSeeNavItem, documentTitle, visibleNavItems } from "./nav";

const staff = (permissions: PermissionKey[], overrides: Partial<Access> = {}): Access => ({
  memberId: "m1",
  isOwner: false,
  isCourier: false,
  active: true,
  role: { id: "r1", name: "Cajero", active: true },
  permissions,
  ...overrides,
});
const owner = staff([...ALL_PERMISSIONS], { isOwner: true });
const labels = (access: Access | null) => visibleNavItems(access).map((item) => item.label);

describe("NAV_ITEMS", () => {
  it("keeps the canvas order", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Resumen",
      "Pedidos",
      "Clientes",
      "Cajas",
      "Repartidores",
      "Mis repartos",
      "Mi menú",
      "Mi local",
      "Usuarios",
      "Reportes",
      "Plan y pagos",
    ]);
  });

  it("flags only Reportes as pro", () => {
    expect(NAV_ITEMS.filter((item) => item.pro).map((item) => item.label)).toEqual(["Reportes"]);
  });
});

describe("activeNavItem", () => {
  it.each([
    ["/", "Resumen"],
    ["/pedidos", "Pedidos"],
    ["/clientes", "Clientes"],
    ["/clientes/mapa", "Clientes"],
    ["/cajas", "Cajas"],
    ["/cajas/historial", "Cajas"],
    ["/cajas/abc123", "Cajas"],
    ["/repartidores", "Repartidores"],
    ["/mis-repartos", "Mis repartos"],
    ["/menu", "Mi menú"],
    ["/menu/products/new", "Mi menú"],
    ["/menu/products/abc123", "Mi menú"],
    ["/local", "Mi local"],
    ["/local/general", "Mi local"],
    ["/local/horarios", "Mi local"],
    ["/local/apariencia", "Mi local"],
    ["/local/pagos", "Mi local"],
    ["/local/zonas", "Mi local"],
    ["/usuarios", "Usuarios"],
    ["/usuarios/roles", "Usuarios"],
    ["/reportes", "Reportes"],
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

describe("visibleNavItems", () => {
  it("shows the owner every section except the courier's own, Usuarios and Plan y pagos included", () => {
    expect(labels(owner)).toEqual(NAV_ITEMS.filter((item) => !item.courierOnly).map((item) => item.label));
  });

  it("shows a member their sections, and adds Mis repartos only when marked as courier (13 scenario 44)", () => {
    const courier = staff([], { isCourier: true });
    expect(labels(courier)).toEqual(["Mis repartos"]);
    // The mark adds the section on top of the role's sections, it does not replace them.
    expect(labels(staff(["orders.view"], { isCourier: true }))).toEqual(["Pedidos", "Mis repartos"]);
    expect(labels(staff(["orders.view"]))).toEqual(["Pedidos"]);
  });

  it("shows Repartidores to a member with couriers.view", () => {
    expect(labels(staff(["couriers.view"]))).toEqual(["Repartidores"]);
    // A courier with that permission sees both.
    expect(labels(staff(["couriers.view"], { isCourier: true }))).toEqual(["Repartidores", "Mis repartos"]);
  });

  it("shows a member only the sections whose view key they have", () => {
    expect(labels(staff(["orders.view", "orders.status"]))).toEqual(["Pedidos"]);
    // `qr.view` shows the QR inside Resumen: it is not a section of its own.
    expect(labels(staff(["menu.view", "qr.view"]))).toEqual(["Mi menú"]);
  });

  it("never shows Usuarios or Plan y pagos to a member, whatever the permissions", () => {
    expect(labels(staff([...ALL_PERMISSIONS]))).not.toContain("Usuarios");
    expect(labels(staff([...ALL_PERMISSIONS]))).not.toContain("Plan y pagos");
  });

  it("shows nothing without permissions, with an inactive role or member, or while access is unknown", () => {
    expect(labels(staff([]))).toEqual([]);
    expect(labels(staff(["orders.view"], { role: { id: "r1", name: "x", active: false } }))).toEqual([]);
    expect(labels(staff(["orders.view"], { active: false }))).toEqual([]);
    expect(labels(staff([...ALL_PERMISSIONS], { isOwner: true, active: false }))).toEqual([]);
    expect(labels(null)).toEqual([]);
  });

  it("canSeeNavItem follows the rule of the item", () => {
    const users = NAV_ITEMS.find((item) => item.id === "users")!;
    expect(canSeeNavItem(users, owner)).toBe(true);
    expect(canSeeNavItem(users, staff([...ALL_PERMISSIONS]))).toBe(false);

    const deliveries = NAV_ITEMS.find((item) => item.id === "deliveries")!;
    expect(canSeeNavItem(deliveries, staff([], { isCourier: true }))).toBe(true);
    expect(canSeeNavItem(deliveries, staff([...ALL_PERMISSIONS]))).toBe(false);
  });
});
