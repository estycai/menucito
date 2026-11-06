import { Hono } from "hono";
import { z } from "zod";
import { ORDER_STATUSES, PAYMENT_STATUSES, assignCourierSchema, orderFiltersQuerySchema, updateOrderPaymentMethodSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requirePermission, requireMember } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { ordersServiceFor } from "../services/orders";
import { domainErrorHandler, parseJsonBody, parseQuery } from "./http";

const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES, "Estado desconocido"),
});

const updateOrderPaymentSchema = z.object({
  paymentStatus: z.enum(PAYMENT_STATUSES, "Estado de pago desconocido"),
});

export const ordersRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/", requirePermission("orders.view"), async (c) => {
    const query = parseQuery(c, orderFiltersQuerySchema);
    if ("response" in query) return query.response;
    const result = await ordersServiceFor(c.env.DB).list(c.get("member").restaurantId, query.data);
    return c.json(result);
  })

  // Declared BEFORE /:id to prevent matching "export" as an ID
  .get("/export", requirePermission("orders.export"), async (c) => {
    const query = parseQuery(c, orderFiltersQuerySchema);
    if ("response" in query) return query.response;
    const { csv, filename } = await ordersServiceFor(c.env.DB).exportCsv(c.get("member").restaurantId, query.data);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.body(csv);
  })

  .get("/:id", requirePermission("orders.view"), async (c) => {
    const order = await ordersServiceFor(c.env.DB).getDetail(c.get("member").restaurantId, c.req.param("id"));
    return c.json(order);
  })

  .patch("/:id/status", requirePermission("orders.status"), async (c) => {
    const body = await parseJsonBody(c, updateOrderStatusSchema);
    if ("response" in body) return body.response;
    const order = await ordersServiceFor(c.env.DB).updateStatus(
      c.get("member").restaurantId,
      c.req.param("id"),
      body.data.status,
    );
    return c.json(order);
  })

  // Assigning is how an order reaches `sent` (decision 5): the body picks who carries it.
  .post("/:id/assign", requirePermission("orders.assign"), async (c) => {
    const body = await parseJsonBody(c, assignCourierSchema);
    if ("response" in body) return body.response;
    const order = await ordersServiceFor(c.env.DB).assignCourier(
      c.get("member").restaurantId,
      c.req.param("id"),
      body.data.courierMemberId,
    );
    return c.json(order);
  })

  .patch("/:id/payment", requirePermission("orders.payment"), async (c) => {
    const body = await parseJsonBody(c, updateOrderPaymentSchema);
    if ("response" in body) return body.response;
    const member = c.get("member");
    const order = await ordersServiceFor(c.env.DB).updatePayment(
      member.restaurantId,
      member,
      c.req.param("id"),
      body.data.paymentStatus,
    );
    return c.json(order);
  })

  .patch("/:id/payment-method", requirePermission("orders.payment"), async (c) => {
    const body = await parseJsonBody(c, updateOrderPaymentMethodSchema);
    if ("response" in body) return body.response;
    const order = await ordersServiceFor(c.env.DB).updatePaymentMethod(
      c.get("member").restaurantId,
      c.req.param("id"),
      body.data,
    );
    return c.json(order);
  })

  .onError(domainErrorHandler("orders"));
