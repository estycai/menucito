/**
 * Limits per plan. This is the only place where plan limit values live: services enforce them,
 * the admin shows them and tests read them from here.
 */
export interface PlanLimits {
  /** Maximum number of products, or `null` for unlimited. Only creation is limited. */
  maxProducts: number | null;
  /** Whether product photos can be uploaded (one photo per product on every plan). */
  productPhotos: boolean;
}

export type PlanId = "basic" | "pro";

export const PLAN_LIMITS: Readonly<Record<PlanId, PlanLimits>> = {
  basic: { maxProducts: 40, productPhotos: true },
  pro: { maxProducts: null, productPhotos: true },
};

/** Every plan id, derived from `PLAN_LIMITS` (a `Record<PlanId, ...>`, so it cannot miss one). */
export const PLAN_IDS = Object.keys(PLAN_LIMITS) as [PlanId, ...PlanId[]];

/** Limits of `plan`; unknown values get the most restrictive plan (`basic`). */
export function planLimitsFor(plan: string): PlanLimits {
  return plan === "pro" ? PLAN_LIMITS.pro : PLAN_LIMITS.basic;
}
