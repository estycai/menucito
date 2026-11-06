import { useState } from "react";
import { ANNUAL_DISCOUNT_PERCENT, PLAN_IDS, type BillingCycle, type PlanId } from "@menucito/shared";
import { PlanCard } from "@/components/PlanCard";
import { PlanComparison } from "@/components/PlanComparison";
import { Button } from "@/components/ui/button";
import { PLAN_SWITCH_ENABLED } from "@/lib/config";
import { useChangePlan } from "@/lib/plan";
import { planName } from "@/lib/plans";
import { useMyRestaurant } from "@/lib/restaurant";
import { cn } from "@/lib/utils";

/**
 * "Plan y pagos": the current plan, a monthly/annual toggle, the two plans side by side and a
 * comparison table. While payments do not exist, a build flag (`VITE_PLAN_SWITCH`) shows a free
 * switch; Mercado Pago will replace it by passing `onSubscribe` to `PlanCard`.
 */
export function PlanPage() {
  // `RequireRestaurant` guarantees the restaurant is loaded.
  const { data: restaurant } = useMyRestaurant();
  const changePlan = useChangePlan();
  const [cycle, setCycle] = useState<BillingCycle>("annual");
  if (!restaurant) return null;

  const currentName = planName(restaurant.plan);

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Plan y pagos</h1>
          <p className="m-0 text-[15px]">
            Tu plan actual: <strong>Plan {currentName}</strong>
          </p>
        </div>
        <CycleToggle cycle={cycle} onChange={setCycle} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {PLAN_IDS.map((plan) => {
          const isCurrent = plan === (restaurant.plan === "pro" ? "pro" : "basic");
          return (
            <PlanCard key={plan} plan={plan} cycle={cycle} isCurrent={isCurrent}>
              {PLAN_SWITCH_ENABLED && !isCurrent && (
                <SwitchPlan
                  plan={plan}
                  pending={changePlan.isPending}
                  failed={changePlan.isError}
                  onSwitch={() => changePlan.mutate({ plan })}
                />
              )}
            </PlanCard>
          );
        })}
      </div>

      <PlanComparison />

      <div className="flex flex-col gap-1.5 text-sm text-muted">
        <p className="m-0">Los precios están en pesos argentinos e incluyen impuestos.</p>
        <p className="m-0">
          Si bajás de plan no perdés nada: tus datos se guardan y las funciones Premium se ocultan hasta que vuelvas.
        </p>
        {!PLAN_SWITCH_ENABLED && <p className="m-0">El pago de planes estará disponible pronto.</p>}
      </div>
    </div>
  );
}

interface CycleToggleProps {
  cycle: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
}

/** Monthly / annual switch; the annual side carries the discount. */
function CycleToggle({ cycle, onChange }: CycleToggleProps) {
  const option = (value: BillingCycle) =>
    cn(
      "min-h-10 cursor-pointer rounded-full px-5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
      cycle === value ? "bg-ink text-white" : "bg-transparent text-muted hover:text-ink",
    );
  return (
    <div role="group" aria-label="Frecuencia de pago" className="flex gap-1 rounded-full border border-line bg-tab p-1">
      <button type="button" aria-pressed={cycle === "monthly"} className={option("monthly")} onClick={() => onChange("monthly")}>
        Mensual
      </button>
      <button type="button" aria-pressed={cycle === "annual"} className={option("annual")} onClick={() => onChange("annual")}>
        Anual <span className={cycle === "annual" ? "text-[#fdba74]" : "text-primary"}>-{ANNUAL_DISCOUNT_PERCENT}%</span>
      </button>
    </div>
  );
}

interface SwitchPlanProps {
  plan: PlanId;
  pending: boolean;
  failed: boolean;
  onSwitch: () => void;
}

/** Test-only notice and button to move to `plan` for free. */
function SwitchPlan({ plan, pending, failed, onSwitch }: SwitchPlanProps) {
  return (
    <div className="mt-auto flex flex-col gap-3">
      <p className="m-0 text-[13px] text-muted">Modo de prueba: el cambio de plan es gratuito y no se cobra nada.</p>
      <Button variant="outline" disabled={pending} onClick={onSwitch}>
        {pending ? "Cambiando…" : `Cambiar a Plan ${planName(plan)}`}
      </Button>
      {failed && !pending && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          No pudimos cambiar el plan. Probá de nuevo.
        </p>
      )}
    </div>
  );
}
