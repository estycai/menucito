import { describe, expect, it } from "vitest";
import { GRANTED_REPORT_PERMISSION_KEYS, type SalesReport } from "@menucito/shared";
import { errorCode, ownerWithRestaurant, staffClient } from "./helpers";
import { RANGE, addCategory, addProduct, proStore, report, seed } from "./report-fixtures";

const sales = (client: Parameters<typeof report>[0], values: Record<string, string | undefined> = RANGE) =>
  report<SalesReport>(client, "sales", values);

describe("16b sales: products, categories and addons", () => {
  it("counts units and revenue per product without counting the extras twice", async () => {
    const store = await proStore();
    const pizzas = await addCategory(store, "Pizzas");
    const pizza = await addProduct(store, "Pizza", {
      priceCents: 50_000,
      categoryId: pizzas,
      ingredients: [{ name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 10_000 }],
    });
    await seed(store, { date: "2026-06-02", quantity: 2 });
    await seed(store, { date: "2026-06-02", productId: pizza, choices: { Bacon: 2 } });

    const { widgets } = await sales(store.client);

    expect(widgets.products).toEqual([
      { productId: store.productId, category: "Burgers", name: "Burger", units: 2, revenueCents: 200_000 },
      { productId: pizza, category: "Pizzas", name: "Pizza", units: 1, revenueCents: 50_000 },
    ]);
    expect(widgets.categories?.rows).toEqual([
      { category: "Burgers", products: 1, units: 2, revenueCents: 200_000, percent: 80 },
      { category: "Pizzas", products: 1, units: 1, revenueCents: 50_000, percent: 20 },
    ]);
    expect(widgets.categories?.total).toEqual({
      category: "Total",
      products: 2,
      units: 3,
      revenueCents: 250_000,
      percent: 100,
    });
    expect(widgets.top?.byUnits).toEqual([
      { name: "Burger", units: 2, revenueCents: 200_000 },
      { name: "Pizza", units: 1, revenueCents: 50_000 },
    ]);
    expect(widgets.top?.byRevenue).toEqual(widgets.top?.byUnits);
    expect(widgets.addons).toEqual([{ name: "Bacon", units: 1, revenueCents: 10_000 }]);
  });

  it("groups a deleted product by its name under Sin categoría", async () => {
    const store = await proStore();
    const category = await addCategory(store, "Borrados");
    const ghost = await addProduct(store, "Fantasma", { categoryId: category });
    await seed(store, { date: "2026-06-02", productId: ghost, quantity: 3 });

    expect((await store.client.delete(`/api/products/${ghost}`)).status).toBe(204);

    const { widgets } = await sales(store.client);
    expect(widgets.products).toEqual([
      { productId: null, category: "Sin categoría", name: "Fantasma", units: 3, revenueCents: 300_000 },
    ]);
    expect(widgets.categories?.rows).toEqual([
      { category: "Sin categoría", products: 1, units: 3, revenueCents: 300_000, percent: 100 },
    ]);
  });

  it("uses the current category of the product", async () => {
    const store = await proStore();
    const category = await addCategory(store, "Viejas");
    const product = await addProduct(store, "Milanesa", { categoryId: category });
    await seed(store, { date: "2026-06-02", productId: product });

    expect((await store.client.patch(`/api/categories/${category}`, { name: "Nuevas" })).status).toBe(200);

    const { widgets } = await sales(store.client);
    expect(widgets.products?.[0]).toMatchObject({ name: "Milanesa", category: "Nuevas" });
  });

  it("counts as addons only what goes above what is included", async () => {
    const store = await proStore();
    const product = await addProduct(store, "Milanesa", {
      ingredients: [
        { name: "Queso", includedQty: 2, minQty: 0, maxQty: 4, extraPriceCents: 5_000 },
        { name: "Cebolla", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 0 },
      ],
    });
    await seed(store, { date: "2026-06-02", productId: product, quantity: 2, choices: { Queso: 3, Cebolla: 0 } });

    const { widgets } = await sales(store.client);
    expect(widgets.addons).toEqual([{ name: "Queso", units: 2, revenueCents: 10_000 }]);
    expect(widgets.products?.[0]?.revenueCents).toBe(200_000);
  });
});

describe("16b sales: permissions", () => {
  it("sends only the units order, the units percentages and no cents without amounts", async () => {
    const store = await proStore();
    const pizzas = await addCategory(store, "Pizzas");
    const pizza = await addProduct(store, "Pizza", { categoryId: pizzas });
    await seed(store, { date: "2026-06-02", quantity: 3 });
    await seed(store, { date: "2026-06-02", productId: pizza });
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", ...GRANTED_REPORT_PERMISSION_KEYS.filter((key) => key !== "stats.amounts")],
    });

    const { widgets } = await sales(staff.client);
    expect(JSON.stringify(widgets)).not.toContain("Cents");
    expect(widgets.top?.byRevenue).toBeUndefined();
    expect(widgets.top?.byUnits?.map((row) => row.name)).toEqual(["Burger", "Pizza"]);
    expect(widgets.categories?.rows.map((row) => row.percent)).toEqual([75, 25]);
    expect(widgets.products?.every((row) => row.revenueCents === undefined)).toBe(true);
  });

  it("omits the blocks the role lacks and refuses the tab or the Basic plan", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02" });
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", "stats.tab.sales", "stats.f.date", "stats.w.sales.products"],
    });
    expect(Object.keys((await sales(staff.client)).widgets)).toEqual(["products"]);

    const withoutTab = await staffClient({ owner: store, permissions: ["stats.view"] });
    const forbidden = await withoutTab.client.get("/api/reports/sales");
    expect(forbidden.status).toBe(403);
    expect(await errorCode(forbidden)).toBe("FORBIDDEN");

    const basic = await ownerWithRestaurant();
    const res = await basic.client.get("/api/reports/sales");
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("PLAN_FEATURE");
  });
});
