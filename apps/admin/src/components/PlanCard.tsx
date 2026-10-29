import type { ReactNode } from "react";
import type { PlanId } from "@menucito/shared";
import { ProBadge } from "@/components/ProBadge";
import { planFeatures, planName } from "@/lib/plans";
import { cn } from "@/lib/utils";

interface PlanCardProps {
  plan: PlanId;
  isCurrent: boolean;
  /** Extra content under the feature list, e.g. the switch button. */
  children?: ReactNode;
}

/** One plan of the "Plan y pagos" screen: name, what it includes and a "Plan actual" mark. */
export function PlanCard({ plan, isCurrent, children }: PlanCardProps) {
  return (
    <section
      aria-labelledby={`plan-${plan}`}
      className={cn(
        "flex flex-col gap-4 rounded-2xl border bg-white p-6",
        isCurrent ? "border-2 border-primary" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 id={`plan-${plan}`} className="m-0 font-display text-xl font-extrabold">
          {planName(plan)}
        </h2>
        {plan === "pro" && <ProBadge />}
        {isCurrent && (
          <span className="rounded-full bg-tab px-2.5 py-[3px] text-xs font-bold text-ink">Plan actual</span>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px]">
        {planFeatures(plan).map((feature) => (
          <li key={feature} className="flex items-start gap-2">
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
