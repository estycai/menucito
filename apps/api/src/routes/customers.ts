import { Hono } from "hono";
import {
  customerHistoryQuerySchema,
  customerImportRequestSchema,
  customerListQuerySchema,
  updateCustomerSchema,
} from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireMember, requirePermission } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { customersServiceFor } from "../services/customers";
import { domainErrorHandler, parseJsonBody, parseQuery } from "./http";

/** Customers (change 17a): list, sheet, heatmap, CSV export and import. */
export const customersRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  // Declared before /:id so "export.csv", "heatmap" and "import" are never read as a customer id.
  .get("/export.csv", requirePermission("customers.export"), async (c) => {
    const query = parseQuery(c, customerListQuerySchema);
    if ("response" in query) return query.response;
    const { csv, filename } = await customersServiceFor(c.env).exportCsv(c.get("member").restaurantId, query.data);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.body(csv);
  })

  .get("/heatmap", requirePermission("customers.view"), async (c) => {
    const query = parseQuery(c, customerListQuerySchema);
    if ("response" in query) return query.response;
    return c.json(await customersServiceFor(c.env).heatmap(c.get("member").restaurantId, query.data));
  })

  .post("/import", requirePermission("customers.edit"), async (c) => {
    const body = await parseJsonBody(c, customerImportRequestSchema);
    if ("response" in body) return body.response;
    return c.json(await customersServiceFor(c.env).import(c.get("member").restaurantId, body.data));
  })

  .get("/", requirePermission("customers.view"), async (c) => {
    const query = parseQuery(c, customerListQuerySchema);
    if ("response" in query) return query.response;
    return c.json(await customersServiceFor(c.env).list(c.get("member").restaurantId, query.data));
  })

  .get("/:id", requirePermission("customers.view"), async (c) => {
    return c.json(await customersServiceFor(c.env).detail(c.get("member").restaurantId, c.req.param("id")));
  })

  .get("/:id/orders", requirePermission("customers.view"), async (c) => {
    const query = parseQuery(c, customerHistoryQuerySchema);
    if ("response" in query) return query.response;
    return c.json(
      await customersServiceFor(c.env).orders(
        c.get("member").restaurantId,
        c.req.param("id"),
        query.data.page,
      ),
    );
  })

  .patch("/:id", requirePermission("customers.edit"), async (c) => {
    const body = await parseJsonBody(c, updateCustomerSchema);
    if ("response" in body) return body.response;
    return c.json(
      await customersServiceFor(c.env).update(
        c.get("member").restaurantId,
        c.req.param("id"),
        body.data,
      ),
    );
  })

  .delete("/:id", requirePermission("customers.delete"), async (c) => {
    await customersServiceFor(c.env).delete(c.get("member").restaurantId, c.req.param("id"));
    return c.body(null, 204);
  })

  .delete("/:id/addresses/:addressId", requirePermission("customers.edit"), async (c) => {
    await customersServiceFor(c.env).deleteAddress(
      c.get("member").restaurantId,
      c.req.param("id"),
      c.req.param("addressId"),
    );
    return c.body(null, 204);
  })

  .onError(domainErrorHandler("customers"));
