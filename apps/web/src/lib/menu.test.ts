import { describe, expect, it, vi } from "vitest";
import { initials } from "./initials";
import { assetUrl, resolveMenu } from "./menu";

const API = "http://127.0.0.1:8787";
const menu = { restaurant: { name: "Lo de Marta", slug: "lo-de-marta", logoUrl: null }, categories: [] };

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

describe("initials", () => {
  it("uses the first letter of the first and last words", () => {
    expect(initials("Lo de Marta")).toBe("LM");
    expect(initials("pizzeria")).toBe("P");
    expect(initials("  ")).toBe("");
  });
});
