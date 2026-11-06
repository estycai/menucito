import type { ReactNode } from "react";
import {
  ANNUAL_DISCOUNT_PERCENT,
  formatArs,
  planAnnualSavingsCents,
  planChargeCents,
  planMonthlyEquivalentCents,
  type BillingCycle,
  type PlanId,
} from "@menucito/shared";
import { Button } from "@/components/ui/button";
import { planFeatures, planName, planTagline } from "@/lib/plans";
import { cn } from "@/lib/utils";

interface PlanCardProps {
  plan: PlanId;
  cycle: BillingCycle;
  isCurrent: boolean;
  /**
   * Starts the purchase of `plan` for `cycle`. Mercado Pago plugs in here: while it is missing the
   * button of a paid plan is disabled and says the payment is coming soon.
   */
  onSubscribe?: (plan: PlanId, cycle: BillingCycle) => void;
  /** Extra content under the feature list, e.g. the test-only switch. */
  children?: ReactNode;
}

/** One plan of the "Plan y pagos" screen: name, price for the chosen cycle, what it includes and its action. */
export function PlanCard({ plan, cycle, isCurrent, onSubscribe, children }: PlanCardProps) {
  const isPaid = planChargeCents(plan, "monthly") > 0;
  const annual = isPaid && cycle === "annual";
  const monthlyEquivalent = formatArs(planMonthlyEquivalentCents(plan, cycle));
  return (
    <section
      aria-labelledby={`plan-${plan}`}
      className={cn(
        "flex flex-col gap-6 rounded-2xl border bg-white p-6 sm:p-8",
        isPaid ? "border-2 border-primary bg-primary-soft" : "border-line",
      )}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={`plan-${plan}`} className="m-0 font-display text-[28px] font-bold">
            {planName(plan)}
          </h2>
          {isPaid && <span className="rounded-full bg-primary px-2.5 py-[5px] text-xs font-bold text-white">Más elegido</span>}
        </div>
        <span className="text-sm text-muted">{planTagline(plan)}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="font-display text-[56px] font-bold leading-none">{monthlyEquivalent}</span>
          <span className="text-sm text-muted">/ mes</span>
          {annual && (
            <span className="text-lg text-muted line-through">
              <span className="sr-only">Precio mensual: </span>
              {formatArs(planChargeCents(plan, "monthly"))}
            </span>
          )}
        </div>
        <span className="text-sm text-muted">
          {!isPaid
            ? "Sin tarjeta, sin vencimiento"
            : annual
              ? `Facturado ${formatArs(planChargeCents(plan, "annual"))} una vez por año`
              : "Facturación mensual"}
        </span>
        {annual && (
          <span className="self-start rounded-full bg-success-soft px-2.5 py-1 text-[13px] font-bold text-success">
            {ANNUAL_DISCOUNT_PERCENT}% off · ahorrás {formatArs(planAnnualSavingsCents(plan))} al año
          </span>
        )}
      </div>

      {isCurrent ? (
        <Button variant="outline" disabled>
          Tu plan actual
        </Button>
      ) : (
        isPaid && (
          <Button disabled={!onSubscribe} onClick={() => onSubscribe?.(plan, cycle)}>
            {onSubscribe ? `Pasar a ${planName(plan)}` : "Pago disponible pronto"}
          </Button>
        )
      )}

      <div className={cn("h-px", isPaid ? "bg-[#f0d9c4]" : "bg-line")} />

      <ul className="m-0 flex list-none flex-col gap-3.5 p-0 text-[15px]">
        {planFeatures(plan).map((feature) => (
          <li key={feature} className="flex items-start gap-3">
            <span aria-hidden="true" className="font-bold text-primary">
              ✓
            </span>
            {feature}
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}
