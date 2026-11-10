import { PLAN_LIMITS, type PlanId } from "@menucito/shared";

const PLAN_NAMES: Readonly<Record<string, string>> = { basic: "Free", pro: "Premium" };

const PLAN_TAGLINES: Readonly<Record<PlanId, string>> = {
  basic: "Para lanzar tu menú digital",
  pro: "Para locales que quieren más",
};

/** Display name of a plan; unknown values show as the most restrictive plan, like `planLimitsFor`. */
export function planName(plan: string): string {
  return PLAN_NAMES[plan] ?? "Free";
}

/** One-line pitch under the plan name. */
export function planTagline(plan: PlanId): string {
  return PLAN_TAGLINES[plan];
}

/** What a plan includes, as display lines. Limits come from `PLAN_LIMITS`; the rest is on every plan. */
export function planFeatures(plan: PlanId): string[] {
  const limits = PLAN_LIMITS[plan];
  const features = plan === "pro" ? ["Todo lo del plan Free"] : [];
  features.push(limits.maxProducts === null ? "Productos ilimitados" : `Hasta ${limits.maxProducts} productos en el menú`);
  if (plan === "basic") {
    if (limits.productPhotos) features.push("Una foto por producto");
    features.push("Link propio de tu menú", "Pedidos por WhatsApp y panel de seguimiento");
    if (limits.cashRegister) features.push("Cajas y arqueos");
    features.push("Repartidores, propinas y usuarios con roles");
    return features;
  }
  if (limits.customIngredients) features.push("Ingredientes personalizables con precio extra");
  if (limits.customColors) features.push("Colores propios en tu menú público");
  features.push("Reportes de ventas, repartidores y cajas");
  return features;
}

/** A cell of the comparison table: included, not included, a text, or "coming soon". */
export type ComparisonCell = boolean | "soon" | { text: string };

export interface ComparisonRow {
  label: string;
  free: ComparisonCell;
  premium: ComparisonCell;
}

/** Rows of the plan comparison table. Limits come from `PLAN_LIMITS`. */
export function planComparison(): ComparisonRow[] {
  const free = PLAN_LIMITS.basic;
  const premium = PLAN_LIMITS.pro;
  const products = (max: number | null): ComparisonCell => ({ text: max === null ? "Ilimitados" : `Hasta ${max}` });
  return [
    { label: "Productos en el menú", free: products(free.maxProducts), premium: products(premium.maxProducts) },
    { label: "Foto por producto", free: free.productPhotos, premium: premium.productPhotos },
    { label: "Link propio de tu menú", free: true, premium: true },
    { label: "Pedidos por WhatsApp", free: true, premium: true },
    { label: "Panel de pedidos y estados", free: true, premium: true },
    { label: "Cajas y arqueos", free: free.cashRegister, premium: premium.cashRegister },
    { label: "Repartidores y propinas", free: true, premium: true },
    { label: "Usuarios y roles", free: true, premium: true },
    { label: "Ingredientes personalizables", free: free.customIngredients, premium: premium.customIngredients },
    { label: "Colores propios del menú", free: free.customColors, premium: premium.customColors },
    { label: "Reportes de ventas", free: false, premium: true },
    { label: "Stock y recetas", free: false, premium: "soon" },
    { label: "Soporte", free: { text: "Por email" }, premium: { text: "Prioritario" } },
  ];
}
