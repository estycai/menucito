import { PLAN_IDS, type PlanId } from "@menucito/shared";
import { PlanCard } from "@/components/PlanCard";
import { Button } from "@/components/ui/button";
import { PLAN_SWITCH_ENABLED } from "@/lib/config";
import { useChangePlan } from "@/lib/plan";
import { planName } from "@/lib/plans";
import { useMyRestaurant } from "@/lib/restaurant";

/**
 * "Plan y pagos": the current plan and the two plans side by side. While payments do not exist, a
 * build flag (`VITE_PLAN_SWITCH`) shows a free switch; Mercado Pago will replace it later.
 */
export function PlanPage() {
  // `RequireRestaurant` guarantees the restaurant is loaded.
  const { data: restaurant } = useMyRestaurant();
  const changePlan = useChangePlan();
  if (!restaurant) return null;

  const currentName = planName(restaurant.plan);

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5">
      <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Plan y pagos</h1>
      <p className="m-0 text-[15px]">
        Tu plan actual: <strong>Plan {currentName}</strong>
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {PLAN_IDS.map((plan) => {
          const isCurrent = plan === (restaurant.plan === "pro" ? "pro" : "basic");
          return (
            <PlanCard key={plan} plan={plan} isCurrent={isCurrent}>
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

      {!PLAN_SWITCH_ENABLED && <p className="m-0 text-[15px] text-muted">El pago de planes estará disponible pronto.</p>}
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
