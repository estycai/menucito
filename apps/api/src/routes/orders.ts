import { Hono } from "hono";
import { z } from "zod";
import { ORDER_STATUSES, PAYMENT_STATUSES, orderFiltersQuerySchema } from "@menucito/shared";
import type { AppEnv } from "../env";
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
  .use("*", requireSession)

  .get("/", async (c) => {
    const query = parseQuery(c, orderFiltersQuerySchema);
    if ("response" in query) return query.response;
    const result = await ordersServiceFor(c.env.DB).list(c.get("userId"), query.data);
    return c.json(result);
  })

  // Declared BEFORE /:id to prevent matching "export" as an ID
  .get("/export", async (c) => {
    const query = parseQuery(c, orderFiltersQuerySchema);
    if ("response" in query) return query.response;
    const { csv, filename } = await ordersServiceFor(c.env.DB).exportCsv(c.get("userId"), query.data);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.body(csv);
  })

  .get("/:id", async (c) => {
    const order = await ordersServiceFor(c.env.DB).getDetail(c.get("userId"), c.req.param("id"));
    return c.json(order);
  })

  .patch("/:id/status", async (c) => {
    const body = await parseJsonBody(c, updateOrderStatusSchema);
    if ("response" in body) return body.response;
    const order = await ordersServiceFor(c.env.DB).updateStatus(
      c.get("userId"),
      c.req.param("id"),
      body.data.status,
    );
    return c.json(order);
  })

  .patch("/:id/payment", async (c) => {
    const body = await parseJsonBody(c, updateOrderPaymentSchema);
    if ("response" in body) return body.response;
    const order = await ordersServiceFor(c.env.DB).updatePayment(
      c.get("userId"),
      c.req.param("id"),
      body.data.paymentStatus,
    );
    return c.json(order);
  })

  .onError(domainErrorHandler("orders"));
