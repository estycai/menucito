import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Category, Product, PublicMenu, Restaurant } from "@menucito/shared";
import { Client, captureEmails } from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;

/** A logged-in owner with a restaurant on the default (Basic) plan. */
async function owner() {
  const email = `public${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
  const client = new Client();
  await client.open(sink.last().link);
  expect(client.hasSession).toBe(true);
  const res = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug: `menu-${unique()}`,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
  });
  expect(res.status).toBe(201);
  return { client, restaurant: (await res.json()) as Restaurant };
}

async function createCategory(client: Client, name: string) {
  const res = await client.post("/api/categories", { name });
  expect(res.status).toBe(201);
  return (await res.json()) as Category;
}

async function createProduct(client: Client, categoryId: string, overrides: Record<string, unknown> = {}) {
  const res = await client.post("/api/products", {
    categoryId,
    name: "Hamburguesa completa",
    description: "Carne, queso y huevo",
    priceCents: 900_000,
    available: true,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Product;
}

const anonymous = () => new Client();
const getMenu = (slug: string) => anonymous().request(`/api/public/menus/${slug}`);

describe("GET /api/public/menus/:slug (scenarios 8 and 9)", () => {
  it("answers 200 without a session, with the minimal shape and a short cache", async () => {
    const { client, restaurant } = await owner();
    const drinks = await createCategory(client, "Bebidas");
    await createProduct(client, drinks.id, { name: "Coca 1.5L", description: "", priceCents: 350_000, available: false });

    const res = await getMenu(restaurant.slug);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await res.json()).toEqual({
      restaurant: { name: "Lo de Marta", slug: restaurant.slug, logoUrl: null },
      categories: [
        {
          name: "Bebidas",
          products: [{ name: "Coca 1.5L", description: "", priceCents: 350_000, imageUrl: null, available: false }],
        },
      ],
    } satisfies PublicMenu);
  });

  it("never exposes private fields, at any depth", async () => {
    const { client, restaurant } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    await client.request(`/api/products/${product.id}/ingredients`, {
      method: "PUT",
      body: JSON.stringify({ ingredients: [] }),
    });

    const text = await (await getMenu(restaurant.slug)).text();
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          walk(child);
        }
      }
    };
    walk(JSON.parse(text));

    expect([...keys].sort()).toEqual(
      ["available", "categories", "description", "imageUrl", "logoUrl", "name", "priceCents", "products", "restaurant", "slug"].sort(),
    );
    for (const secret of [restaurant.id, product.id, category.id, restaurant.whatsapp, "5491112345678"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("leaves out categories without products and keeps the admin order", async () => {
    const { client, restaurant } = await owner();
    const first = await createCategory(client, "Primero");
    const empty = await createCategory(client, "Vacía");
    const last = await createCategory(client, "Último");
    await createProduct(client, last.id, { name: "Flan" });
    const a = await createProduct(client, first.id, { name: "A" });
    const b = await createProduct(client, first.id, { name: "B" });
    const c = await createProduct(client, first.id, { name: "C" });
    expect(empty.id).toBeTruthy();

    await client.request(`/api/categories/${first.id}/products/order`, {
      method: "PUT",
      body: JSON.stringify({ ids: [c.id, a.id, b.id] }),
    });
    await client.request("/api/categories/order", {
      method: "PUT",
      body: JSON.stringify({ ids: [last.id, empty.id, first.id] }),
    });

    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.categories.map((category) => category.name)).toEqual(["Último", "Primero"]);
    expect(menu.categories[1]?.products.map((product) => product.name)).toEqual(["C", "A", "B"]);
  });

  it("returns the header only for a restaurant without products", async () => {
    const { restaurant } = await owner();
    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.categories).toEqual([]);
    expect(menu.restaurant.name).toBe("Lo de Marta");
  });

  it("returns the logo and photo public paths", async () => {
    const { client, restaurant } = await owner();
    const category = await createCategory(client, "Comidas");
    const product = await createProduct(client, category.id);
    await env.DB.batch([
      env.DB.prepare("UPDATE restaurants SET logo_url = ? WHERE id = ?").bind("/api/media/logos/x.webp", restaurant.id),
      env.DB.prepare("UPDATE products SET image_url = ? WHERE id = ?").bind("/api/media/products/y.webp", product.id),
    ]);

    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.restaurant.logoUrl).toBe("/api/media/logos/x.webp");
    expect(menu.categories[0]?.products[0]?.imageUrl).toBe("/api/media/products/y.webp");
  });

  it("only returns the data of the restaurant with that slug", async () => {
    const one = await owner();
    const two = await owner();
    const cat1 = await createCategory(one.client, "Solo de uno");
    await createProduct(one.client, cat1.id, { name: "Plato del uno" });
    const cat2 = await createCategory(two.client, "Solo de dos");
    await createProduct(two.client, cat2.id, { name: "Plato del dos" });

    const menu1 = await (await getMenu(one.restaurant.slug)).text();
    const menu2 = await (await getMenu(two.restaurant.slug)).text();
    expect(menu1).toContain("Plato del uno");
    expect(menu1).not.toContain("Plato del dos");
    expect(menu2).toContain("Plato del dos");
    expect(menu2).not.toContain("Plato del uno");
  });

  it("works for any plan and any status", async () => {
    const { client, restaurant } = await owner();
    const category = await createCategory(client, "Comidas");
    await createProduct(client, category.id);

    for (const [plan, status] of [
      ["pro", "active"],
      ["basic", "suspended"],
      ["pro", "anything-else"],
    ] as const) {
      await env.DB.prepare("UPDATE restaurants SET plan = ?, status = ? WHERE id = ?").bind(plan, status, restaurant.id).run();
      const res = await getMenu(restaurant.slug);
      expect(res.status).toBe(200);
      expect(((await res.json()) as PublicMenu).categories).toHaveLength(1);
    }
  });

  it.each(["no-existe-nunca", "Lo-De-Marta", "ab", "a_b", "api", "precios", "a--b"])(
    "answers 404 RESTAURANT_NOT_FOUND for the slug %s",
    async (slug) => {
      const res = await getMenu(slug);
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).not.toBe("public, max-age=60");
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("RESTAURANT_NOT_FOUND");
    },
  );
});
