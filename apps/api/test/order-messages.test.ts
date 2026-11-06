import { describe, expect, it } from "vitest";
import type { OrderMessageTemplate } from "@menucito/shared";
import { errorCode, ownerWithRestaurant, staffClient } from "./helpers";

const template = (
  fulfillment: OrderMessageTemplate["fulfillment"],
  targetStatus: OrderMessageTemplate["targetStatus"],
  body: string,
): OrderMessageTemplate => ({ fulfillment, targetStatus, body });

const listTemplates = async (client: Awaited<ReturnType<typeof ownerWithRestaurant>>["client"]) => {
  const res = await client.get("/api/order-messages");
  expect(res.status).toBe(200);
  return ((await res.json()) as { templates: OrderMessageTemplate[] }).templates;
};

describe("15a: GET/PUT /api/order-messages", () => {
  it("starts empty, saves a list, reads it back and replaces everything", async () => {
    const { client } = await ownerWithRestaurant();
    expect(await listTemplates(client)).toEqual([]);

    const saved = await client.put("/api/order-messages", {
      templates: [
        template("delivery", "preparing", "Hola {nombre}, ya está en preparación"),
        template("delivery", "ready", "Ya está listo"),
      ],
    });
    expect(saved.status).toBe(200);
    const stored = ((await saved.json()) as { templates: OrderMessageTemplate[] }).templates;
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(
      expect.arrayContaining([
        template("delivery", "preparing", "Hola {nombre}, ya está en preparación"),
        template("delivery", "ready", "Ya está listo"),
      ]),
    );

    const replaced = await client.put("/api/order-messages", {
      templates: [template("takeaway", "delivered", "Retirado, gracias")],
    });
    expect(replaced.status).toBe(200);
    expect(await listTemplates(client)).toEqual([template("takeaway", "delivered", "Retirado, gracias")]);
  });

  it("drops blank bodies instead of storing them", async () => {
    const { client } = await ownerWithRestaurant();
    const res = await client.put("/api/order-messages", {
      templates: [
        template("delivery", "preparing", "   "),
        template("delivery", "ready", " Listo "),
        template("takeaway", "preparing", ""),
      ],
    });
    expect(res.status).toBe(200);
    expect(await listTemplates(client)).toEqual([template("delivery", "ready", "Listo")]);
  });

  it("rejects takeaway + sent, repeated pairs and bodies over 1000 characters", async () => {
    const { client } = await ownerWithRestaurant();

    const takeawaySent = await client.put("/api/order-messages", {
      templates: [template("takeaway", "sent", "En camino")],
    });
    expect(takeawaySent.status).toBe(422);
    expect(await errorCode(takeawaySent)).toBe("VALIDATION_ERROR");

    const repeated = await client.put("/api/order-messages", {
      templates: [template("delivery", "preparing", "Uno"), template("delivery", "preparing", "Dos")],
    });
    expect(repeated.status).toBe(422);

    const tooLong = await client.put("/api/order-messages", {
      templates: [template("delivery", "preparing", "a".repeat(1001))],
    });
    expect(tooLong.status).toBe(422);
    const body = (await tooLong.json()) as { error: { message: string } };
    expect(body.error.message).toContain("1000");
  });

  it("needs orders.settings", async () => {
    const owner = await ownerWithRestaurant();
    const staff = await staffClient({ permissions: ["orders.view"], owner });

    expect((await staff.client.get("/api/order-messages")).status).toBe(403);
    expect((await staff.client.put("/api/order-messages", { templates: [] })).status).toBe(403);
  });

  it("keeps the messages of each restaurant apart", async () => {
    const a = await ownerWithRestaurant();
    const b = await ownerWithRestaurant();

    await a.client.put("/api/order-messages", {
      templates: [template("delivery", "preparing", "Solo de A")],
    });

    expect(await listTemplates(b.client)).toEqual([]);
    const bSaved = await b.client.put("/api/order-messages", {
      templates: [template("delivery", "preparing", "Solo de B")],
    });
    expect(bSaved.status).toBe(200);
    expect(await listTemplates(a.client)).toEqual([template("delivery", "preparing", "Solo de A")]);
  });
});
