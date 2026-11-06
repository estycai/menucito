import { Hono } from "hono";
import { z } from "zod";
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  assignCourierSchema,
  createManualOrderRequestSchema,
  deliveryQuoteRequestSchema,
  orderFiltersQuerySchema,
  placeDetailsQuerySchema,
  placeIdSchema,
  placeSearchQuerySchema,
  updateOrderPaymentMethodSchema,
} from "@menucito/shared";
import type { AppEnv } from "../env";
import { requirePermission, requireMember } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { ownerDeliveryServiceFor } from "../services/delivery";
import { ordersServiceFor } from "../services/orders";
import { placesServiceFor } from "../services/places";
import { domainErrorHandler, errorResponse, parseJsonBody, parseQuery } from "./http";

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
  .get("/totals", requirePermission("summary.view"), async (c) => {
    return c.json(await ordersServiceFor(c.env.DB).totals(c.get("member").restaurantId));
  })

  .get("/export", requirePermission("orders.export"), async (c) => {
    const query = parseQuery(c, orderFiltersQuerySchema);
    if ("response" in query) return query.response;
    const { csv, filename } = await ordersServiceFor(c.env.DB).exportCsv(c.get("member").restaurantId, query.data);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.body(csv);
  })

  // Manual orders: the catalog is the public menu, these routes only cover what the admin needs to
  // build one. Declared before /:id so "places" and "delivery-quote" are never read as an order id.
  .get("/places/search", requirePermission("orders.create"), async (c) => {
    const query = parseQuery(c, placeSearchQuerySchema);
    if ("response" in query) return query.response;
    return c.json(await placesServiceFor(c.env).search(c.get("member").restaurantId, query.data.q, query.data.session));
  })

  .get("/places/:placeId", requirePermission("orders.create"), async (c) => {
    const placeId = placeIdSchema.safeParse(c.req.param("placeId"));
    if (!placeId.success) return errorResponse(c, 422, "VALIDATION_ERROR", `placeId: ${placeId.error.issues[0]?.message}`);
    const query = parseQuery(c, placeDetailsQuerySchema);
    if ("response" in query) return query.response;
    return c.json(await placesServiceFor(c.env).details(c.get("member").restaurantId, placeId.data, query.data.session));
  })

  .post("/delivery-quote", requirePermission("orders.create"), async (c) => {
    const body = await parseJsonBody(c, deliveryQuoteRequestSchema);
    if ("response" in body) return body.response;
    return c.json(await ownerDeliveryServiceFor(c.env.DB).quote(c.get("member").restaurantId, body.data));
  })

  .post("/", requirePermission("orders.create"), async (c) => {
    const body = await parseJsonBody(c, createManualOrderRequestSchema);
    if ("response" in body) return body.response;
    const result = await ordersServiceFor(c.env.DB).createManualOrder(
      c.get("member").restaurantId,
      c.get("member"),
      body.data,
    );
    return c.json(result.order, result.status);
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
