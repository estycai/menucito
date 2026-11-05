import { Hono } from "hono";
import {
  COVER_MAX_BYTES,
  LOGO_MAX_BYTES,
  changePlanSchema,
  createRestaurantSchema,
  placeDetailsQuerySchema,
  placeIdSchema,
  placeSearchQuerySchema,
  replaceDeliveryZonesSchema,
  replaceHoursSchema,
  storeLocationSchema,
  updateAppearanceSchema,
  updateSettingsSchema,
} from "@menucito/shared";
import type { AppEnv } from "../env";
import { allowAnyMember, requireMember, requireOwner, requirePermission } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { coverServiceFor } from "../services/covers";
import { deliveryServiceFor } from "../services/delivery";
import { hoursServiceFor } from "../services/hours";
import { logoServiceFor } from "../services/logos";
import { placesServiceFor } from "../services/places";
import { restaurantsServiceFor } from "../services/restaurants";
import { settingsServiceFor } from "../services/settings";
import {
  domainErrorHandler,
  errorResponse,
  parseJsonBody,
  parseQuery,
  readUploadedFile,
  uploadBodyLimit,
} from "./http";

// `slug-available` and `POST /` run for a user with no restaurant yet (onboarding), so they only need a
// session. Every `/me` route resolves the member first and declares what it requires.
export const restaurantsRoutes = new Hono<AppEnv>()
  .use("*", requireSession)
  .use("/me", requireMember)
  .use("/me/*", requireMember)

  .get("/me", allowAnyMember, async (c) => {
    const restaurant = await restaurantsServiceFor(c.env.DB).getMine(c.get("member"));
    return c.json(restaurant);
  })

  .get("/slug-available", async (c) => {
    const slug = c.req.query("slug") ?? "";
    return c.json(await restaurantsServiceFor(c.env.DB).checkSlugAvailability(slug));
  })

  .post("/", async (c) => {
    const body = await parseJsonBody(c, createRestaurantSchema);
    if ("response" in body) return body.response;
    const restaurant = await restaurantsServiceFor(c.env.DB).create(c.get("userId"), body.data);
    return c.json(restaurant, 201);
  })

  .put("/me/plan", requireOwner, async (c) => {
    const body = await parseJsonBody(c, changePlanSchema);
    if ("response" in body) return body.response;
    // The flag is configuration, so it is read here and handed to the service as a plain boolean.
    const enabled = c.env.ALLOW_PLAN_SWITCH === "true";
    const restaurant = await restaurantsServiceFor(c.env.DB).changePlan(c.get("member").restaurantId, body.data.plan, { enabled });
    return c.json(restaurant);
  })

  .patch("/me/appearance", requirePermission("store.edit"), async (c) => {
    const body = await parseJsonBody(c, updateAppearanceSchema);
    if ("response" in body) return body.response;
    return c.json(await restaurantsServiceFor(c.env.DB).updateAppearance(c.get("member").restaurantId, body.data));
  })

  .get("/me/settings", requirePermission("store.view"), async (c) => {
    return c.json(await settingsServiceFor(c.env.DB).getSettings(c.get("member").restaurantId));
  })

  .patch("/me/settings", requirePermission("store.edit"), async (c) => {
    const body = await parseJsonBody(c, updateSettingsSchema);
    if ("response" in body) return body.response;
    return c.json(await settingsServiceFor(c.env.DB).updateSettings(c.get("member").restaurantId, body.data));
  })

  // Delivery: the store location (and mode) and its zones. `/location` is the source of truth of the mode.
  .get("/me/location", requirePermission("store.view"), async (c) => {
    return c.json(await deliveryServiceFor(c.env.DB).getLocation(c.get("member").restaurantId));
  })

  .put("/me/location", requirePermission("store.edit"), async (c) => {
    const body = await parseJsonBody(c, storeLocationSchema);
    if ("response" in body) return body.response;
    return c.json(await deliveryServiceFor(c.env.DB).updateLocation(c.get("member").restaurantId, body.data));
  })

  .get("/me/delivery-zones", requirePermission("store.view"), async (c) => {
    return c.json(await deliveryServiceFor(c.env.DB).listZones(c.get("member").restaurantId));
  })

  .put("/me/delivery-zones", requirePermission("store.edit"), async (c) => {
    const body = await parseJsonBody(c, replaceDeliveryZonesSchema);
    if ("response" in body) return body.response;
    return c.json(await deliveryServiceFor(c.env.DB).replaceZones(c.get("member").restaurantId, body.data));
  })

  // Opening hours: the whole week, replaced at once. A weekday without slots is closed.
  .get("/me/hours", requirePermission("store.view"), async (c) => {
    return c.json(await hoursServiceFor(c.env.DB).getHours(c.get("member").restaurantId));
  })

  .put("/me/hours", requirePermission("store.edit"), async (c) => {
    const body = await parseJsonBody(c, replaceHoursSchema);
    if ("response" in body) return body.response;
    return c.json(await hoursServiceFor(c.env.DB).replaceHours(c.get("member").restaurantId, body.data));
  })

  // Address search of the store (Google Places). `session` groups the calls of one search for billing.
  .get("/me/places/search", requirePermission("store.edit"), async (c) => {
    const query = parseQuery(c, placeSearchQuerySchema);
    if ("response" in query) return query.response;
    return c.json(await placesServiceFor(c.env).search(c.get("member").restaurantId, query.data.q, query.data.session));
  })

  .get("/me/places/:placeId", requirePermission("store.edit"), async (c) => {
    const placeId = placeIdSchema.safeParse(c.req.param("placeId"));
    if (!placeId.success) return errorResponse(c, 422, "VALIDATION_ERROR", `placeId: ${placeId.error.issues[0]?.message}`);
    const query = parseQuery(c, placeDetailsQuerySchema);
    if ("response" in query) return query.response;
    return c.json(await placesServiceFor(c.env).details(c.get("member").restaurantId, placeId.data, query.data.session));
  })

  .put("/me/logo", requirePermission("store.edit"), uploadBodyLimit("logo", LOGO_MAX_BYTES), async (c) => {
    const upload = await readUploadedFile(c, "logo");
    if ("response" in upload) return upload.response;

    const result = await logoServiceFor(c.env.DB, c.env.MEDIA).uploadLogo(c.get("member").restaurantId, {
      bytes: await upload.file.arrayBuffer(),
      contentType: upload.file.type,
    });
    return c.json(result);
  })

  .delete("/me/logo", requirePermission("store.edit"), async (c) => {
    await logoServiceFor(c.env.DB, c.env.MEDIA).removeLogo(c.get("member").restaurantId);
    return c.body(null, 204);
  })

  .put("/me/cover", requirePermission("store.edit"), uploadBodyLimit("cover", COVER_MAX_BYTES), async (c) => {
    const upload = await readUploadedFile(c, "cover");
    if ("response" in upload) return upload.response;

    const result = await coverServiceFor(c.env.DB, c.env.MEDIA).uploadCover(c.get("member").restaurantId, {
      bytes: await upload.file.arrayBuffer(),
      contentType: upload.file.type,
    });
    return c.json(result);
  })

  .delete("/me/cover", requirePermission("store.edit"), async (c) => {
    await coverServiceFor(c.env.DB, c.env.MEDIA).removeCover(c.get("member").restaurantId);
    return c.body(null, 204);
  })

  .onError(domainErrorHandler("restaurants"));
