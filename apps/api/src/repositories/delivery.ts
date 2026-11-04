import { and, asc, eq, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DeliveryMode, DeliveryZone, LatLngTuple, StoreLocation, ZonePricing, ZoneShape } from "@menucito/shared";
import { deliveryZones, restaurantSettings } from "../db/schema";

type ZoneRow = typeof deliveryZones.$inferSelect;
type NewZoneRow = typeof deliveryZones.$inferInsert;

/**
 * The store location (columns of `restaurant_settings`) and the `delivery_zones` rows, mapped to the
 * shared `StoreLocation` and `DeliveryZone` shapes.
 */
export interface DeliveryRepository {
  /** `null` when the restaurant has no settings row. */
  findLocation(restaurantId: string): Promise<StoreLocation | null>;
  /** Writes the location and mode (already validated), creating the settings row if it is missing. */
  upsertLocation(restaurantId: string, location: StoreLocation, updatedAt: Date): Promise<StoreLocation>;
  /** Zones of the restaurant by ascending `sort`. */
  listZones(restaurantId: string): Promise<DeliveryZone[]>;
  /**
   * Makes `zones` the full list of the restaurant in one batch: deletes the zones whose id is not in
   * it and inserts or updates the rest. Ids must be new or already belong to `restaurantId` (the
   * service checks it). Returns the stored list.
   */
  replaceZones(restaurantId: string, zones: readonly DeliveryZone[], now: Date): Promise<DeliveryZone[]>;
}

/** Row -> zone. Only the columns of the row's shape and pricing are read. */
function zoneFromRow(row: ZoneRow): DeliveryZone {
  const common = {
    id: row.id,
    name: row.name,
    color: row.color,
    active: row.active,
    sort: row.sort,
    minOrderCents: row.minOrderCents,
    freeFromCents: row.freeFromCents,
  };

  const shape = row.shape as ZoneShape;
  const geometry =
    shape === "polygon"
      ? { shape, polygon: JSON.parse(row.polygon ?? "[]") as LatLngTuple[] }
      : shape === "ring"
        ? { shape, radiusM: row.radiusM ?? 0, innerRadiusM: row.innerRadiusM ?? 0 }
        : { shape, radiusM: row.radiusM ?? 0 };

  const pricing = row.pricing as ZonePricing;
  const price =
    pricing === "per_km"
      ? {
          pricing,
          baseCents: row.baseCents ?? 0,
          perKmCents: row.perKmCents ?? 0,
          minShippingCents: row.minShippingCents,
          maxShippingCents: row.maxShippingCents,
        }
      : { pricing, priceCents: row.priceCents ?? 0 };

  return { ...common, ...geometry, ...price } as DeliveryZone;
}

/** Zone -> the columns a write sets; columns of the other shape and pricing are cleared. */
function zoneColumns(zone: DeliveryZone): Omit<NewZoneRow, "id" | "restaurantId" | "createdAt" | "updatedAt"> {
  return {
    name: zone.name,
    color: zone.color,
    active: zone.active,
    sort: zone.sort,
    shape: zone.shape,
    radiusM: zone.shape === "polygon" ? null : zone.radiusM,
    innerRadiusM: zone.shape === "ring" ? zone.innerRadiusM : null,
    polygon: zone.shape === "polygon" ? JSON.stringify(zone.polygon) : null,
    pricing: zone.pricing,
    priceCents: zone.pricing === "fixed" ? zone.priceCents : null,
    baseCents: zone.pricing === "per_km" ? zone.baseCents : null,
    perKmCents: zone.pricing === "per_km" ? zone.perKmCents : null,
    minShippingCents: zone.pricing === "per_km" ? (zone.minShippingCents ?? null) : null,
    maxShippingCents: zone.pricing === "per_km" ? (zone.maxShippingCents ?? null) : null,
    minOrderCents: zone.minOrderCents ?? null,
    freeFromCents: zone.freeFromCents ?? null,
  };
}

export function createDeliveryRepository(d1: D1Database): DeliveryRepository {
  const db = drizzle(d1);

  async function findLocation(restaurantId: string): Promise<StoreLocation | null> {
    const row = await db
      .select({
        deliveryMode: restaurantSettings.deliveryMode,
        address: restaurantSettings.address,
        addressNotes: restaurantSettings.addressNotes,
        lat: restaurantSettings.lat,
        lng: restaurantSettings.lng,
        placeId: restaurantSettings.placeId,
      })
      .from(restaurantSettings)
      .where(eq(restaurantSettings.restaurantId, restaurantId))
      .get();
    return row ? { ...row, deliveryMode: row.deliveryMode as DeliveryMode } : null;
  }

  async function listZones(restaurantId: string): Promise<DeliveryZone[]> {
    const rows = await db
      .select()
      .from(deliveryZones)
      .where(eq(deliveryZones.restaurantId, restaurantId))
      .orderBy(asc(deliveryZones.sort))
      .all();
    return rows.map(zoneFromRow);
  }

  return {
    findLocation,
    listZones,

    async upsertLocation(restaurantId, location, updatedAt) {
      const { deliveryMode, address, addressNotes, lat, lng, placeId } = location;
      const columns = { deliveryMode, address, addressNotes, lat, lng, placeId, updatedAt };
      await db
        .insert(restaurantSettings)
        .values({ restaurantId, ...columns })
        .onConflictDoUpdate({ target: restaurantSettings.restaurantId, set: columns });

      const stored = await findLocation(restaurantId);
      if (!stored) throw new Error("Settings disappeared right after the location update");
      return stored;
    },

    async replaceZones(restaurantId, zones, now) {
      const keepIds = zones.map((zone) => zone.id);
      const ofRestaurant = eq(deliveryZones.restaurantId, restaurantId);

      type BatchStatement = Parameters<typeof db.batch>[0][number];
      const statements: BatchStatement[] = [
        db.delete(deliveryZones).where(keepIds.length ? and(ofRestaurant, notInArray(deliveryZones.id, keepIds)) : ofRestaurant),
      ];
      for (const zone of zones) {
        const columns = zoneColumns(zone);
        statements.push(
          db
            .insert(deliveryZones)
            .values({ id: zone.id, restaurantId, ...columns, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({
              target: deliveryZones.id,
              set: { ...columns, updatedAt: now },
              // Never touch another store's zone, even if the service let a foreign id through.
              setWhere: ofRestaurant,
            }),
        );
      }
      await db.batch(statements as [BatchStatement, ...BatchStatement[]]);

      return listZones(restaurantId);
    },
  };
}
