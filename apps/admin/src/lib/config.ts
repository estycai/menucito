/**
 * Build-time flags (Vite bakes them into the bundle). They only decide what the UI shows: the API has
 * its own guard for every feature behind a flag, so a flag here is never a security boundary.
 */

/** Shows the free plan switch on "Plan y pagos". Off unless built with `VITE_PLAN_SWITCH=true`. */
export const PLAN_SWITCH_ENABLED: boolean = import.meta.env.VITE_PLAN_SWITCH === "true";

/** Browser key of the Maps JavaScript API (delivery zones map). Empty means the map is not shown. */
export const GOOGLE_MAPS_KEY: string = import.meta.env.VITE_GOOGLE_MAPS_KEY ?? "";

/** Meta app id and Embedded Signup configuration id. Empty means WhatsApp is not offered. */
export const META_APP_ID: string = import.meta.env.VITE_META_APP_ID ?? "";
export const META_ES_CONFIG_ID: string = import.meta.env.VITE_META_ES_CONFIG_ID ?? "";
