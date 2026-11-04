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

// ---------------------------------------------------------------------------------------------
// Admin: store location, the zone list and the address search.

export const ADDRESS_MAX_LENGTH = 200;
export const ADDRESS_NOTES_MAX_LENGTH = 200;
export const PLACE_ID_MAX_LENGTH = 300;
/** Largest zone list a store can save at once. */
export const MAX_DELIVERY_ZONES = 20;
export const PLACE_QUERY_MAX_LENGTH = 200;

export const LOCATION_MESSAGES = {
  addressTooLong: `La dirección puede tener hasta ${ADDRESS_MAX_LENGTH} caracteres`,
  addressNotesTooLong: `Las instrucciones pueden tener hasta ${ADDRESS_NOTES_MAX_LENGTH} caracteres`,
  locationIncomplete: "La dirección, la latitud y la longitud van juntas",
  zonesNeedLocation: "Guardá la dirección del local antes de usar zonas",
  modeInvalid: "Modo de envío inválido",
  tooManyZones: `Podés tener hasta ${MAX_DELIVERY_ZONES} zonas`,
  zoneIdInvalid: "Identificador de zona inválido",
  placeQueryRequired: "Escribí una dirección para buscar",
  placeQueryTooLong: `La búsqueda puede tener hasta ${PLACE_QUERY_MAX_LENGTH} caracteres`,
  placeIdInvalid: "Identificador de lugar inválido",
  sessionInvalid: "Sesión de búsqueda inválida",
} as const;

/** Trimmed text where a missing or empty value means "none" (`null`). */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => (value ? value : null));

/**
 * Body of `PUT /api/restaurants/me/location` and what `GET` answers: the delivery mode and where the
 * store is. `address`, `lat` and `lng` are all set or all `null`; `zones` needs them set, because
 * radius and ring zones are measured from the store.
 */
export const storeLocationSchema = z
  .object({
    deliveryMode: z.enum(DELIVERY_MODES, LOCATION_MESSAGES.modeInvalid),
    address: optionalText(ADDRESS_MAX_LENGTH, LOCATION_MESSAGES.addressTooLong),
    addressNotes: optionalText(ADDRESS_NOTES_MAX_LENGTH, LOCATION_MESSAGES.addressNotesTooLong),
    lat: latSchema.nullish().transform((value) => value ?? null),
    lng: lngSchema.nullish().transform((value) => value ?? null),
    placeId: optionalText(PLACE_ID_MAX_LENGTH, LOCATION_MESSAGES.placeIdInvalid),
  })
  .superRefine((location, ctx) => {
    const parts = [location.address, location.lat, location.lng];
    const set = parts.filter((part) => part !== null).length;
    if (set !== 0 && set !== parts.length) {
      ctx.addIssue({ code: "custom", message: LOCATION_MESSAGES.locationIncomplete, path: ["address"] });
    } else if (location.deliveryMode === "zones" && set === 0) {
      ctx.addIssue({ code: "custom", message: LOCATION_MESSAGES.zonesNeedLocation, path: ["deliveryMode"] });
    }
  });

export type StoreLocation = z.output<typeof storeLocationSchema>;

/** Whether `location` has the coordinates zones are measured from. */
export function hasCoordinates(location: StoreLocation): location is StoreLocation & LatLng & { address: string } {
  return location.lat !== null && location.lng !== null && location.address !== null;
}

/**
 * One zone of `PUT /api/restaurants/me/delivery-zones`: the editable fields plus `active` and, for a
 * zone that already exists, its `id`. An unknown `id` creates a new zone.
 */
export const deliveryZoneUpsertSchema = z.intersection(
  deliveryZoneInputSchema,
  z.object({
    id: z.string().min(1, LOCATION_MESSAGES.zoneIdInvalid).max(64, LOCATION_MESSAGES.zoneIdInvalid).optional(),
    active: z.boolean(),
  }),
);

export type DeliveryZoneUpsert = z.output<typeof deliveryZoneUpsertSchema>;

/**
 * Body of `PUT /api/restaurants/me/delivery-zones`: the whole list, in priority order (`sort` is the
 * index). Zones missing from it are deleted.
 */
export const replaceDeliveryZonesSchema = z.object({
  zones: z.array(deliveryZoneUpsertSchema).max(MAX_DELIVERY_ZONES, LOCATION_MESSAGES.tooManyZones),
});

export type ReplaceDeliveryZonesInput = z.output<typeof replaceDeliveryZonesSchema>;

/** What `GET`/`PUT /api/restaurants/me/delivery-zones` answer. */
export interface DeliveryZoneList {
  zones: DeliveryZone[];
}

/** Google session tokens are client-generated UUIDs; anything URL-safe and short is accepted. */
const sessionTokenSchema = z
  .string(LOCATION_MESSAGES.sessionInvalid)
  .regex(/^[A-Za-z0-9_-]{8,64}$/, LOCATION_MESSAGES.sessionInvalid);

/** Query of `GET /api/restaurants/me/places/search`. */
export const placeSearchQuerySchema = z.object({
  q: z
    .string(LOCATION_MESSAGES.placeQueryRequired)
    .trim()
    .min(1, LOCATION_MESSAGES.placeQueryRequired)
    .max(PLACE_QUERY_MAX_LENGTH, LOCATION_MESSAGES.placeQueryTooLong),
  session: sessionTokenSchema,
});

/** Query of `GET /api/restaurants/me/places/:placeId`. */
export const placeDetailsQuerySchema = z.object({ session: sessionTokenSchema });

/** Google place ids are URL-safe base64-ish strings. */
export const placeIdSchema = z
  .string(LOCATION_MESSAGES.placeIdInvalid)
  .regex(/^[A-Za-z0-9_-]{1,300}$/, LOCATION_MESSAGES.placeIdInvalid);

/** One address suggestion while typing. */
export interface PlaceSuggestion {
  placeId: string;
  /** Street and number, e.g. "Av. Corrientes 1234". */
  mainText: string;
  /** The rest, e.g. "CABA, Argentina". */
  secondaryText: string;
}

/** A resolved address with its coordinates. */
export interface PlaceResult {
  placeId: string;
  formattedAddress: string;
  /** City (or partido when Google has no locality), `null` when unknown. */
  locality: string | null;
  lat: number;
  lng: number;
}

// ---------------------------------------------------------------------------------------------
// Diner: the delivery address of an order, the public address search and the shipping quote.

export const DELIVERY_UNIT_MAX_LENGTH = 60;
export const BETWEEN_STREETS_MAX_LENGTH = 100;
export const LOCALITY_MAX_LENGTH = 100;

/** How each address label reads in the menu and the admin. */
export const ADDRESS_LABEL_TEXT: Readonly<Record<AddressLabel, string>> = { home: "Casa", work: "Trabajo", other: "Otra" };

export const DELIVERY_ADDRESS_MESSAGES = {
  addressRequired: "Elegí la dirección de entrega",
  addressTooLong: `La dirección puede tener hasta ${ADDRESS_MAX_LENGTH} caracteres`,
  localityTooLong: `La localidad puede tener hasta ${LOCALITY_MAX_LENGTH} caracteres`,
  unitTooLong: `El piso o depto puede tener hasta ${DELIVERY_UNIT_MAX_LENGTH} caracteres`,
  betweenStreetsTooLong: `Las entrecalles pueden tener hasta ${BETWEEN_STREETS_MAX_LENGTH} caracteres`,
  labelInvalid: "Etiqueta inválida",
  subtotalInvalid: "El subtotal debe ser un número entero no negativo",
} as const;

/**
 * The geocoded delivery address of an order (stores in `zones` mode): where to deliver, as the diner
 * confirmed it on the map, plus the details the courier needs. `formattedAddress` is what the order
 * shows as its address.
 */
export const orderDeliverySchema = z.object({
  placeId: z
    .string(LOCATION_MESSAGES.placeIdInvalid)
    .regex(/^[A-Za-z0-9_-]{1,300}$/, LOCATION_MESSAGES.placeIdInvalid)
    .nullish()
    .transform((value) => value ?? null),
  lat: latSchema,
  lng: lngSchema,
  formattedAddress: z
    .string(DELIVERY_ADDRESS_MESSAGES.addressRequired)
    .trim()
    .min(1, DELIVERY_ADDRESS_MESSAGES.addressRequired)
    .max(ADDRESS_MAX_LENGTH, DELIVERY_ADDRESS_MESSAGES.addressTooLong),
  locality: optionalText(LOCALITY_MAX_LENGTH, DELIVERY_ADDRESS_MESSAGES.localityTooLong),
  unit: optionalText(DELIVERY_UNIT_MAX_LENGTH, DELIVERY_ADDRESS_MESSAGES.unitTooLong),
  betweenStreets: optionalText(BETWEEN_STREETS_MAX_LENGTH, DELIVERY_ADDRESS_MESSAGES.betweenStreetsTooLong),
  label: z
    .enum(ADDRESS_LABELS, DELIVERY_ADDRESS_MESSAGES.labelInvalid)
    .nullish()
    .transform((value) => value ?? null),
});

export type OrderDelivery = z.output<typeof orderDeliverySchema>;

/** Query of `GET /api/public/menus/:slug/places/reverse`: the point under the map pin. */
export const reverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number(DELIVERY_MESSAGES.latInvalid).pipe(latSchema),
  lng: z.coerce.number(DELIVERY_MESSAGES.lngInvalid).pipe(lngSchema),
});

/** Body of `POST /api/public/menus/:slug/delivery-quote`. */
export const deliveryQuoteRequestSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  subtotalCents: z
    .number(DELIVERY_ADDRESS_MESSAGES.subtotalInvalid)
    .int(DELIVERY_ADDRESS_MESSAGES.subtotalInvalid)
    .min(0, DELIVERY_ADDRESS_MESSAGES.subtotalInvalid),
});

export type DeliveryQuoteRequest = z.output<typeof deliveryQuoteRequestSchema>;

/**
 * What the diner learns about an address: whether the store delivers there and, if so, the shipping
 * and the minimum order. Zones (names, shapes, ids) stay private to the store.
 */
export type PublicDeliveryQuote =
  | { covered: false }
  | {
      covered: true;
      shippingCents: number;
      /** Minimum subtotal for this address; `null` means the store's general minimum applies. */
      minOrderCents: number | null;
    };
