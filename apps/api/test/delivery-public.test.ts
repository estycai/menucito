import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  quoteDelivery,
  type DeliveryZone,
  type DeliveryZoneList,
  type OrderDetail,
  type OrderSummary,
  type Product,
  type PublicMenu,
  type Restaurant,
} from "@menucito/shared";
import { Client, captureEmails } from "./helpers";
import type { RateLimitsRepository } from "../src/repositories/rate-limits";
import { RateLimitedError } from "../src/services/errors";
import { createRateLimiter } from "../src/services/rate-limit";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => {
  sink.restore();
  vi.restoreAllMocks();
});

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;
const sampleUuid = () => "30000000-0000-4000-8000-" + String(counter++).padStart(12, "0");

const KEY = "test-maps-key";
const SESSION = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

const STORE = { lat: -34.6037, lng: -58.3816 };
/** ~450 m east of the store: inside "Centro". */
const NEAR = { lat: -34.6037, lng: -58.3767 };
/** ~3 km north of the store: inside the "Lejos" ring. */
const FAR = { lat: -34.5767, lng: -58.3816 };
/** ~11 km away: no zone. */
const OUTSIDE = { lat: -34.5037, lng: -58.3816 };

const CENTRO = {
  name: "Centro",
  color: "#C2410C",
  active: true,
  shape: "radius",
  radiusM: 1000,
  pricing: "fixed",
  priceCents: 50_000,
  freeFromCents: 2_000_000,
};
const LEJOS = {
  name: "Lejos",
  color: "#15803D",
  active: true,
  shape: "ring",
  innerRadiusM: 1000,
  radiusM: 5000,
  pricing: "per_km",
  baseCents: 30_000,
  perKmCents: 10_000,
  minOrderCents: 1_500_000,
};

const PRICE = 900_000;

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const put = (client: Client, path: string, body: unknown) => client.request(path, { method: "PUT", body: JSON.stringify(body) });

/** An owner whose store delivers by zones (or flat), with one product at `PRICE`. */
async function store(mode: "zones" | "flat" = "zones") {
  const email = `zones${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
  const client = new Client();
  await client.open(sink.last().link);
  const res = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug: `zones-${unique()}`,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
  });
  expect(res.status).toBe(201);
  const restaurant = (await res.json()) as Restaurant;

  const location = { deliveryMode: mode, address: "Av. Corrientes 1234, CABA", addressNotes: null, ...STORE, placeId: null };
  expect((await put(client, "/api/restaurants/me/location", location)).status).toBe(200);
  const zonesRes = await put(client, "/api/restaurants/me/delivery-zones", { zones: [CENTRO, LEJOS] });
  expect(zonesRes.status).toBe(200);
  const { zones } = (await zonesRes.json()) as DeliveryZoneList;

  const category = (await (await client.post("/api/categories", { name: "Burgers" })).json()) as { id: string };
  const product = (await (
    await client.post("/api/products", { categoryId: category.id, name: "Hamburguesa", priceCents: PRICE, available: true })
  ).json()) as Product;

  return { client, restaurant, product, zones };
}

const path = (restaurant: Restaurant, rest: string) => `/api/public/menus/${restaurant.slug}${rest}`;

const quote = (restaurant: Restaurant, body: unknown) => new Client().post(path(restaurant, "/delivery-quote"), body);

/** Expected shipping of `point` with the same pure function the API uses. */
const expectedShipping = (zones: DeliveryZone[], point: { lat: number; lng: number }, subtotalCents: number) => {
  const result = quoteDelivery({ zones, origin: STORE, point, subtotalCents });
  if (!result.covered) throw new Error("not covered");
  return result.shippingCents;
};

const address = (point: { lat: number; lng: number }, overrides: Record<string, unknown> = {}) => ({
  placeId: "ChIJ-home",
  ...point,
  formattedAddress: "Av. Corrientes 1500, CABA",
  locality: "Buenos Aires",
  unit: "3B",
  betweenStreets: "Paraná y Montevideo",
  label: "home",
  ...overrides,
});

function orderBody(productId: string, quantity: number, expectedTotalCents: number, extra: Record<string, unknown> = {}) {
  return {
    items: [{ productId, quantity }],
    customer: { name: "Juan", phone: "11 5555 1234", address: null },
    fulfillment: "delivery",
    paymentMethod: "cash",
    clientOrderId: sampleUuid(),
    expectedTotalCents,
    ...extra,
  };
}

const placeOrder = (restaurant: Restaurant, body: unknown) => new Client().post(path(restaurant, "/orders"), body);

describe("public menu in zones mode", () => {
  it("publishes the mode and the store location, never the zones", async () => {
    const { restaurant } = await store();
    const menu = (await (await new Client().get(`/api/public/menus/${restaurant.slug}`)).json()) as PublicMenu;
    expect(menu.restaurant.deliveryMode).toBe("zones");
    expect(menu.restaurant.location).toEqual(STORE);
    const text = JSON.stringify(menu);
    for (const secret of ["Centro", "Lejos", "radiusM", '"zones":']) expect(text).not.toContain(secret);
  });

  it("keeps flat stores flat and without a location", async () => {
    const { restaurant } = await store("flat");
    const menu = (await (await new Client().get(`/api/public/menus/${restaurant.slug}`)).json()) as PublicMenu;
    expect(menu.restaurant.deliveryMode).toBe("flat");
    expect(menu.restaurant.location).toBeNull();
  });
});

describe("POST /api/public/menus/:slug/delivery-quote", () => {
  it("quotes a covered address with the zone's price and no zone details", async () => {
    const { restaurant, zones } = await store();
    const res = await quote(restaurant, { ...NEAR, subtotalCents: PRICE });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ covered: true, shippingCents: 50_000, minOrderCents: null });

    const far = await (await quote(restaurant, { ...FAR, subtotalCents: PRICE })).json();
    expect(far).toEqual({ covered: true, shippingCents: expectedShipping(zones, FAR, PRICE), minOrderCents: 1_500_000 });
  });

  it("applies free shipping from the zone's threshold", async () => {
    const { restaurant } = await store();
    expect(await (await quote(restaurant, { ...NEAR, subtotalCents: 2_000_000 })).json()).toMatchObject({ shippingCents: 0 });
  });

  it("answers covered: false outside every zone", async () => {
    const { restaurant } = await store();
    expect(await (await quote(restaurant, { ...OUTSIDE, subtotalCents: PRICE })).json()).toEqual({ covered: false });
  });

  it("answers 409 DELIVERY_ZONES_DISABLED to a flat store and 422 to a bad body", async () => {
    const { restaurant } = await store("flat");
    const flat = await quote(restaurant, { ...NEAR, subtotalCents: PRICE });
    expect(flat.status).toBe(409);
    expect(await errorCode(flat)).toBe("DELIVERY_ZONES_DISABLED");

    const zoned = (await store()).restaurant;
    expect((await quote(zoned, { lat: 100, lng: 0, subtotalCents: PRICE })).status).toBe(422);
    expect((await quote(zoned, { ...NEAR })).status).toBe(422);
  });

  it("answers 404 for an unknown menu", async () => {
    const res = await new Client().post("/api/public/menus/no-such-menu-xyz/delivery-quote", { ...NEAR, subtotalCents: 1 });
    expect(res.status).toBe(404);
  });
});

describe("public address search", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("searches near the store and resolves the chosen place", async () => {
    const { restaurant } = await store();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json({ suggestions: [{ placePrediction: { placeId: "ChIJ-1", structuredFormat: { mainText: { text: "Corrientes 1500" } } } }] }),
      )
      .mockResolvedValueOnce(
        json({ id: "ChIJ-1", formattedAddress: "Av. Corrientes 1500, CABA", location: { latitude: NEAR.lat, longitude: NEAR.lng } }),
      );
    const client = new Client({ GOOGLE_MAPS_SERVER_KEY: KEY });

    const search = await client.get(path(restaurant, `/places/search?q=corrientes&session=${SESSION}`));
    expect(search.status).toBe(200);
    expect(await search.json()).toEqual([{ placeId: "ChIJ-1", mainText: "Corrientes 1500", secondaryText: "" }]);
    const sent = JSON.parse(String(spy.mock.calls[0]?.[1]?.body)) as { locationBias: { circle: { center: unknown } } };
    expect(sent.locationBias.circle.center).toEqual({ latitude: STORE.lat, longitude: STORE.lng });

    const details = await client.get(path(restaurant, `/places/ChIJ-1?session=${SESSION}`));
    expect(details.status).toBe(200);
    expect(await details.json()).toMatchObject({ placeId: "ChIJ-1", lat: NEAR.lat });
  });

  it("names the address under the pin and keeps the pin's coordinates", async () => {
    const { restaurant } = await store();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({
        status: "OK",
        results: [
          {
            place_id: "ChIJ-rev",
            formatted_address: "Av. Corrientes 1510, CABA",
            types: ["street_address"],
            geometry: { location: { lat: -34.6, lng: -58.37 } },
            address_components: [{ long_name: "Buenos Aires", types: ["locality"] }],
          },
        ],
      }),
    );
    const res = await new Client({ GOOGLE_MAPS_SERVER_KEY: KEY }).get(path(restaurant, `/places/reverse?lat=${NEAR.lat}&lng=${NEAR.lng}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      placeId: "ChIJ-rev",
      formattedAddress: "Av. Corrientes 1510, CABA",
      locality: "Buenos Aires",
      ...NEAR,
    });
  });

  it("answers 404 PLACE_NOT_FOUND when nothing is under the pin", async () => {
    const { restaurant } = await store();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ status: "ZERO_RESULTS", results: [] }));
    const res = await new Client({ GOOGLE_MAPS_SERVER_KEY: KEY }).get(path(restaurant, "/places/reverse?lat=-34.6&lng=-58.4"));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("PLACE_NOT_FOUND");
  });

  it("never calls Google for a flat store", async () => {
    const { restaurant } = await store("flat");
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await new Client({ GOOGLE_MAPS_SERVER_KEY: KEY }).get(path(restaurant, `/places/search?q=x&session=${SESSION}`));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("DELIVERY_ZONES_DISABLED");
    expect(spy).not.toHaveBeenCalled();
  });

  it("validates the query", async () => {
    const { restaurant } = await store();
    const client = new Client({ GOOGLE_MAPS_SERVER_KEY: KEY });
    expect((await client.get(path(restaurant, `/places/search?session=${SESSION}`))).status).toBe(422);
    expect((await client.get(path(restaurant, "/places/reverse?lat=x&lng=1"))).status).toBe(422);
    expect((await client.get(path(restaurant, `/places/bad.id?session=${SESSION}`))).status).toBe(422);
  });

  it("allows 30 calls per IP and menu every 10 minutes, then answers 429 RATE_LIMITED", async () => {
    const { restaurant } = await store("flat");
    const ip = `203.0.113.${counter++ % 250}-${unique()}`;
    const call = (fromIp: string) =>
      new Client().request(path(restaurant, "/places/reverse?lat=-34.6&lng=-58.4"), { headers: { "cf-connecting-ip": fromIp } });

    for (let i = 0; i < 30; i++) expect((await call(ip)).status).toBe(409);
    const limited = await call(ip);
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe("RATE_LIMITED");

    // Another IP has its own budget.
    expect((await call(`${ip}-other`)).status).toBe(409);
  });
});

describe("createRateLimiter", () => {
  /** In-memory twin of the D1 repository. */
  function memoryRepo(): RateLimitsRepository {
    const rows = new Map<string, { windowStart: number; count: number }>();
    return {
      async hit(key, windowStart) {
        const row = rows.get(key);
        const count = row && row.windowStart === windowStart ? row.count + 1 : 1;
        rows.set(key, { windowStart, count });
        return count;
      },
    };
  }

  it("starts a new budget when the window rolls over", async () => {
    let now = 1_000_000;
    const limiter = createRateLimiter(memoryRepo(), { limit: 2, windowMs: 60_000 }, () => now);
    await limiter.consume("k");
    await limiter.consume("k");
    await expect(limiter.consume("k")).rejects.toBeInstanceOf(RateLimitedError);
    now += 60_000;
    await expect(limiter.consume("k")).resolves.toBeUndefined();
  });
});

describe("POST /api/public/menus/:slug/orders in zones mode", () => {
  const orderRow = (restaurantId: string) =>
    env.DB.prepare("SELECT * FROM orders WHERE restaurant_id = ? ORDER BY number DESC").bind(restaurantId).first<Record<string, unknown>>();
  const addressRows = (restaurantId: string) =>
    env.DB.prepare("SELECT * FROM customer_addresses WHERE restaurant_id = ? ORDER BY created_at, formatted_address")
      .bind(restaurantId)
      .all<Record<string, unknown>>()
      .then((r) => r.results);

  it("charges the zone's shipping and snapshots the geocoded address", async () => {
    const { client, restaurant, product, zones } = await store();
    const res = await placeOrder(restaurant, orderBody(product.id, 1, PRICE + 50_000, { delivery: address(NEAR) }));
    expect(res.status).toBe(201);
    const { order } = (await res.json()) as { order: Record<string, unknown> };
    expect(order.shippingCents).toBe(50_000);
    expect(order.deliveryAddress).toBe("Av. Corrientes 1500, CABA");
    // The public order never names the zone nor carries the coordinates.
    expect(JSON.stringify(order)).not.toContain("Centro");
    expect(order).not.toHaveProperty("deliveryLocation");

    const row = (await orderRow(restaurant.id))!;
    expect(row).toMatchObject({
      delivery_lat: NEAR.lat,
      delivery_lng: NEAR.lng,
      delivery_place_id: "ChIJ-home",
      delivery_unit: "3B",
      delivery_between_streets: "Paraná y Montevideo",
      delivery_label: "home",
      delivery_zone_id: zones[0]!.id,
      delivery_zone_name: "Centro",
    });
    expect(row.delivery_distance_m).toBeGreaterThan(400);

    // The owner sees the location in the order detail.
    const detail = (await (await client.get(`/api/orders/${row.id}`)).json()) as OrderDetail;
    expect(detail.deliveryLocation).toMatchObject({
      ...NEAR,
      unit: "3B",
      betweenStreets: "Paraná y Montevideo",
      label: "home",
      zoneName: "Centro",
    });

    // And the map point in the order list.
    const list = (await (await client.get("/api/orders")).json()) as { orders: OrderSummary[] };
    expect(list.orders[0]!.deliveryLocation).toEqual({ ...NEAR, zoneName: "Centro" });
  });

  it("prices per km in the ring and gives free shipping from the zone's threshold", async () => {
    const { restaurant, product, zones } = await store();
    const shipping = expectedShipping(zones, FAR, 2 * PRICE);
    expect((await placeOrder(restaurant, orderBody(product.id, 2, 2 * PRICE + shipping, { delivery: address(FAR) }))).status).toBe(201);

    const free = await placeOrder(restaurant, orderBody(product.id, 3, 3 * PRICE, { delivery: address(NEAR) }));
    expect(free.status).toBe(201);
    expect(((await free.json()) as { order: { shippingCents: number } }).order.shippingCents).toBe(0);
  });

  it("rejects an address outside every zone with 422 OUT_OF_COVERAGE and saves nothing", async () => {
    const { restaurant, product } = await store();
    const res = await placeOrder(restaurant, orderBody(product.id, 1, PRICE, { delivery: address(OUTSIDE) }));
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("OUT_OF_COVERAGE");
    expect(await orderRow(restaurant.id)).toBeNull();
    expect(await addressRows(restaurant.id)).toHaveLength(0);
  });

  it("uses the zone's minimum instead of the store's", async () => {
    const { restaurant, product, zones } = await store();
    await env.DB.prepare("UPDATE restaurant_settings SET min_order_cents = ? WHERE restaurant_id = ?").bind(2_000_000, restaurant.id).run();

    // "Lejos" asks for 1.500.000: one unit is below it, two units pass although below the store's 2.000.000.
    const below = await placeOrder(restaurant, orderBody(product.id, 1, PRICE + expectedShipping(zones, FAR, PRICE), { delivery: address(FAR) }));
    expect(below.status).toBe(409);
    expect(await errorCode(below)).toBe("BELOW_MINIMUM");
    const shipping = expectedShipping(zones, FAR, 2 * PRICE);
    expect((await placeOrder(restaurant, orderBody(product.id, 2, 2 * PRICE + shipping, { delivery: address(FAR) }))).status).toBe(201);

    // "Centro" has no minimum of its own, so the store's applies.
    const centro = await placeOrder(restaurant, orderBody(product.id, 1, PRICE + 50_000, { delivery: address(NEAR) }));
    expect(await errorCode(centro)).toBe("BELOW_MINIMUM");
  });

  it("asks for a geocoded address (409 DELIVERY_LOCATION_REQUIRED) when only a typed one arrives", async () => {
    const { restaurant, product } = await store();
    const res = await placeOrder(
      restaurant,
      orderBody(product.id, 1, PRICE, { customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" } }),
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("DELIVERY_LOCATION_REQUIRED");
  });

  it("keeps takeaway orders free of delivery data", async () => {
    const { restaurant, product } = await store();
    const res = await placeOrder(restaurant, orderBody(product.id, 1, PRICE, { fulfillment: "takeaway", delivery: address(NEAR) }));
    expect(res.status).toBe(201);
    const row = (await orderRow(restaurant.id))!;
    expect(row.delivery_lat).toBeNull();
    expect(row.delivery_zone_id).toBeNull();
    expect(await addressRows(restaurant.id)).toHaveLength(0);
  });

  it("saves each address once per customer and refreshes it when used again", async () => {
    const { restaurant, product } = await store();
    const total = PRICE + 50_000;

    expect((await placeOrder(restaurant, orderBody(product.id, 1, total, { delivery: address(NEAR) }))).status).toBe(201);
    // Same place, new floor and no label: the row is refreshed, the label kept.
    expect(
      (await placeOrder(restaurant, orderBody(product.id, 1, total, { delivery: address(NEAR, { unit: "5A", label: null }) }))).status,
    ).toBe(201);

    let rows = await addressRows(restaurant.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ place_id: "ChIJ-home", unit: "5A", label: "home", lat: NEAR.lat });
    expect(Number(rows[0]!.last_used_at)).toBeGreaterThanOrEqual(Number(rows[0]!.created_at));

    // Without a place id, text and unit identify the address.
    const pinned = address(NEAR, { placeId: null, formattedAddress: "Pasaje sin nombre 12", unit: null, label: "work" });
    expect((await placeOrder(restaurant, orderBody(product.id, 1, total, { delivery: pinned }))).status).toBe(201);
    rows = await addressRows(restaurant.id);
    expect(rows).toHaveLength(2);

    const customer = await env.DB.prepare("SELECT id FROM customers WHERE restaurant_id = ?").bind(restaurant.id).first<{ id: string }>();
    expect(rows.every((row) => row.customer_id === customer!.id)).toBe(true);
    expect(rows.find((row) => row.place_id === null)).toMatchObject({ formatted_address: "Pasaje sin nombre 12", label: "work" });
  });

  it("keeps addresses per customer: another phone gets its own row", async () => {
    const { restaurant, product } = await store();
    const total = PRICE + 50_000;
    await placeOrder(restaurant, orderBody(product.id, 1, total, { delivery: address(NEAR) }));
    await placeOrder(
      restaurant,
      orderBody(product.id, 1, total, { delivery: address(NEAR), customer: { name: "Ana", phone: "11 4444 1234", address: null } }),
    );
    expect(await addressRows(restaurant.id)).toHaveLength(2);
  });
});

describe("POST /api/public/menus/:slug/orders in flat mode", () => {
  it("ignores the geocoded address: flat shipping, typed address, no snapshot", async () => {
    const { client, restaurant, product } = await store("flat");
    await client.request("/api/restaurants/me/settings", { method: "PATCH", body: JSON.stringify({ shippingCents: 150_000 }) });

    const res = await placeOrder(
      restaurant,
      orderBody(product.id, 1, PRICE + 150_000, {
        customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
        delivery: address(OUTSIDE),
      }),
    );
    expect(res.status).toBe(201);
    const { order } = (await res.json()) as { order: { deliveryAddress: string; shippingCents: number } };
    expect(order).toMatchObject({ deliveryAddress: "Calle 1", shippingCents: 150_000 });

    const row = await env.DB.prepare("SELECT delivery_lat, delivery_zone_name FROM orders WHERE restaurant_id = ?")
      .bind(restaurant.id)
      .first();
    expect(row).toEqual({ delivery_lat: null, delivery_zone_name: null });
    const saved = await env.DB.prepare("SELECT count(*) AS n FROM customer_addresses WHERE restaurant_id = ?")
      .bind(restaurant.id)
      .first<{ n: number }>();
    expect(saved?.n).toBe(0);
  });

  it("takes the geocoded text when no address was typed (page opened in zones mode)", async () => {
    const { restaurant, product } = await store("flat");
    const res = await placeOrder(restaurant, orderBody(product.id, 1, PRICE, { delivery: address(NEAR) }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { order: { deliveryAddress: string } }).order.deliveryAddress).toBe("Av. Corrientes 1500, CABA");
  });
});
