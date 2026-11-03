import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireSession } from "../middleware/require-session";
import { ordersServiceFor } from "../services/orders";
import { domainErrorHandler, parseJsonBody } from "./http";

const updateOrderStatusSchema = z.object({
  status: z.string().min(1, "El estado es obligatorio"),
});

const updateOrderPaymentSchema = z.object({
  paymentStatus: z.string().min(1, "El estado de pago es obligatorio"),
});

export const ordersRoutes = new Hono<AppEnv>()
  .use("*", requireSession)

  .get("/", async (c) => {
    const query = c.req.query();
    const result = await ordersServiceFor(c.env.DB).list(c.get("userId"), query);
    return c.json(result);
  })

  // Declared BEFORE /:id to prevent matching "export" as an ID
  .get("/export", async (c) => {
    const query = c.req.query();
    const { csv, filename } = await ordersServiceFor(c.env.DB).exportCsv(c.get("userId"), query);
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
