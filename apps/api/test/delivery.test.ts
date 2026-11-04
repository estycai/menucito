import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeliveryZoneList, Restaurant, StoreLocation } from "@menucito/shared";
import { Client, captureEmails } from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;

async function loggedInClient() {
  const email = `delivery${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
  const client = new Client();
  await client.open(sink.last().link);
  return client;
}

async function ownerWithRestaurant() {
  const client = await loggedInClient();
  const res = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug: `delivery-${unique()}`,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
  });
  expect(res.status).toBe(201);
  return { client, restaurant: (await res.json()) as Restaurant };
}

const put = (client: Client, path: string, body: unknown) =>
  client.request(path, { method: "PUT", body: JSON.stringify(body) });

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

const LOCATION = {
  address: "Av. Corrientes 1234, C1043 CABA, Argentina",
  addressNotes: "Timbre 2B",
  lat: -34.6037,
  lng: -58.3816,
  placeId: "ChIJ-corrientes",
};

const radiusZone = { name: "Centro", color: "#c2410c", active: true, shape: "radius", radiusM: 2000, pricing: "fixed", priceCents: 50000 };
const ringZone = {
  name: "Anillo",
  color: "#15803D",
  active: false,
  shape: "ring",
  innerRadiusM: 2000,
  radiusM: 5000,
  pricing: "per_km",
  baseCents: 30000,
  perKmCents: 10000,
  minShippingCents: 40000,
  maxShippingCents: null,
  minOrderCents: 1_000_000,
  freeFromCents: 5_000_000,
};
const polygonZone = {
  name: "Barrio",
  color: "#1D4ED8",
  active: true,
  shape: "polygon",
  polygon: [
    [-34.6, -58.38],
    [-34.61, -58.38],
    [-34.61, -58.39],
  ],
  pricing: "fixed",
  priceCents: 0,
};

describe("authentication", () => {
  it.each(["/api/restaurants/me/location", "/api/restaurants/me/delivery-zones"])("GET %s answers 401 without a session", async (path) => {
    const res = await new Client().get(path);
    expect(res.status).toBe(401);
  });

  it("answers 404 RESTAURANT_NOT_FOUND to an owner without a restaurant", async () => {
    const client = await loggedInClient();
    const res = await client.get("/api/restaurants/me/location");
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("RESTAURANT_NOT_FOUND");
  });
});

describe("/api/restaurants/me/location", () => {
  it("starts flat and without a location", async () => {
    const { client } = await ownerWithRestaurant();
    const res = await client.get("/api/restaurants/me/location");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deliveryMode: "flat", address: null, addressNotes: null, lat: null, lng: null, placeId: null });
  });

  it("saves the location, then switches to zones", async () => {
    const { client } = await ownerWithRestaurant();

    const saved = await put(client, "/api/restaurants/me/location", { deliveryMode: "flat", ...LOCATION });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ deliveryMode: "flat", ...LOCATION });

    const zones = await put(client, "/api/restaurants/me/location", { deliveryMode: "zones", ...LOCATION });
    expect(((await zones.json()) as StoreLocation).deliveryMode).toBe("zones");
    expect(await (await client.get("/api/restaurants/me/location")).json()).toEqual({ deliveryMode: "zones", ...LOCATION });
  });

  it("leaves the other settings untouched", async () => {
    const { client } = await ownerWithRestaurant();
    await client.request("/api/restaurants/me/settings", { method: "PATCH", body: JSON.stringify({ shippingCents: 150000 }) });
    await put(client, "/api/restaurants/me/location", { deliveryMode: "flat", ...LOCATION });

    const settings = (await (await client.get("/api/restaurants/me/settings")).json()) as { shippingCents: number };
    expect(settings.shippingCents).toBe(150000);
  });

  it("rejects zones without a location and a partial location with 422", async () => {
    const { client } = await ownerWithRestaurant();

    const noLocation = await put(client, "/api/restaurants/me/location", { deliveryMode: "zones" });
    expect(noLocation.status).toBe(422);
    expect(await errorCode(noLocation)).toBe("VALIDATION_ERROR");

    const partial = await put(client, "/api/restaurants/me/location", { deliveryMode: "flat", address: "Corrientes 1234" });
    expect(partial.status).toBe(422);

    expect(((await (await client.get("/api/restaurants/me/location")).json()) as StoreLocation).address).toBeNull();
  });
});

describe("/api/restaurants/me/delivery-zones", () => {
  it("starts empty", async () => {
    const { client } = await ownerWithRestaurant();
    expect(await (await client.get("/api/restaurants/me/delivery-zones")).json()).toEqual({ zones: [] });
  });

  it("stores every shape and pricing, in the order sent", async () => {
    const { client } = await ownerWithRestaurant();
    const res = await put(client, "/api/restaurants/me/delivery-zones", { zones: [radiusZone, ringZone, polygonZone] });
    expect(res.status).toBe(200);
    const { zones } = (await res.json()) as DeliveryZoneList;

    expect(zones.map((zone) => [zone.name, zone.sort])).toEqual([
      ["Centro", 0],
      ["Anillo", 1],
      ["Barrio", 2],
    ]);
    expect(zones[0]).toEqual({
      ...radiusZone,
      color: "#C2410C",
      id: zones[0]?.id,
      sort: 0,
      minOrderCents: null,
      freeFromCents: null,
    });
    expect(zones[1]).toEqual({ ...ringZone, id: zones[1]?.id, sort: 1 });
    expect(zones[2]).toEqual({ ...polygonZone, id: zones[2]?.id, sort: 2, minOrderCents: null, freeFromCents: null });

    expect(await (await client.get("/api/restaurants/me/delivery-zones")).json()).toEqual({ zones });
  });

  it("keeps the ids sent back, reorders, changes shape and deletes the missing ones", async () => {
    const { client } = await ownerWithRestaurant();
    const first = (await (await put(client, "/api/restaurants/me/delivery-zones", { zones: [radiusZone, ringZone] })).json()) as DeliveryZoneList;
    const [centro, anillo] = first.zones;

    const res = await put(client, "/api/restaurants/me/delivery-zones", {
      zones: [{ ...polygonZone, id: centro?.id, name: "Centro" }],
    });
    const { zones } = (await res.json()) as DeliveryZoneList;

    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ id: centro?.id, name: "Centro", shape: "polygon", sort: 0 });
    expect(zones[0]).not.toHaveProperty("radiusM");
    expect(zones.some((zone) => zone.id === anillo?.id)).toBe(false);
  });

  it("never lets an owner overwrite another store's zone", async () => {
    const victim = await ownerWithRestaurant();
    const victimZones = (await (await put(victim.client, "/api/restaurants/me/delivery-zones", { zones: [radiusZone] })).json()) as DeliveryZoneList;
    const victimId = victimZones.zones[0]?.id;

    const attacker = await ownerWithRestaurant();
    const res = await put(attacker.client, "/api/restaurants/me/delivery-zones", { zones: [{ ...radiusZone, id: victimId, name: "Robada" }] });
    const { zones } = (await res.json()) as DeliveryZoneList;
    expect(zones[0]?.id).not.toBe(victimId);

    const after = (await (await victim.client.get("/api/restaurants/me/delivery-zones")).json()) as DeliveryZoneList;
    expect(after.zones[0]).toMatchObject({ id: victimId, name: "Centro" });
  });

  it("gives a repeated id to only the first zone", async () => {
    const { client } = await ownerWithRestaurant();
    const first = (await (await put(client, "/api/restaurants/me/delivery-zones", { zones: [radiusZone] })).json()) as DeliveryZoneList;
    const id = first.zones[0]?.id;

    const res = await put(client, "/api/restaurants/me/delivery-zones", { zones: [{ ...radiusZone, id }, { ...ringZone, id }] });
    const { zones } = (await res.json()) as DeliveryZoneList;
    expect(zones[0]?.id).toBe(id);
    expect(zones[1]?.id).not.toBe(id);
  });

  it("rejects an invalid zone with 422 and keeps the stored list", async () => {
    const { client } = await ownerWithRestaurant();
    await put(client, "/api/restaurants/me/delivery-zones", { zones: [radiusZone] });

    const res = await put(client, "/api/restaurants/me/delivery-zones", {
      zones: [radiusZone, { ...ringZone, innerRadiusM: 9000 }],
    });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("VALIDATION_ERROR");

    const { zones } = (await (await client.get("/api/restaurants/me/delivery-zones")).json()) as DeliveryZoneList;
    expect(zones).toHaveLength(1);
  });

  it("rejects more than 20 zones", async () => {
    const { client } = await ownerWithRestaurant();
    const res = await put(client, "/api/restaurants/me/delivery-zones", { zones: Array.from({ length: 21 }, () => radiusZone) });
    expect(res.status).toBe(422);
  });

  it("clears the list with an empty array", async () => {
    const { client } = await ownerWithRestaurant();
    await put(client, "/api/restaurants/me/delivery-zones", { zones: [radiusZone, ringZone] });
    const res = await put(client, "/api/restaurants/me/delivery-zones", { zones: [] });
    expect(await res.json()).toEqual({ zones: [] });
  });
});
