import { Hono } from "hono";
import { createAuth } from "./auth";
import type { AppEnv } from "./env";
import { cashRoutes } from "./routes/cash";
import { categoriesRoutes } from "./routes/categories";
import { couriersRoutes } from "./routes/couriers";
import { customerTagsRoutes } from "./routes/customer-tags";
import { customersRoutes } from "./routes/customers";
import { deliveriesRoutes } from "./routes/deliveries";
import { integrationsRoutes } from "./routes/integrations";
import { mediaRoutes } from "./routes/media";
import { membersRoutes } from "./routes/members";
import { orderMessagesRoutes } from "./routes/order-messages";
import { ordersRoutes } from "./routes/orders";
import { productsRoutes } from "./routes/products";
import { publicRoutes } from "./routes/public";
import { reportsRoutes } from "./routes/reports";
import { restaurantsRoutes } from "./routes/restaurants";
import { rolesRoutes } from "./routes/roles";
import { whatsappWebhookRoutes } from "./routes/webhooks";

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ status: "ok" }));

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  let waitUntil: ((p: Promise<unknown>) => void) | undefined;
  try {
    const ctx = c.executionCtx;
    waitUntil = (p) => ctx.waitUntil(p);
  } catch {
    // No execution context (e.g. unit tests): background tasks are awaited instead.
  }
  return createAuth(c.env, { waitUntil }).handler(c.req.raw);
});

app.route("/api/restaurants", restaurantsRoutes);
app.route("/api/categories", categoriesRoutes);
app.route("/api/products", productsRoutes);
app.route("/api/media", mediaRoutes);
app.route("/api/orders", ordersRoutes);
app.route("/api/order-messages", orderMessagesRoutes);
app.route("/api/customers", customersRoutes);
app.route("/api/customer-tags", customerTagsRoutes);
app.route("/api/cash-sessions", cashRoutes);
app.route("/api/couriers", couriersRoutes);
app.route("/api/deliveries", deliveriesRoutes);
app.route("/api/members", membersRoutes);
app.route("/api/roles", rolesRoutes);
app.route("/api/reports", reportsRoutes);
app.route("/api/integrations", integrationsRoutes);
app.route("/api/webhooks", whatsappWebhookRoutes);
app.route("/api/public", publicRoutes);

export default app;
