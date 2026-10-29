import { describe, expect, it } from "vitest";
import {
  RESTAURANT_MESSAGES,
  checkSlug,
  createRestaurantSchema,
  normalizeArWhatsapp,
  slugSchema,
  slugify,
} from "./restaurant";

describe("slugify", () => {
  it("removes accents, lowercases and joins words with hyphens", () => {
    expect(slugify("Lo de Marta")).toBe("lo-de-marta");
    expect(slugify("  Café  Ñandú & Cía. ")).toBe("cafe-nandu-cia");
    expect(slugify("¡¡Pizzería!!--123")).toBe("pizzeria-123");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(slugify("¿?!")).toBe("");
  });

  it("cuts at 40 characters without a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(39)} bcd`);
    expect(slug).toBe("a".repeat(39));
    expect(slugify("x".repeat(60))).toHaveLength(40);
  });
});

describe("slugSchema / checkSlug", () => {
  it.each(["lo-de-marta", "abc", "pizza-24", "a".repeat(40)])("accepts %s", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
    expect(checkSlug(slug)).toBeNull();
  });

  it.each(["ab", "a".repeat(41), "Lo-De-Marta", "-abc", "abc-", "ab--cd", "lo de marta", "lo_de", "café"])(
    "rejects %s as invalid",
    (slug) => {
      expect(slugSchema.safeParse(slug).success).toBe(false);
      expect(checkSlug(slug)).toBe("invalid");
    },
  );

  it.each(["api", "admin", "onboarding", "menucito", "www"])("rejects reserved %s", (slug) => {
    const result = slugSchema.safeParse(slug);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(RESTAURANT_MESSAGES.slugReserved);
    expect(checkSlug(slug)).toBe("reserved");
  });
});

describe("normalizeArWhatsapp", () => {
  it.each([
    ["011 15 1234-5678", "5491112345678"],
    ["+54 9 11 1234-5678", "5491112345678"],
    ["+54 11 1234-5678", "5491112345678"],
    ["11 1234 5678", "5491112345678"],
    ["11 15 1234 5678", "5491112345678"],
    ["5491112345678", "5491112345678"],
    ["0341 15 512-3456", "5493415123456"],
    ["(0221) 15-412-3456", "5492214123456"],
    ["02966 15 41-2345", "5492966412345"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeArWhatsapp(input)).toBe(expected);
  });

  it.each(["", "abc", "1234", "11 1234 567", "011 15 1234-56789", "+1 415 555 0100 00"])(
    "rejects %s",
    (input) => {
      expect(normalizeArWhatsapp(input)).toBeNull();
    },
  );

  describe("known ambiguity (documented in the helper)", () => {
    it("removes the first 15 at index 2-4 of a 12-digit number even if it was not the mobile prefix", () => {
      // 11 + "2151234567" has an extra digit; the "15" at index 3 is removed as if it were the prefix.
      expect(normalizeArWhatsapp("112151234567")).toBe("5491121234567");
    });

    it("accepts a 10-digit number without area code, reading 15 as the area code", () => {
      expect(normalizeArWhatsapp("15 1234 5678")).toBe("5491512345678");
    });
  });
});

describe("createRestaurantSchema", () => {
  const valid = { name: "Lo de Marta", slug: "lo-de-marta", whatsapp: "011 15 1234-5678", delivery: true, takeaway: false };

  it("accepts valid input and trims the name", () => {
    const result = createRestaurantSchema.parse({ ...valid, name: "  Lo de Marta  " });
    expect(result.name).toBe("Lo de Marta");
  });

  it("requires at least one delivery option", () => {
    const result = createRestaurantSchema.safeParse({ ...valid, delivery: false, takeaway: false });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["delivery"], message: RESTAURANT_MESSAGES.deliveryRequired }),
    ]);
  });

  it("reports the delivery error together with field errors", () => {
    const result = createRestaurantSchema.safeParse({ ...valid, name: "", delivery: false, takeaway: false });
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["name", "delivery"]));
  });

  it.each([undefined, null, "text", []])("rejects non-object input %j without throwing", (input) => {
    expect(createRestaurantSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ["empty name", { name: "   " }, "name"],
    ["name over 60 chars", { name: "a".repeat(61) }, "name"],
    ["short slug", { slug: "ab" }, "slug"],
    ["long slug", { slug: "a".repeat(41) }, "slug"],
    ["slug with invalid characters", { slug: "Lo De Marta" }, "slug"],
    ["invalid whatsapp", { whatsapp: "1234" }, "whatsapp"],
  ])("rejects %s", (_label, override, field) => {
    const result = createRestaurantSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });
});
