const PLAN_NAMES: Readonly<Record<string, string>> = { basic: "Básico", pro: "Pro" };

/** Display name of a plan; unknown values show as the most restrictive plan, like `planLimitsFor`. */
export function planName(plan: string): string {
  return PLAN_NAMES[plan] ?? "Básico";
}
