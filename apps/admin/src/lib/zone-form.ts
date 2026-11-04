import {
  DELIVERY_MESSAGES,
  MAX_MONEY_CENTS,
  deliveryZoneUpsertSchema,
  formatArs,
  parseArsPrice,
  type DeliveryZone,
  type DeliveryZoneUpsert,
  type LatLng,
  type LatLngTuple,
  type ZonePricing,
  type ZoneShape,
} from "@menucito/shared";

/**
 * The zone editor of "Zonas de entrega": what the owner edits for each zone (a draft with money as
 * typed text and the geometry of every shape, so switching shapes never loses a drawing) and its
 * mapping to the API input. Pure functions only; the hooks live in `zones.ts`.
 */

/** Colors offered for new zones, in order (then they repeat). */
export const ZONE_COLORS = ["#C2410C", "#15803D", "#1D4ED8", "#7E22CE", "#B45309", "#BE185D"] as const;

/** Radius of the first zone, and how much each new zone grows past the largest one. */
export const ZONE_RADIUS_STEP_M = 2000;

export interface ZoneDraft {
  /** Stable client key (the id for saved zones), used for React keys and map overlays. */
  key: string;
  /** Id of a saved zone; `undefined` until the list is saved. */
  id?: string;
  name: string;
  color: string;
  active: boolean;
  shape: ZoneShape;
  /** Radius (or outer radius of a ring) in meters. */
  radiusM: number;
  /** Inner radius of a ring in meters. */
  innerRadiusM: number;
  polygon: LatLngTuple[];
  pricing: ZonePricing;
  /** Money as the owner types it ("1.500", "1500,50"), `""` when empty. */
  price: string;
  base: string;
  perKm: string;
  minShipping: string;
  maxShipping: string;
  minOrder: string;
  freeFrom: string;
}

export type ZoneDraftField = Exclude<keyof ZoneDraft, "key" | "id">;
export type ZoneErrors = Partial<Record<ZoneDraftField, string>>;

export const ZONE_FORM_MESSAGES = {
  priceRequired: "Ingresá el precio del envío (0 para gratis)",
  baseRequired: "Ingresá el precio base",
  perKmRequired: "Ingresá el precio por km",
} as const;

/** Cents as the money fields show them ("1.500", "1.500,50"), `""` for none. */
export function moneyText(cents: number | null | undefined): string {
  return cents == null ? "" : formatArs(cents).replace("$", "").trim();
}

export function draftFromZone(zone: DeliveryZone): ZoneDraft {
  return {
    key: zone.id,
    id: zone.id,
    name: zone.name,
    color: zone.color,
    active: zone.active,
    shape: zone.shape,
    radiusM: zone.shape === "polygon" ? ZONE_RADIUS_STEP_M : zone.radiusM,
    innerRadiusM: zone.shape === "ring" ? zone.innerRadiusM : 0,
    polygon: zone.shape === "polygon" ? zone.polygon : [],
    pricing: zone.pricing,
    price: zone.pricing === "fixed" ? moneyText(zone.priceCents) : "",
    base: zone.pricing === "per_km" ? moneyText(zone.baseCents) : "",
    perKm: zone.pricing === "per_km" ? moneyText(zone.perKmCents) : "",
    minShipping: zone.pricing === "per_km" ? moneyText(zone.minShippingCents) : "",
    maxShipping: zone.pricing === "per_km" ? moneyText(zone.maxShippingCents) : "",
    minOrder: moneyText(zone.minOrderCents),
    freeFrom: moneyText(zone.freeFromCents),
  };
}

/** Largest radius drawn so far (radius and ring zones), 0 when there is none. */
function largestRadius(drafts: readonly ZoneDraft[]): number {
  return drafts.reduce((max, draft) => (draft.shape === "polygon" ? max : Math.max(max, draft.radiusM)), 0);
}

/**
 * A new zone after `drafts`: the next color and number, and a ring around the largest zone so far
 * (a radius when it is the first one), so it shows up on the map next to the others.
 */
export function newZoneDraft(drafts: readonly ZoneDraft[], key: string): ZoneDraft {
  const outer = largestRadius(drafts);
  const n = drafts.length + 1;
  return {
    key,
    name: `Zona ${n}`,
    color: ZONE_COLORS[(n - 1) % ZONE_COLORS.length] ?? ZONE_COLORS[0],
    active: true,
    shape: outer > 0 ? "ring" : "radius",
    radiusM: outer + ZONE_RADIUS_STEP_M,
    innerRadiusM: outer,
    polygon: [],
    pricing: "fixed",
    price: "",
    base: "",
    perKm: "",
    minShipping: "",
    maxShipping: "",
    minOrder: "",
    freeFrom: "",
  };
}

/** Degrees of latitude per meter along a meridian (mean Earth radius). */
const LAT_PER_M = 360 / (2 * Math.PI * 6_371_008.8);

/** A square of `sizeM` meters centered on `center`, as a starting polygon the owner then reshapes. */
export function squareAround(center: LatLng, sizeM: number): LatLngTuple[] {
  const dLat = (sizeM / 2) * LAT_PER_M;
  const dLng = dLat / Math.cos((center.lat * Math.PI) / 180);
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return [
    [round(center.lat + dLat), round(center.lng - dLng)],
    [round(center.lat + dLat), round(center.lng + dLng)],
    [round(center.lat - dLat), round(center.lng + dLng)],
    [round(center.lat - dLat), round(center.lng - dLng)],
  ];
}

/**
 * `points` vertices of a circle of `radiusM` around `center`, clockwise or counterclockwise (a hole
 * of a map polygon must wind opposite to its outer path). Planar, like the coverage check.
 */
export function circlePath(center: LatLng, radiusM: number, clockwise: boolean, points = 72): LatLng[] {
  const dLat = radiusM * LAT_PER_M;
  const dLng = dLat / Math.cos((center.lat * Math.PI) / 180);
  return Array.from({ length: points }, (_, i) => {
    // From north: clockwise (north up, east right) heads east first.
    const angle = ((clockwise ? i : -i) / points) * 2 * Math.PI;
    return { lat: center.lat + dLat * Math.cos(angle), lng: center.lng + dLng * Math.sin(angle) };
  });
}

/** Label of a zone row: "$ 1.500", "Gratis" (fixed at 0), "Por km" or "Sin precio" (not valid yet). */
export function zonePriceLabel(draft: Pick<ZoneDraft, "pricing" | "price">): string {
  if (draft.pricing === "per_km") return "Por km";
  const cents = draft.price.trim() === "" ? null : parseArsPrice(draft.price);
  if (cents === null) return "Sin precio";
  return cents === 0 ? "Gratis" : formatArs(cents);
}

/** Moves the item at `index` one place up (-1) or down (1); out-of-range moves return the list as is. */
export function moveItem<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

type MoneyParse = { cents: number | null; error?: string };

/** Parses a money field: `""` is `null` (or the `required` error), anything unparseable an error. */
function parseMoney(text: string, required?: string): MoneyParse {
  if (text.trim() === "") return required ? { cents: null, error: required } : { cents: null };
  const cents = parseArsPrice(text);
  if (cents === null || cents > MAX_MONEY_CENTS) return { cents: null, error: DELIVERY_MESSAGES.moneyInvalid };
  return { cents };
}

/** API field (zod issue path) -> draft field that shows its error. */
const FIELD_OF_PATH: Readonly<Record<string, ZoneDraftField>> = {
  name: "name",
  color: "color",
  shape: "shape",
  radiusM: "radiusM",
  innerRadiusM: "innerRadiusM",
  polygon: "polygon",
  pricing: "pricing",
  priceCents: "price",
  baseCents: "base",
  perKmCents: "perKm",
  minShippingCents: "minShipping",
  maxShippingCents: "maxShipping",
  minOrderCents: "minOrder",
  freeFromCents: "freeFrom",
};

export type ZoneCheck = { input: DeliveryZoneUpsert; errors: null } | { input: null; errors: ZoneErrors };

/**
 * Draft -> the zone the API takes, validated with the same shared schema the API runs. Only the
 * fields of the chosen shape and pricing are sent (and checked).
 */
export function checkZoneDraft(draft: ZoneDraft): ZoneCheck {
  const errors: ZoneErrors = {};
  const money = (field: ZoneDraftField, text: string, required?: string) => {
    const parsed = parseMoney(text, required);
    if (parsed.error) errors[field] = parsed.error;
    return parsed.cents;
  };

  const geometry =
    draft.shape === "radius"
      ? { shape: draft.shape, radiusM: draft.radiusM }
      : draft.shape === "ring"
        ? { shape: draft.shape, radiusM: draft.radiusM, innerRadiusM: draft.innerRadiusM }
        : { shape: draft.shape, polygon: draft.polygon };

  const pricing =
    draft.pricing === "fixed"
      ? { pricing: draft.pricing, priceCents: money("price", draft.price, ZONE_FORM_MESSAGES.priceRequired) }
      : {
          pricing: draft.pricing,
          baseCents: money("base", draft.base, ZONE_FORM_MESSAGES.baseRequired),
          perKmCents: money("perKm", draft.perKm, ZONE_FORM_MESSAGES.perKmRequired),
          minShippingCents: money("minShipping", draft.minShipping),
          maxShippingCents: money("maxShipping", draft.maxShipping),
        };

  const candidate = {
    ...(draft.id && { id: draft.id }),
    name: draft.name,
    color: draft.color,
    active: draft.active,
    minOrderCents: money("minOrder", draft.minOrder),
    freeFromCents: money("freeFrom", draft.freeFrom),
    ...geometry,
    ...pricing,
  };

  const parsed = deliveryZoneUpsertSchema.safeParse(candidate);
  if (parsed.success && Object.keys(errors).length === 0) return { input: parsed.data, errors: null };

  for (const issue of parsed.error?.issues ?? []) {
    const field = FIELD_OF_PATH[String(issue.path[0] ?? "")];
    // A money field already explained by the form keeps the form's message.
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { input: null, errors };
}

export type ZonesCheck =
  | { inputs: DeliveryZoneUpsert[]; errors: null }
  | { inputs: null; errors: Record<string, ZoneErrors> };

/** Checks every draft; errors are keyed by draft `key`. */
export function checkZoneDrafts(drafts: readonly ZoneDraft[]): ZonesCheck {
  const inputs: DeliveryZoneUpsert[] = [];
  const errors: Record<string, ZoneErrors> = {};
  for (const draft of drafts) {
    const check = checkZoneDraft(draft);
    if (check.errors) errors[draft.key] = check.errors;
    else inputs.push(check.input);
  }
  return Object.keys(errors).length ? { inputs: null, errors } : { inputs, errors: null };
}
