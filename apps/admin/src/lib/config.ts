/**
 * Build-time flags (Vite bakes them into the bundle). They only decide what the UI shows: the API has
 * its own guard for every feature behind a flag, so a flag here is never a security boundary.
 */

/** Shows the free plan switch on "Plan y pagos". Off unless built with `VITE_PLAN_SWITCH=true`. */
export const PLAN_SWITCH_ENABLED: boolean = import.meta.env.VITE_PLAN_SWITCH === "true";
