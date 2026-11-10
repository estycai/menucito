import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { GRANTED_REPORT_PERMISSION_KEYS, type CouriersReport, type ReportMeta } from "@menucito/shared";
import { errorCode, ownerWithRestaurant, staffClient } from "./helpers";
import { RANGE, dayAt, proStore, report, seed } from "./report-fixtures";

const couriers = (client: Parameters<typeof report>[0], values: Record<string, string | undefined> = RANGE) =>
  report<CouriersReport>(client, "couriers", values);

const stampTime = (orderId: string, minutes: number) =>
  env.DB.prepare("UPDATE orders SET sent_at = ?, delivered_at = ? WHERE id = ?")
    .bind(dayAt("2026-06-02"), dayAt("2026-06-02") + minutes * 60_000, orderId)
    .run();

const stampSettled = (orderId: string, at: number) =>
  env.DB.prepare("UPDATE orders SET settled_at = ? WHERE id = ?").bind(at, orderId).run();

describe("16c couriers: only delivery with a courier", () => {
  it("counts the delivery orders with a courier, ignoring take away and orders without one", async () => {
    const store = await proStore();
    const courier = await staffClient({ owner: store, permissions: [], isCourier: true });
    await seed(store, { date: "2026-06-02", courierMemberId: courier.memberId, shippingCents: 20_000 });
    await seed(store, { date: "2026-06-02", fulfillment: "takeaway", courierMemberId: courier.memberId });
    await seed(store, { date: "2026-06-02" });

    const { widgets, hasActivity } = await couriers(store.client);
    expect(hasActivity).toBe(true);
    expect(widgets.orders).toMatchObject({ current: 1, previous: 0, changePercent: null });
    expect(widgets.shipping?.currentCents).toBe(20_000);
    expect(widgets.tips?.currentCents).toBe(0);
  });

  it("ignores the modality filter: the tab is always Delivery", async () => {
    const store = await proStore();
    const courier = await staffClient({ owner: store, permissions: [], isCourier: true });
    await seed(store, { date: "2026-06-02", courierMemberId: courier.memberId });

    const { widgets } = await couriers(store.client, { ...RANGE, fulfillment: "takeaway" });
    expect(widgets.orders?.current).toBe(1);
  });

  it("averages the delivery time only over the orders with Enviado and Entregado", async () => {
    const store = await proStore();
    const courier = await staffClient({ owner: store, permissions: [], isCourier: true });
    const timed = await seed(store, { date: "2026-06-02", courierMemberId: courier.memberId });
    await seed(store, { date: "2026-06-05", courierMemberId: courier.memberId });
    await stampTime(timed.id, 12);
    const previous = await seed(store, { date: "2026-05-20", courierMemberId: courier.memberId });
    await env.DB.prepare("UPDATE orders SET sent_at = ?, delivered_at = ? WHERE id = ?")
      .bind(dayAt("2026-05-20"), dayAt("2026-05-20") + 24 * 60_000, previous.id)
      .run();

    const { widgets } = await couriers(store.client);
    expect(widgets.time).toEqual({ currentMinutes: 12, previousMinutes: 24, changePercent: -50 });
  });
});

describe("16c couriers: by courier", () => {
  it("shows the settled cash of each courier, in cash and split, inside the period", async () => {
    const store = await proStore();
    const courier = await staffClient({ owner: store, permissions: [], isCourier: true });
    const cash = await seed(store, { date: "2026-06-02", courierMemberId: courier.memberId, shippingCents: 5_000 });
    const split = await seed(store, {
      date: "2026-06-03",
      courierMemberId: courier.memberId,
      paymentMethod: "split",
      splitCashCents: 40_000,
    });
    const outside = await seed(store, { date: "2026-06-04", courierMemberId: courier.memberId });
    await stampSettled(cash.id, dayAt("2026-06-10"));
    await stampSettled(split.id, dayAt("2026-06-11"));
    await stampSettled(outside.id, dayAt("2026-07-01"));

    const { widgets } = await couriers(store.client);
    const row = widgets.by_courier?.rows[0];
    expect(row).toMatchObject({
      memberId: courier.memberId,
      name: "Ana Pérez",
      orders: 3,
      shippingCents: 5_000,
      tipsCents: 0,
      cashCents: 145_000,
    });
    expect(widgets.by_courier?.total).toMatchObject({ orders: 3, shippingCents: 5_000, cashCents: 145_000 });
  });

  it("keeps a deactivated courier when he has deliveries in the period", async () => {
    const store = await proStore();
    const courier = await staffClient({ owner: store, permissions: [], isCourier: true });
    await seed(store, { date: "2026-06-02", courierMemberId: courier.memberId });
    await env.DB.prepare("UPDATE restaurant_members SET active = 0 WHERE id = ?").bind(courier.memberId).run();

    const { widgets } = await couriers(store.client);
    expect(widgets.by_courier?.rows.map((row) => row.name)).toEqual(["Ana Pérez"]);
  });

  it("offers in the filter the couriers and the members with deliveries in the last year", async () => {
    const store = await proStore();
    const courier = await staffClient({ owner: store, permissions: [], isCourier: true });
    const former = await staffClient({ owner: store, permissions: [], isCourier: true });
    await seed(store, { courierMemberId: former.memberId });
    await env.DB.prepare("UPDATE restaurant_members SET is_courier = 0 WHERE id = ?").bind(former.memberId).run();

    const meta = (await (await store.client.get("/api/reports/meta")).json()) as ReportMeta;
    expect(meta.couriers.map((row) => row.memberId)).toEqual(
      expect.arrayContaining([courier.memberId, former.memberId]),
    );
  });
});

describe("16c couriers: by zone", () => {
  it("groups by the saved zone name, keeps a deleted one and uses a fixed row in flat mode", async () => {
    const store = await proStore();
    const courier = await staffClient({ owner: store, permissions: [], isCourier: true });
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO delivery_zones (id, restaurant_id, name, color, active, sort, shape, radius_m, pricing, price_cents, created_at, updated_at)
       VALUES ('z1', ?, 'Centro', '#FF0000', 1, 0, 'radius', 1000, 'fixed', 5000, ?, ?)`,
    )
      .bind(store.restaurantId, now, now)
      .run();
    const centro = await seed(store, { date: "2026-06-02", courierMemberId: courier.memberId, shippingCents: 5_000 });
    const deleted = await seed(store, { date: "2026-06-03", courierMemberId: courier.memberId });
    const none = await seed(store, { date: "2026-06-04", courierMemberId: courier.memberId });
    await env.DB.prepare("UPDATE orders SET delivery_zone_id = 'z1', delivery_zone_name = 'Centro', delivery_distance_m = 2500 WHERE id = ?")
      .bind(centro.id)
      .run();
    await env.DB.prepare("UPDATE orders SET delivery_zone_name = 'Vieja', delivery_distance_m = 3500 WHERE id = ?")
      .bind(deleted.id)
      .run();
    await env.DB.prepare("UPDATE restaurant_settings SET delivery_mode = 'zones' WHERE restaurant_id = ?")
      .bind(store.restaurantId)
      .run();

    const zones = await couriers(store.client);
    expect(zones.widgets.by_zone?.rows).toEqual([
      { zoneId: "z1", name: "Centro", orders: 1, shippingCents: 5_000, distanceKm: 2.5, averageMinutes: null },
      { zoneId: null, name: "Sin zona", orders: 1, shippingCents: 0, distanceKm: null, averageMinutes: null },
      { zoneId: null, name: "Vieja", orders: 1, shippingCents: 0, distanceKm: 3.5, averageMinutes: null },
    ]);
    expect(zones.widgets.by_zone?.total).toMatchObject({ orders: 3, shippingCents: 5_000, distanceKm: 3 });
    expect(none.id).toBeTruthy();

    await env.DB.prepare("UPDATE restaurant_settings SET delivery_mode = 'flat' WHERE restaurant_id = ?")
      .bind(store.restaurantId)
      .run();
    const flat = await couriers(store.client);
    expect(flat.widgets.by_zone?.rows).toEqual([
      { zoneId: null, name: "Tarifa fija", orders: 3, shippingCents: 5_000, distanceKm: 3, averageMinutes: null },
    ]);
  });
});

describe("16c couriers: permissions", () => {
  it("omits the blocks the role lacks and hides every amount without stats.amounts", async () => {
    const store = await proStore();
    const courier = await staffClient({ owner: store, permissions: [], isCourier: true });
    await seed(store, { date: "2026-06-02", courierMemberId: courier.memberId, shippingCents: 4_000 });
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", ...GRANTED_REPORT_PERMISSION_KEYS.filter((key) => key !== "stats.amounts")],
    });

    const { widgets } = await couriers(staff.client);
    expect(JSON.stringify(widgets)).not.toContain("Cents");
    expect(widgets.by_courier?.rows[0]?.shippingCents).toBeUndefined();

    const partial = await staffClient({
      owner: store,
      permissions: ["stats.view", "stats.tab.couriers", "stats.f.date", "stats.w.couriers.orders"],
    });
    expect(Object.keys((await couriers(partial.client)).widgets)).toEqual(["orders"]);
  });

  it("refuses the tab without its permission and the Basic plan", async () => {
    const store = await proStore();
    const withoutTab = await staffClient({ owner: store, permissions: ["stats.view"] });
    const forbidden = await withoutTab.client.get("/api/reports/couriers");
    expect(forbidden.status).toBe(403);
    expect(await errorCode(forbidden)).toBe("FORBIDDEN");

    const basic = await ownerWithRestaurant();
    const res = await basic.client.get("/api/reports/couriers");
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("PLAN_FEATURE");
  });
});
