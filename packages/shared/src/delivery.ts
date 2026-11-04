import { z } from "zod";
import { hexColorSchema } from "./restaurant";
import { MAX_MONEY_CENTS } from "./settings";

/** `flat` charges the store's single shipping price; `zones` prices each address by its zone. */
export const DELIVERY_MODES = ["flat", "zones"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** `radius`: disc around the store; `ring`: band between two radii; `polygon`: area drawn on the map. */
export const ZONE_SHAPES = ["radius", "ring", "polygon"] as const;
export type ZoneShape = (typeof ZONE_SHAPES)[number];

export const ZONE_PRICING = ["fixed", "per_km"] as const;
export type ZonePricing = (typeof ZONE_PRICING)[number];

export const ADDRESS_LABELS = ["home", "work", "other"] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

export const ZONE_NAME_MAX_LENGTH = 40;
/** Largest radius of a zone (50 km): beyond that a store is not delivering, it is shipping. */
export const ZONE_RADIUS_MAX_M = 50_000;
export const ZONE_POLYGON_MIN_POINTS = 3;
export const ZONE_POLYGON_MAX_POINTS = 100;

export const DELIVERY_MESSAGES = {
  latInvalid: "La latitud debe estar entre -90 y 90",
  lngInvalid: "La longitud debe estar entre -180 y 180",
  zoneNameRequired: "Ingresá el nombre de la zona",
  zoneNameTooLong: `El nombre puede tener hasta ${ZONE_NAME_MAX_LENGTH} caracteres`,
  shapeInvalid: "Forma de zona inválida",
  radiusInvalid: `El radio debe ser un número entero de metros entre 1 y ${ZONE_RADIUS_MAX_M}`,
  ringInvalid: "El radio interior debe ser menor que el exterior",
  polygonTooFew: `Marcá al menos ${ZONE_POLYGON_MIN_POINTS} puntos en el mapa`,
  polygonTooMany: `La zona puede tener hasta ${ZONE_POLYGON_MAX_POINTS} puntos`,
  pricingInvalid: "Tipo de precio inválido",
  moneyInvalid: "El monto debe ser de hasta $1.000.000",
  minAboveMax: "El envío mínimo no puede ser mayor que el máximo",
} as const;

export interface LatLng {
  lat: number;
  lng: number;
}

/** A polygon vertex as stored in `delivery_zones.polygon`: `[lat, lng]`. */
export type LatLngTuple = [lat: number, lng: number];

const latSchema = z
  .number(DELIVERY_MESSAGES.latInvalid)
  .min(-90, DELIVERY_MESSAGES.latInvalid)
  .max(90, DELIVERY_MESSAGES.latInvalid);
const lngSchema = z
  .number(DELIVERY_MESSAGES.lngInvalid)
  .min(-180, DELIVERY_MESSAGES.lngInvalid)
  .max(180, DELIVERY_MESSAGES.lngInvalid);

// `z.number()` already rejects NaN and ±Infinity, so every coordinate is finite.
export const latLngSchema = z.object({ lat: latSchema, lng: lngSchema });

const latLngTupleSchema = z.tuple([latSchema, lngSchema]);

/** An amount in cents: integer from 0 to `MAX_MONEY_CENTS`. */
const moneySchema = z
  .number(DELIVERY_MESSAGES.moneyInvalid)
  .int(DELIVERY_MESSAGES.moneyInvalid)
  .min(0, DELIVERY_MESSAGES.moneyInvalid)
  .max(MAX_MONEY_CENTS, DELIVERY_MESSAGES.moneyInvalid);

const radiusSchema = z
  .number(DELIVERY_MESSAGES.radiusInvalid)
  .int(DELIVERY_MESSAGES.radiusInvalid)
  .min(1, DELIVERY_MESSAGES.radiusInvalid)
  .max(ZONE_RADIUS_MAX_M, DELIVERY_MESSAGES.radiusInvalid);

const zoneShapeSchema = z.discriminatedUnion(
  "shape",
  [
    z.object({ shape: z.literal("radius"), radiusM: radiusSchema }),
    z
      .object({ shape: z.literal("ring"), innerRadiusM: radiusSchema, radiusM: radiusSchema })
      .refine((ring) => ring.innerRadiusM < ring.radiusM, {
        message: DELIVERY_MESSAGES.ringInvalid,
        path: ["innerRadiusM"],
      }),
    z.object({
      shape: z.literal("polygon"),
      polygon: z
        .array(latLngTupleSchema)
        .min(ZONE_POLYGON_MIN_POINTS, DELIVERY_MESSAGES.polygonTooFew)
        .max(ZONE_POLYGON_MAX_POINTS, DELIVERY_MESSAGES.polygonTooMany),
    }),
  ],
  { error: DELIVERY_MESSAGES.shapeInvalid },
);

const zonePricingSchema = z.discriminatedUnion(
  "pricing",
  [
    z.object({ pricing: z.literal("fixed"), priceCents: moneySchema }),
    z
      .object({
        pricing: z.literal("per_km"),
        baseCents: moneySchema,
        perKmCents: moneySchema,
        minShippingCents: moneySchema.nullable().optional(),
        maxShippingCents: moneySchema.nullable().optional(),
      })
      .refine(
        (zone) => zone.minShippingCents == null || zone.maxShippingCents == null || zone.minShippingCents <= zone.maxShippingCents,
        { message: DELIVERY_MESSAGES.minAboveMax, path: ["minShippingCents"] },
      ),
  ],
  { error: DELIVERY_MESSAGES.pricingInvalid },
);

const zoneCommonSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, DELIVERY_MESSAGES.zoneNameRequired)
    .max(ZONE_NAME_MAX_LENGTH, DELIVERY_MESSAGES.zoneNameTooLong),
  color: hexColorSchema,
  /** Minimum subtotal to deliver to this zone; `null` means no minimum. */
  minOrderCents: moneySchema.nullable().optional(),
  /** Subtotal from which shipping to this zone is free; `null` means never free. */
  freeFromCents: moneySchema.nullable().optional(),
});

/**
 * What the owner edits for one zone: name, color, one shape (`radius` | `ring` | `polygon`) with its
 * geometry and one pricing (`fixed` | `per_km`) with its amounts. Fields of the other variants are
 * dropped. `id`, `active` and `sort` are handled by the API, not by this schema.
 */
export const deliveryZoneInputSchema = z.intersection(zoneCommonSchema, z.intersection(zoneShapeSchema, zonePricingSchema));

export type DeliveryZoneInput = z.output<typeof deliveryZoneInputSchema>;

/** A stored zone. The first active one by ascending `sort` that contains an address prices it. */
export type DeliveryZone = DeliveryZoneInput & {
  id: string;
  active: boolean;
  sort: number;
};
