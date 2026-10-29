import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Restaurant, SlugAvailability } from "@menucito/shared";
import { Client, captureEmails } from "./helpers";
import { createRestaurantsService } from "../src/services/restaurants";
import { UniqueViolationError, type RestaurantsRepository } from "../src/repositories/restaurants";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;

/** Signs up, verifies (which opens a session) and returns the logged-in client. */
async function loggedInClient() {
  const email = `owner${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
  const client = new Client();
  await client.open(sink.last().link);
  expect(client.hasSession).toBe(true);
  return client;
}

const validBody = (slug = `lo-de-marta-${unique()}`) => ({
  name: "Lo de Marta",
  slug,
  whatsapp: "011 15 1234-5678",
  delivery: true,
  takeaway: true,
});

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("authentication (scenario 9)", () => {
  it.each([
    ["GET", "/api/restaurants/me"],
    ["GET", "/api/restaurants/slug-available?slug=abc"],
    ["POST", "/api/restaurants"],
  ])("%s %s answers 401 without a session", async (method, path) => {
    const res = await new Client().request(path, {
      method,
      body: method === "POST" ? JSON.stringify(validBody()) : undefined,
    });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/restaurants", () => {
  it("creates the restaurant and stores the normalized WhatsApp (scenarios 4, 5)", async () => {
    const client = await loggedInClient();
    const body = validBody();
    const res = await client.post("/api/restaurants", body);
    expect(res.status).toBe(201);
    const restaurant = (await res.json()) as Restaurant;
    expect(restaurant).toMatchObject({
      name: "Lo de Marta",
      slug: body.slug,
      whatsapp: "5491112345678",
      delivery: true,
      takeaway: true,
      plan: "basic",
      status: "trial",
    });
    expect(restaurant.id).toBeTruthy();
  });

  it("stores +54 9 11 1234-5678 with the same normalized value (scenario 5)", async () => {
    const client = await loggedInClient();
    const res = await client.post("/api/restaurants", { ...validBody(), whatsapp: "+54 9 11 1234-5678" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Restaurant).whatsapp).toBe("5491112345678");
  });

  it("answers 409 SLUG_TAKEN when the slug is taken at insert time (scenario 7)", async () => {
    const body = validBody();
    const other = await loggedInClient();
    const client = await loggedInClient();

    const available = await client.request(`/api/restaurants/slug-available?slug=${body.slug}`);
    expect(((await available.json()) as SlugAvailability).available).toBe(true);

    expect((await other.post("/api/restaurants", body)).status).toBe(201);

    const res = await client.post("/api/restaurants", { ...body, name: "Otro local" });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("SLUG_TAKEN");
    expect((await client.request("/api/restaurants/me")).status).toBe(404);
  });

  it("answers 409 ALREADY_HAS_RESTAURANT on a second restaurant (scenario 8)", async () => {
    const client = await loggedInClient();
    expect((await client.post("/api/restaurants", validBody())).status).toBe(201);
    const res = await client.post("/api/restaurants", validBody());
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("ALREADY_HAS_RESTAURANT");
  });

  it.each([
    ["empty name", { name: "  " }],
    ["name over 60 chars", { name: "a".repeat(61) }],
    ["slug under 3 chars", { slug: "ab" }],
    ["slug over 40 chars", { slug: "a".repeat(41) }],
    ["slug with invalid characters", { slug: "Lo De Marta" }],
    ["reserved slug", { slug: "admin" }],
    ["invalid whatsapp", { whatsapp: "1234" }],
    ["no delivery option", { delivery: false, takeaway: false }],
    ["missing fields", { name: undefined, delivery: undefined }],
  ])("answers 422 for %s (scenarios 5, 6, 11)", async (_label, override) => {
    const client = await loggedInClient();
    const res = await client.post("/api/restaurants", { ...validBody(), ...override });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("VALIDATION_ERROR");
  });

  it("answers 422 for a malformed JSON body", async () => {
    const client = await loggedInClient();
    const res = await client.request("/api/restaurants", { method: "POST", body: "{not json" });
    expect(res.status).toBe(422);
  });

  it("ignores any owner sent in the body: the tenant comes from the session", async () => {
    const client = await loggedInClient();
    const res = await client.post("/api/restaurants", { ...validBody(), ownerId: "someone-else" });
    expect(res.status).toBe(201);
    expect((await client.request("/api/restaurants/me")).status).toBe(200);
  });
});

describe("GET /api/restaurants/me (scenario 10)", () => {
  it("answers 404 when the user has no restaurant", async () => {
    const client = await loggedInClient();
    const res = await client.request("/api/restaurants/me");
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("RESTAURANT_NOT_FOUND");
  });

  it("returns the user's restaurant", async () => {
    const client = await loggedInClient();
    const body = validBody();
    await client.post("/api/restaurants", body);
    const res = await client.request("/api/restaurants/me");
    expect(res.status).toBe(200);
    expect((await res.json()) as Restaurant).toMatchObject({ slug: body.slug, name: "Lo de Marta" });
  });

  it("does not leak another user's restaurant", async () => {
    const owner = await loggedInClient();
    await owner.post("/api/restaurants", validBody());
    const stranger = await loggedInClient();
    expect((await stranger.request("/api/restaurants/me")).status).toBe(404);
  });
});

describe("GET /api/restaurants/slug-available", () => {
  const check = async (client: Client, slug: string) => {
    const res = await client.request(`/api/restaurants/slug-available?slug=${encodeURIComponent(slug)}`);
    expect(res.status).toBe(200);
    return (await res.json()) as SlugAvailability;
  };

  it("reports a free slug as available", async () => {
    const client = await loggedInClient();
    expect(await check(client, `libre-${unique()}`)).toEqual({ available: true });
  });

  it.each(["ab", "Con Espacios", "-guion", "a".repeat(41), ""])("reports %s as invalid", async (slug) => {
    const client = await loggedInClient();
    expect(await check(client, slug)).toEqual({ available: false, reason: "invalid" });
  });

  it("reports a reserved slug", async () => {
    const client = await loggedInClient();
    expect(await check(client, "onboarding")).toEqual({ available: false, reason: "reserved" });
  });

  it("reports a taken slug", async () => {
    const client = await loggedInClient();
    const body = validBody();
    await client.post("/api/restaurants", body);
    expect(await check(await loggedInClient(), body.slug)).toEqual({ available: false, reason: "taken" });
  });
});

describe("restaurants service (no database)", () => {
  const input = { name: "Lo de Marta", slug: "lo-de-marta", whatsapp: "11 1234 5678", delivery: true, takeaway: false };

  function fakeRepository(insertError?: Error): RestaurantsRepository {
    return {
      findByOwner: async () => null,
      findBySlug: async () => null,
      insert: async (row) => {
        if (insertError) throw insertError;
        return { plan: "basic", status: "trial", ...row } as Awaited<ReturnType<RestaurantsRepository["insert"]>>;
      },
      updateLogoUrl: async () => null,
    };
  }

  it("maps a slug UNIQUE violation to SlugTakenError", async () => {
    const service = createRestaurantsService(fakeRepository(new UniqueViolationError("slug")));
    await expect(service.create("user-1", input)).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("maps an owner UNIQUE violation to AlreadyHasRestaurantError", async () => {
    const service = createRestaurantsService(fakeRepository(new UniqueViolationError("owner_id")));
    await expect(service.create("user-1", input)).rejects.toMatchObject({ code: "ALREADY_HAS_RESTAURANT" });
  });

  it("normalizes the WhatsApp before storing it", async () => {
    const restaurant = await createRestaurantsService(fakeRepository()).create("user-1", input);
    expect(restaurant.whatsapp).toBe("5491112345678");
  });
});
