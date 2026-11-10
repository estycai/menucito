/**
 * Limits per plan. This is the only place where plan limit values live: services enforce them,
 * the admin shows them and tests read them from here.
 */
export interface PlanLimits {
  /** Maximum number of products, or `null` for unlimited. Only creation is limited. */
  maxProducts: number | null;
  /** Whether product photos can be uploaded (one photo per product on every plan). */
  productPhotos: boolean;
  /** Whether products can have customizable ingredients (included quantity, min, max, extra price). */
  customIngredients: boolean;
  /** Whether the menu can use custom background and primary colors (otherwise the Menucito defaults apply). */
  customColors: boolean;
  /** Whether the cash drawer and its arqueos are available. */
  cashRegister: boolean;
  /** Whether the Reports section is available. */
  reports: boolean;
}

export type PlanId = "basic" | "pro";

export const PLAN_LIMITS: Readonly<Record<PlanId, PlanLimits>> = {
  basic: { maxProducts: 40, productPhotos: true, customIngredients: false, customColors: false, cashRegister: true, reports: false },
  pro: { maxProducts: null, productPhotos: true, customIngredients: true, customColors: true, cashRegister: true, reports: true },
};

/** Every plan id, derived from `PLAN_LIMITS` (a `Record<PlanId, ...>`, so it cannot miss one). */
export const PLAN_IDS = Object.keys(PLAN_LIMITS) as [PlanId, ...PlanId[]];

/** How often a paid plan is billed. */
export type BillingCycle = "monthly" | "annual";

/** Discount of paying a year at once, in percent. */
export const ANNUAL_DISCOUNT_PERCENT = 20;

/** Monthly price of each plan in ARS cents (display only until billing exists). */
export const PLAN_MONTHLY_PRICE_CENTS: Readonly<Record<PlanId, number>> = { basic: 0, pro: 800_000 };

/** What one charge of `plan` costs for `cycle`, in ARS cents (the annual cycle is one charge for 12 months). */
export function planChargeCents(plan: PlanId, cycle: BillingCycle): number {
  const monthly = PLAN_MONTHLY_PRICE_CENTS[plan];
  if (cycle === "monthly") return monthly;
  return Math.round((monthly * 12 * (100 - ANNUAL_DISCOUNT_PERCENT)) / 100);
}

/** Price per month of `plan` for `cycle`, in ARS cents (annual charge divided by 12). */
export function planMonthlyEquivalentCents(plan: PlanId, cycle: BillingCycle): number {
  return Math.round(planChargeCents(plan, cycle) / (cycle === "annual" ? 12 : 1));
}

/** What the annual cycle saves against twelve monthly charges, in ARS cents. */
export function planAnnualSavingsCents(plan: PlanId): number {
  return PLAN_MONTHLY_PRICE_CENTS[plan] * 12 - planChargeCents(plan, "annual");
}

/** Limits of `plan`; unknown values get the most restrictive plan (`basic`). */
export function planLimitsFor(plan: string): PlanLimits {
  return plan === "pro" ? PLAN_LIMITS.pro : PLAN_LIMITS.basic;
}
