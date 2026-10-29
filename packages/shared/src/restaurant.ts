import { z } from "zod";
import { PLAN_IDS } from "./plans";

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;
export const RESTAURANT_NAME_MAX_LENGTH = 60;

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Slugs that would collide with app routes or the brand. */
export const RESERVED_SLUGS: readonly string[] = [
  "api",
  "app",
  "admin",
  "www",
  "login",
  "signup",
  "onboarding",
  "health",
  "assets",
  "static",
  "menucito",
];

export const RESTAURANT_MESSAGES = {
  nameRequired: "Ingresá el nombre del local",
  nameTooLong: `El nombre puede tener hasta ${RESTAURANT_NAME_MAX_LENGTH} caracteres`,
  slugTooShort: `El link debe tener al menos ${SLUG_MIN_LENGTH} caracteres`,
  slugTooLong: `El link puede tener hasta ${SLUG_MAX_LENGTH} caracteres`,
  slugInvalid: "Usá solo minúsculas, números y guiones (sin guion al principio ni al final)",
  slugReserved: "Ese link está reservado. Probá con otro.",
  slugTaken: "Ese link ya está en uso. Probá con otro.",
  whatsappRequired: "Ingresá tu WhatsApp",
  whatsappInvalid: "Número inválido. Incluí el código de área, por ejemplo 11 1234-5678.",
  deliveryRequired: "Elegí al menos una forma de entrega.",
} as const;

export const slugSchema = z
  .string()
  .min(SLUG_MIN_LENGTH, RESTAURANT_MESSAGES.slugTooShort)
  .max(SLUG_MAX_LENGTH, RESTAURANT_MESSAGES.slugTooLong)
  .regex(SLUG_PATTERN, RESTAURANT_MESSAGES.slugInvalid)
  .refine((slug) => !RESERVED_SLUGS.includes(slug), RESTAURANT_MESSAGES.slugReserved);

export type SlugProblem = "invalid" | "reserved";

/** Classifies a slug without touching the database: `null` means it is well formed and not reserved. */
export function checkSlug(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(slug)) return "invalid";
  if (RESERVED_SLUGS.includes(slug)) return "reserved";
  return null;
}

/** Suggests a slug from a restaurant name: no accents, lowercase, words joined by hyphens. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

/**
 * Normalizes an Argentine WhatsApp number to the international mobile format `549` + 10 national
 * digits (what `wa.me` expects). Returns `null` when the input cannot be read as such a number.
 *
 * Steps: keep digits; drop a leading `54` (country code), then an optional `9` (mobile prefix),
 * then a leading `0` (trunk prefix). If 12 digits remain, the local `15` mobile prefix is still
 * there: remove the first `15` found at index 2, 3 or 4 (after a 2, 3 or 4 digit area code).
 *
 * Known ambiguity: area code length is not validated against a real list. A 12-digit number whose
 * first `15` at index 2-4 is NOT the mobile prefix (for example a typo with one extra digit) is
 * silently "fixed" by removing those digits, and a 10-digit number without an area code
 * (e.g. `15 1234 5678`) is accepted as if `15` were the area code.
 */
export function normalizeArWhatsapp(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("54")) digits = digits.slice(2);
  if (digits.startsWith("9")) digits = digits.slice(1);
  if (digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length === 12) {
    const index = [2, 3, 4].find((i) => digits.slice(i, i + 2) === "15");
    if (index !== undefined) digits = digits.slice(0, index) + digits.slice(index + 2);
  }

  return digits.length === 10 ? `549${digits}` : null;
}

export const createRestaurantSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, RESTAURANT_MESSAGES.nameRequired)
      .max(RESTAURANT_NAME_MAX_LENGTH, RESTAURANT_MESSAGES.nameTooLong),
    slug: slugSchema,
    whatsapp: z
      .string()
      .trim()
      .min(1, RESTAURANT_MESSAGES.whatsappRequired)
      .refine((value) => normalizeArWhatsapp(value) !== null, RESTAURANT_MESSAGES.whatsappInvalid),
    delivery: z.boolean(),
    takeaway: z.boolean(),
  })
  .refine((value) => value.delivery || value.takeaway, {
    message: RESTAURANT_MESSAGES.deliveryRequired,
    path: ["delivery"],
    // Run even when other fields are invalid, so every error shows on the first submit. Skip it when
    // the input is not an object (root issue, empty path) or the booleans themselves are invalid.
    when: (payload) =>
      payload.issues.every((issue) => {
        const field = issue.path?.[0];
        return field !== undefined && field !== "delivery" && field !== "takeaway";
      }),
  });

export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;

/** Body of `PUT /api/restaurants/me/plan`. The accepted values come from `PLAN_LIMITS`, so a new plan is never forgotten. */
export const changePlanSchema = z.object({ plan: z.enum(PLAN_IDS) });

export type ChangePlanInput = z.infer<typeof changePlanSchema>;

/** Restaurant as returned by the API (dates as ISO strings). */
export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  /** Normalized digits, `549` + area code + number. */
  whatsapp: string;
  delivery: boolean;
  takeaway: boolean;
  /** Public path of the logo (served by `GET /api/media/*`), or `null` when there is none. */
  logoUrl: string | null;
  plan: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type SlugUnavailableReason = SlugProblem | "taken";

export interface SlugAvailability {
  available: boolean;
  reason?: SlugUnavailableReason;
}

/** Error body returned by the REST API. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}
