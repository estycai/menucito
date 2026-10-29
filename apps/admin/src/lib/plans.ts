import { PLAN_LIMITS, type PlanId } from "@menucito/shared";

const PLAN_NAMES: Readonly<Record<string, string>> = { basic: "Básico", pro: "Pro" };

/** Display name of a plan; unknown values show as the most restrictive plan, like `planLimitsFor`. */
export function planName(plan: string): string {
  return PLAN_NAMES[plan] ?? "Básico";
}

/** What a plan includes, as display lines. Every value comes from `PLAN_LIMITS`. */
export function planFeatures(plan: PlanId): string[] {
  const limits = PLAN_LIMITS[plan];
  const features = [limits.maxProducts === null ? "Productos ilimitados" : `Hasta ${limits.maxProducts} productos`];
  if (limits.productPhotos) features.push("Una foto por producto");
  if (limits.customIngredients) features.push("Ingredientes personalizables");
  return features;
}
