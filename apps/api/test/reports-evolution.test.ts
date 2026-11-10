import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { GRANTED_REPORT_PERMISSION_KEYS, localDayRange, type EvolutionReport, type ReportMeta } from "@menucito/shared";
import { Client, errorCode, ownerWithRestaurant, staffClient, unique, type OwnerFixture } from "./helpers";

const PRICE = 100_000;
let counter = 0;
const uuid = () => "50000000-0000-4000-8000-" + String(counter++).padStart(12, "0");
const nextPhone = () => `11 7777 ${String(1000 + counter++).slice(-4)}`;

interface Store extends OwnerFixture {
  productId: string;
}

async function proStore(): Promise<Store> {
  const owner = await ownerWithRestaurant();
  await env.DB.prepare("UPDATE restaurants SET plan = 'pro' WHERE id = ?").bind(owner.restaurantId).run();
  const category = (await (await owner.client.post("/api/categories", { name: "Burgers" })).json()) as { id: string };
  const product = (await (
    await owner.client.post("/api/products", { categoryId: category.id, name: "Burger", priceCents: PRICE })
  ).json()) as { id: string };
  const settings = await owner.client.patch("/api/restaurants/me/settings", {
    acceptOrdersOutsideHours: true,
    paymentMethods: [
      { method: "cash", enabled: true },
      { method: "transfer", enabled: true, alias: "marta.pay", holderName: "Marta" },
      { method: "split", enabled: true },
    ],
  });
  expect(settings.status).toBe(200);
  return { ...owner, productId: product.id };
}

interface SeedOptions {
  quantity?: number;
  fulfillment?: "delivery" | "takeaway";
  paymentMethod?: "cash" | "transfer" | "split";
  splitCashCents?: number;
  shippingCents?: number;
  tipCents?: number;
  discountCents?: number;
  totalCents?: number;
  status?: string;
  paymentStatus?: string;
  /** `YYYY-MM-DD` in Argentina and `HH:MM`; defaults to now. */
  date?: string;
  time?: string;
  source?: string;
  courierMemberId?: string | null;
  phone?: string;
  customerName?: string;
  productId?: string;
}

/** Creates an order through the public menu and then stamps it as the report test needs. */
async function seed(store: Store, options: SeedOptions = {}) {
  const quantity = options.quantity ?? 1;
  const fulfillment = options.fulfillment ?? "delivery";
  const paymentMethod = options.paymentMethod ?? "cash";
  const shipping = fulfillment === "delivery" ? (options.shippingCents ?? 0) : 0;
  const tip = options.tipCents ?? 0;
  const subtotal = PRICE * quantity;
  const createdTotal = subtotal + shipping + tip;
  const token = uuid();
  const res = await new Client().post(`/api/public/menus/${store.slug}/orders`, {
    items: [{ productId: options.productId ?? store.productId, quantity }],
    customer: {
      name: options.customerName ?? "Ana",
      phone: options.phone ?? nextPhone(),
      address: fulfillment === "delivery" ? "Calle 1" : null,
    },
    fulfillment,
    paymentMethod,
    clientOrderId: token,
    ...(paymentMethod === "split" ? { splitCashCents: options.splitCashCents ?? Math.floor(createdTotal / 2) } : {}),
    ...(tip > 0 ? { tipCents: tip } : {}),
    expectedTotalCents: subtotal + tip,
  });
  expect(res.status).toBe(201);

  const createdAt = options.date
    ? localDayRange(options.date)[0] + timeMinutes(options.time ?? "12:00") * 60_000
    : Date.now();
  const rowTotal = options.totalCents ?? subtotal + shipping + tip - (options.discountCents ?? 0);
  await env.DB.prepare(
    `UPDATE orders
        SET status = ?, payment_status = ?, source = ?, courier_member_id = ?,
            created_at = ?, updated_at = ?, discount_cents = ?, shipping_cents = ?, tip_cents = ?, total_cents = ?
      WHERE client_token = ?`,
  )
    .bind(
      options.status ?? "delivered",
      options.paymentStatus ?? "paid",
      options.source ?? "web",
      options.courierMemberId ?? null,
      createdAt,
      createdAt,
      options.discountCents ?? 0,
      shipping,
      tip,
      rowTotal,
      token,
    )
    .run();
  const row = await env.DB.prepare("SELECT id FROM orders WHERE client_token = ?").bind(token).first<{ id: string }>();
  await env.DB.prepare(
    `UPDATE customers SET first_order_at = ?
      WHERE id = (SELECT customer_id FROM orders WHERE client_token = ?)
        AND (first_order_at IS NULL OR first_order_at > ?)`,
  )
    .bind(createdAt, token, createdAt)
    .run();
  return { id: row!.id, totalCents: rowTotal };
}

function timeMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

async function addProduct(store: Store, name: string, priceCents = PRICE): Promise<string> {
  const category = (await (await store.client.post("/api/categories", { name: `Cat ${unique()}` })).json()) as { id: string };
  const product = (await (
    await store.client.post("/api/products", { categoryId: category.id, name, priceCents })
  ).json()) as { id: string };
  return product.id;
}

function queryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, value);
  return params.toString();
}

async function evolution(client: Client, values: Record<string, string | undefined>) {
  const res = await client.get(`/api/reports/evolution?${queryString(values)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as EvolutionReport;
}

const RANGE = { from: "2026-06-01", to: "2026-06-30" };

describe("16a reports: universe and formulas", () => {
  it("counts only delivered and paid orders and reports cancellations apart (scenarios 10, 12, 26)", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02", totalCents: 100_000 });
    await seed(store, { date: "2026-06-03", quantity: 2 });
    await seed(store, { date: "2026-06-04", status: "delivered", paymentStatus: "pending" });
    await seed(store, { date: "2026-06-05", status: "new", paymentStatus: "paid" });
    await seed(store, { date: "2026-06-06", status: "cancelled", paymentStatus: "pending", totalCents: 100_000 });

    const report = await evolution(store.client, RANGE);
    expect(report.widgets.billed).toMatchObject({ currentCents: 300_000 });
    expect(report.widgets.orders).toMatchObject({ current: 2, previous: 0, changePercent: null });
    expect(report.widgets.cancellations).toMatchObject({
      count: { current: 1 },
      lostCents: 100_000,
      ratePercent: { current: 33.3 },
    });
  });

  it("uses the formulas of the six indicators (scenario 10)", async () => {
    const store = await proStore();
    await seed(store, {
      date: "2026-06-02",
      quantity: 2,
      paymentMethod: "transfer",
      shippingCents: 30_000,
      tipCents: 10_000,
      discountCents: 20_000,
      totalCents: 220_000,
    });

    const report = await evolution(store.client, RANGE);
    expect(report.widgets.billed?.currentCents).toBe(220_000);
    expect(report.widgets.ticket?.currentCents).toBe(180_000);
    expect(report.widgets.shipping?.currentCents).toBe(30_000);
    expect(report.widgets.discounts?.currentCents).toBe(20_000);
    expect(report.widgets.pnl).toEqual({
      productsCents: 200_000,
      shippingCents: 30_000,
      tipsCents: 10_000,
      discountCents: 20_000,
      billedCents: 220_000,
    });
  });

  it("compares against the previous period of the same length", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02", totalCents: 120_000 });
    await seed(store, { date: "2026-05-25", totalCents: 100_000 });

    const report = await evolution(store.client, { from: "2026-06-01", to: "2026-06-10" });
    expect(report.previousRange).toEqual({ from: "2026-05-22", to: "2026-05-31" });
    expect(report.widgets.billed).toMatchObject({ currentCents: 120_000, previousCents: 100_000, changePercent: 20 });
  });

  it("splits the payment methods of a divided order", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02", paymentMethod: "split", splitCashCents: 30_000 });

    const report = await evolution(store.client, RANGE);
    expect(report.widgets.payment_methods?.rows).toEqual([
      { method: "cash", orders: 1, billedCents: 30_000, percent: 30 },
      { method: "transfer", orders: 1, billedCents: 70_000, percent: 70 },
    ]);
  });

  it("computes the pace, the heatmap, the movers, the customers and the daily series", async () => {
    const store = await proStore();
    const pizza = await addProduct(store, "Pizza");
    const phone = "11 8888 0001";
    await seed(store, { date: "2026-05-25", phone, customerName: "Ana", totalCents: 100_000 });
    await seed(store, { date: "2026-05-25", productId: pizza, quantity: 3, totalCents: 300_000 });
    await seed(store, { date: "2026-06-02", time: "12:00", phone, customerName: "Ana", quantity: 2 });
    await seed(store, { date: "2026-06-02", time: "13:00", phone: "11 8888 0002", customerName: "Beto" });

    const report = await evolution(store.client, { from: "2026-06-01", to: "2026-06-10" });
    expect(report.widgets.pace).toMatchObject({ peakDay: 2, peakHour: 12, ordersPerDay: 0.2, newCustomers: 1 });
    expect(report.widgets.heatmap?.cells[1]?.[12]).toBe(1);
    expect(report.widgets.heatmap?.cells[1]?.[13]).toBe(1);
    expect(report.widgets.movers?.up[0]).toMatchObject({ name: "Burger", units: 3, previousUnits: 1, delta: 2 });
    expect(report.widgets.movers?.down[0]).toMatchObject({ name: "Pizza", units: 0, previousUnits: 3, delta: -3 });
    expect(report.widgets.customers).toMatchObject({
      unique: 2,
      returning: 1,
      ratePercent: 50,
      returningBilledCents: 200_000,
    });
    expect(report.widgets.customers?.top[0]).toMatchObject({ name: "Ana", orders: 1, billedCents: 200_000 });
    expect(report.widgets.trend?.days).toContainEqual(
      expect.objectContaining({ date: "2026-06-02", orders: 2, billedCents: 300_000 }),
    );
  });
});

describe("16a reports: filters", () => {
  async function filteredStore() {
    const store = await proStore();
    expect(
      (
        await store.client.put("/api/restaurants/me/hours", {
          slots: [{ weekday: 1, opensAt: 690, closesAt: 930, fulfillment: "all" }],
        })
      ).status,
    ).toBe(200);
    const courier = await staffClient({ owner: store, permissions: [], isCourier: true });
    await seed(store, {
      date: "2026-06-01",
      time: "12:00",
      fulfillment: "delivery",
      paymentMethod: "cash",
      source: "web",
      courierMemberId: courier.memberId,
    });
    await seed(store, { date: "2026-06-01", time: "20:00", fulfillment: "takeaway", paymentMethod: "transfer", source: "local" });
    await seed(store, {
      date: "2026-06-01",
      time: "13:00",
      fulfillment: "delivery",
      paymentMethod: "split",
      source: "whatsapp",
    });
    return { store, courier };
  }

  it("filters by shift, fulfillment, payment, source and courier", async () => {
    const { store, courier } = await filteredStore();
    expect((await evolution(store.client, { ...RANGE, shift: "690-930" })).widgets.orders?.current).toBe(2);
    expect((await evolution(store.client, { ...RANGE, fulfillment: "delivery" })).widgets.orders?.current).toBe(2);
    expect((await evolution(store.client, { ...RANGE, payment: "split" })).widgets.orders?.current).toBe(1);
    expect((await evolution(store.client, { ...RANGE, payment: "cash" })).widgets.orders?.current).toBe(2);
    expect((await evolution(store.client, { ...RANGE, source: "local" })).widgets.orders?.current).toBe(1);
    expect((await evolution(store.client, { ...RANGE, courier: courier.memberId })).widgets.orders?.current).toBe(1);
    expect((await evolution(store.client, { ...RANGE, shift: "off" })).widgets.orders?.current).toBe(1);
  });

  it("ignores a filter the role does not have (scenario 5)", async () => {
    const { store } = await filteredStore();
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", "stats.tab.evolution", "stats.f.date", "stats.f.source", "stats.w.evolution.orders"],
    });
    const report = await evolution(staff.client, { ...RANGE, fulfillment: "delivery", source: "local" });
    expect(report.widgets.orders?.current).toBe(1);
  });

  it("uses today when the role lacks the date filter (scenario 6)", async () => {
    const store = await proStore();
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", "stats.tab.evolution", "stats.w.evolution.orders"],
    });
    await seed(store);
    await seed(store, { date: "2026-06-02" });
    const report = await evolution(staff.client, RANGE);
    expect(report.range).toEqual({ from: report.range.from, to: report.range.from });
    expect(report.widgets.orders?.current).toBe(1);
  });
});

describe("16a reports: permissions", () => {
  it("omits the blocks and the cents the role lacks (scenarios 26, 28)", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02" });
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", "stats.tab.evolution", "stats.w.evolution.orders"],
    });
    const report = await evolution(staff.client, RANGE);
    expect(Object.keys(report.widgets)).toEqual(["orders"]);
    expect(JSON.stringify(report)).not.toContain("Cents");
  });

  it("removes every cents field when the role has all the blocks but no amounts", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02", paymentMethod: "split", splitCashCents: 30_000 });
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", ...GRANTED_REPORT_PERMISSION_KEYS.filter((key) => key !== "stats.amounts")],
    });
    const report = await evolution(staff.client, RANGE);
    expect(report.widgets.billed).toEqual({ changePercent: null });
    expect(report.widgets.payment_methods?.rows.every((row) => row.billedCents === undefined)).toBe(true);
    expect(JSON.stringify(report)).not.toContain("Cents");
  });

  it("403 without the tab and 403 on the Basic plan (scenario 30)", async () => {
    const store = await proStore();
    const withoutTab = await staffClient({ owner: store, permissions: ["stats.view"] });
    expect((await withoutTab.client.get("/api/reports/evolution")).status).toBe(403);
    expect(await errorCode(await withoutTab.client.get("/api/reports/evolution"))).toBe("FORBIDDEN");

    const basic = await ownerWithRestaurant();
    const res = await basic.client.get("/api/reports/evolution");
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("PLAN_FEATURE");
    expect((await basic.client.get("/api/reports/meta")).status).toBe(403);
  });

  it("keeps each restaurant to its own data", async () => {
    const first = await proStore();
    const second = await proStore();
    await seed(first, { date: "2026-06-02" });
    expect((await evolution(second.client, RANGE)).widgets.orders?.current).toBe(0);
  });

  it("refuses a range longer than a year with 400", async () => {
    const store = await proStore();
    const res = await store.client.get("/api/reports/evolution?from=2025-01-01&to=2026-11-10");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INVALID_REPORT_RANGE");
    expect(body.error.message).toBe("El rango puede ser de hasta un año");
  });
});

describe("16a reports: meta", () => {
  it("returns the shifts, the couriers and the enabled modalities", async () => {
    const store = await proStore();
    expect(
      (
        await store.client.put("/api/restaurants/me/hours", {
          slots: [{ weekday: 1, opensAt: 690, closesAt: 930, fulfillment: "all" }],
        })
      ).status,
    ).toBe(200);
    const courier = await staffClient({ owner: store, permissions: [], isCourier: true });

    const res = await store.client.get("/api/reports/meta");
    expect(res.status).toBe(200);
    const meta = (await res.json()) as ReportMeta;
    expect(meta.shifts).toEqual([{ id: "690-930", label: "Mediodía", opensAt: 690, closesAt: 930 }]);
    expect(meta.couriers).toContainEqual(
      expect.objectContaining({ memberId: courier.memberId, firstName: "Ana", lastName: "Pérez" }),
    );
    expect(meta).toMatchObject({ delivery: true, takeaway: true });
  });
});

describe("16a reports: payment share and activity", () => {
  it("adds only the cash part of a split order under the Efectivo filter, and the rest under Transferencia", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02", paymentMethod: "split", splitCashCents: 30_000 });
    await seed(store, { date: "2026-06-02", paymentMethod: "cash" });

    const cash = await evolution(store.client, { ...RANGE, payment: "cash" });
    expect(cash.widgets.orders?.current).toBe(2);
    expect(cash.widgets.billed?.currentCents).toBe(130_000);
    expect(cash.widgets.pnl?.productsCents).toBe(130_000);
    expect(cash.widgets.payment_methods?.rows).toEqual([{ method: "cash", orders: 2, billedCents: 130_000, percent: 100 }]);
    expect(cash.widgets.customers?.returningBilledCents ?? 0).toBe(0);
    expect(cash.widgets.trend?.days[0]?.billedCents).toBe(130_000);

    const transfer = await evolution(store.client, { ...RANGE, payment: "transfer" });
    expect(transfer.widgets.orders?.current).toBe(1);
    expect(transfer.widgets.billed?.currentCents).toBe(70_000);
    expect(transfer.widgets.payment_methods?.rows).toEqual([{ method: "transfer", orders: 1, billedCents: 70_000, percent: 100 }]);

    const split = await evolution(store.client, { ...RANGE, payment: "split" });
    expect(split.widgets.billed?.currentCents).toBe(100_000);
  });

  it("without amounts, the payment percentages are over the orders of the rows and add up to 100", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02", paymentMethod: "split" });
    await seed(store, { date: "2026-06-02", paymentMethod: "cash" });
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", "stats.tab.evolution", "stats.f.date", "stats.w.evolution.payment_methods"],
    });
    const report = await evolution(staff.client, RANGE);
    expect(report.widgets.payment_methods?.rows.map((row) => row.percent)).toEqual([66.7, 33.3]);
  });

  it("tells whether the period has activity even when the role lacks the orders block", async () => {
    const store = await proStore();
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", "stats.tab.evolution", "stats.f.date", "stats.w.evolution.heatmap"],
    });
    expect((await evolution(staff.client, RANGE)).hasActivity).toBe(false);
    await seed(store, { date: "2026-06-03", status: "cancelled", paymentStatus: "pending" });
    expect((await evolution(staff.client, RANGE)).hasActivity).toBe(true);
    await seed(store, { date: "2026-06-04" });
    expect((await evolution(staff.client, { from: "2026-06-04", to: "2026-06-04" })).hasActivity).toBe(true);
    expect((await evolution(staff.client, { from: "2026-06-05", to: "2026-06-05" })).hasActivity).toBe(false);
  });
});
