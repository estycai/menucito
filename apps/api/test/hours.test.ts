import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HoursList, PublicMenu, Restaurant, StoreSettings } from "@menucito/shared";
import { Client, captureEmails } from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;

async function loggedInClient() {
  const email = `hours${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
  const client = new Client();
  await client.open(sink.last().link);
  return client;
}

async function ownerWithRestaurant() {
  const client = await loggedInClient();
  const res = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug: `hours-${unique()}`,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
  });
  expect(res.status).toBe(201);
  return { client, restaurant: (await res.json()) as Restaurant };
}

const put = (client: Client, body: unknown) => client.request("/api/restaurants/me/hours", { method: "PUT", body: JSON.stringify(body) });

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

const mondayLunch = { weekday: 1, opensAt: 12 * 60, closesAt: 15 * 60, fulfillment: "takeaway" };
const mondayDinner = { weekday: 1, opensAt: 19 * 60, closesAt: 60, fulfillment: "all" };
const sunday = { weekday: 0, opensAt: 20 * 60, closesAt: 23 * 60, fulfillment: "delivery" };

describe("authentication", () => {
  it("answers 401 without a session", async () => {
    expect((await new Client().get("/api/restaurants/me/hours")).status).toBe(401);
  });

  it("answers 404 RESTAURANT_NOT_FOUND to an owner without a restaurant", async () => {
    const res = await (await loggedInClient()).get("/api/restaurants/me/hours");
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("RESTAURANT_NOT_FOUND");
  });
});

describe("/api/restaurants/me/hours", () => {
  it("starts without hours", async () => {
    const { client } = await ownerWithRestaurant();
    const res = await client.get("/api/restaurants/me/hours");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slots: [] });
  });

  it("replaces the week and lists it by weekday, keeping each day's order", async () => {
    const { client } = await ownerWithRestaurant();
    const res = await put(client, { slots: [mondayDinner, sunday, mondayLunch] });
    expect(res.status).toBe(200);
    const expected: HoursList = { slots: [sunday, mondayDinner, mondayLunch] } as HoursList;
    expect(await res.json()).toEqual(expected);
    expect(await (await client.get("/api/restaurants/me/hours")).json()).toEqual(expected);

    const replaced = await put(client, { slots: [mondayLunch] });
    expect(await replaced.json()).toEqual({ slots: [mondayLunch] });
  });

  it("saves a full week of four slots per day in one go", async () => {
    const { client } = await ownerWithRestaurant();
    const slots = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
      [8, 11, 14, 17].map((hour) => ({ weekday, opensAt: hour * 60, closesAt: (hour + 2) * 60, fulfillment: "all" })),
    );
    const res = await put(client, { slots });
    expect(res.status).toBe(200);
    expect(((await res.json()) as HoursList).slots).toHaveLength(28);
  });

  it("closes every day with an empty list", async () => {
    const { client } = await ownerWithRestaurant();
    await put(client, { slots: [mondayLunch, sunday] });
    expect(await (await put(client, { slots: [] })).json()).toEqual({ slots: [] });
  });

  it("rejects overlapping slots and equal times with 422, keeping what was stored", async () => {
    const { client } = await ownerWithRestaurant();
    await put(client, { slots: [mondayLunch] });

    // Monday 19:00–01:00 runs into a Tuesday slot starting at 00:30.
    const overlap = await put(client, { slots: [mondayDinner, { ...mondayLunch, weekday: 2, opensAt: 30, closesAt: 120 }] });
    expect(overlap.status).toBe(422);
    expect(await errorCode(overlap)).toBe("VALIDATION_ERROR");

    const same = await put(client, { slots: [{ ...mondayLunch, closesAt: mondayLunch.opensAt }] });
    expect(same.status).toBe(422);

    expect(await (await client.get("/api/restaurants/me/hours")).json()).toEqual({ slots: [mondayLunch] });
  });

  it("keeps each store's hours apart", async () => {
    const a = await ownerWithRestaurant();
    const b = await ownerWithRestaurant();
    await put(a.client, { slots: [mondayLunch] });
    await put(b.client, { slots: [sunday] });
    await put(b.client, { slots: [] });
    expect(await (await a.client.get("/api/restaurants/me/hours")).json()).toEqual({ slots: [mondayLunch] });
  });
});

describe("public menu and settings", () => {
  it("publishes the hours and the outside-hours setting", async () => {
    const { client, restaurant } = await ownerWithRestaurant();
    await put(client, { slots: [mondayDinner] });

    const settings = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ acceptOrdersOutsideHours: true }),
    });
    expect(((await settings.json()) as StoreSettings).acceptOrdersOutsideHours).toBe(true);

    const menu = (await (await new Client().get(`/api/public/menus/${restaurant.slug}`)).json()) as PublicMenu;
    expect(menu.restaurant.hours).toEqual([mondayDinner]);
    expect(menu.restaurant.acceptOrdersOutsideHours).toBe(true);
  });
});
