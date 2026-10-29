import { describe, expect, it, vi } from "vitest";
import { initials } from "./initials";
import { assetUrl, resolveMenu, responseFor } from "./menu";
import { toCatalog } from "./catalog";

const API = "http://127.0.0.1:8787";
const menu = {
  restaurant: { name: "Lo de Marta", slug: "lo-de-marta", logoUrl: null, delivery: true, takeaway: true },
  categories: [],
};

const respond = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }) as Response) as unknown as typeof fetch;

describe("assetUrl", () => {
  it("prefixes the API origin and tolerates a trailing slash", () => {
    expect(assetUrl(API, "/api/media/logos/a.webp")).toBe(`${API}/api/media/logos/a.webp`);
    expect(assetUrl(`${API}/`, "/api/media/logos/a.webp")).toBe(`${API}/api/media/logos/a.webp`);
  });

  it("returns null without a path", () => {
    expect(assetUrl(API, null)).toBeNull();
  });
});

describe("resolveMenu", () => {
  it.each(["api", "app", "precios", "a_b", "ab", "favicon.ico", "API", "A_B"])(
    "answers not-found for %s without calling the API",
    async (slug) => {
      const fetchImpl = respond(200, menu);
      expect(await resolveMenu(slug, API, fetchImpl)).toEqual({ status: "not-found" });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("redirects an uppercase slug to the lowercase one without calling the API", async () => {
    const fetchImpl = respond(200, menu);
    expect(await resolveMenu("Lo-De-Marta", API, fetchImpl)).toEqual({ status: "redirect", slug: "lo-de-marta" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the menu on 200", async () => {
    const fetchImpl = respond(200, menu);
    expect(await resolveMenu("lo-de-marta", API, fetchImpl)).toEqual({ status: "ok", menu });
    expect(fetchImpl).toHaveBeenCalledWith(`${API}/api/public/menus/lo-de-marta`, expect.any(Object));
  });

  it("answers not-found when the API does", async () => {
    expect(await resolveMenu("lo-de-marta", API, respond(404))).toEqual({ status: "not-found" });
  });

  it.each([500, 502, 503, 400])("answers unavailable on HTTP %i", async (status) => {
    expect(await resolveMenu("lo-de-marta", API, respond(status))).toEqual({ status: "unavailable" });
  });

  it("answers unavailable when the API cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await resolveMenu("lo-de-marta", API, fetchImpl)).toEqual({ status: "unavailable" });
  });
});

describe("responseFor", () => {
  it("caches a menu briefly and never caches an error", () => {
    expect(responseFor({ status: "ok", menu })).toEqual({ status: 200, cacheControl: "public, max-age=60" });
    expect(responseFor({ status: "not-found" })).toEqual({ status: 404, cacheControl: "no-store" });
    expect(responseFor({ status: "unavailable" })).toEqual({ status: 503, cacheControl: "no-store" });
  });
});

describe("toCatalog", () => {
  it("lists every product, sold out ones included, with only what the cart needs", () => {
    const ingredients = [{ name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_000 }];
    const catalog = toCatalog({
      ...menu,
      categories: [
        {
          name: "Comidas",
          products: [
            { id: "p1", name: "Burger", description: "x", priceCents: 900_000, imageUrl: "/a", available: true, ingredients },
            { id: "p2", name: "Flan", description: "", priceCents: 300_000, imageUrl: null, available: false, ingredients: [] },
          ],
        },
        { name: "Bebidas", products: [{ id: "p3", name: "Coca", description: "", priceCents: 1, imageUrl: null, available: true, ingredients: [] }] },
      ],
    });
    expect(catalog.map((product) => product.id)).toEqual(["p1", "p2", "p3"]);
    expect(catalog[0]).toEqual({ id: "p1", name: "Burger", priceCents: 900_000, available: true, ingredients });
    expect(catalog[1]?.available).toBe(false);
  });
});

describe("initials", () => {
  it("uses the first letter of the first and last words", () => {
    expect(initials("Lo de Marta")).toBe("LM");
    expect(initials("pizzeria")).toBe("P");
    expect(initials("  ")).toBe("");
  });
});
