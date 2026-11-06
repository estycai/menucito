import { describe, expect, it } from "vitest";
import {
  ORDER_MESSAGE_BODY_MAX_LENGTH,
  ORDER_MESSAGE_MESSAGES,
  ORDER_MESSAGE_VARIABLES,
  orderMessageTemplatesSchema,
  resolveOrderMessage,
  type OrderMessageTemplate,
} from "./order-messages";

const template = (
  fulfillment: OrderMessageTemplate["fulfillment"],
  targetStatus: OrderMessageTemplate["targetStatus"],
  body: string,
): OrderMessageTemplate => ({ fulfillment, targetStatus, body });

describe("resolveOrderMessage", () => {
  const templates = [template("delivery", "preparing", "Delivery en preparación"), template("delivery", "ready", "Delivery listo")];

  it("uses the takeaway variant when the store wrote one", () => {
    const withVariant = [...templates, template("takeaway", "preparing", "Take away en preparación")];
    expect(resolveOrderMessage(withVariant, "takeaway", "preparing")).toBe("Take away en preparación");
  });

  it("falls back to the delivery message for takeaway", () => {
    expect(resolveOrderMessage(templates, "takeaway", "preparing")).toBe("Delivery en preparación");
  });

  it("returns null when delivery has no message for the status", () => {
    expect(resolveOrderMessage(templates, "delivery", "sent")).toBeNull();
  });

  it("never resolves a sent message for takeaway", () => {
    expect(
      resolveOrderMessage([template("delivery", "sent", "En camino")], "takeaway", "sent"),
    ).toBeNull();
  });

  it("ignores a blank variant and uses the fallback", () => {
    const withBlank = [...templates, template("takeaway", "preparing", "   ")];
    expect(resolveOrderMessage(withBlank, "takeaway", "preparing")).toBe("Delivery en preparación");
  });
});

describe("orderMessageTemplatesSchema", () => {
  it("accepts up to the nine messages and trims the bodies", () => {
    const result = orderMessageTemplatesSchema.safeParse({
      templates: [
        template("delivery", "preparing", "  Hola  "),
        template("takeaway", "ready", "Listo"),
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.templates[0]!.body).toBe("Hola");
  });

  it("rejects a repeated fulfillment and status pair", () => {
    const result = orderMessageTemplatesSchema.safeParse({
      templates: [template("delivery", "preparing", "Uno"), template("delivery", "preparing", "Dos")],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.message).toBe(ORDER_MESSAGE_MESSAGES.duplicate);
  });

  it("rejects takeaway + sent", () => {
    const result = orderMessageTemplatesSchema.safeParse({
      templates: [template("takeaway", "sent", "En camino")],
    });
    expect(result.success).toBe(false);
  });

  it(`rejects a body over ${ORDER_MESSAGE_BODY_MAX_LENGTH} characters`, () => {
    const result = orderMessageTemplatesSchema.safeParse({
      templates: [template("delivery", "preparing", "a".repeat(ORDER_MESSAGE_BODY_MAX_LENGTH + 1))],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.message).toBe(ORDER_MESSAGE_MESSAGES.bodyTooLong);
  });

  it("rejects more than nine messages", () => {
    const result = orderMessageTemplatesSchema.safeParse({
      templates: Array.from({ length: 10 }, () => template("delivery", "preparing", "Hola")),
    });
    expect(result.success).toBe(false);
  });
});

describe("ORDER_MESSAGE_VARIABLES", () => {
  it("lists the four variables with their meaning", () => {
    expect(ORDER_MESSAGE_VARIABLES.map((variable) => variable.token)).toEqual([
      "{nombre}",
      "{numero}",
      "{total}",
      "{local}",
    ]);
  });
});
