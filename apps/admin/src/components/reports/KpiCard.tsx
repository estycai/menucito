import { useId } from "react";
import { formatChange } from "@/lib/reports";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  /** How the number is calculated; shown by the (?) on hover and focus. */
  hint: string;
  /** Variation against the previous period, in percent; `null` when there is nothing to compare. */
  change?: number | null;
  /** For indicators where going up is bad (delivery time): colors the variation in red. */
  invert?: boolean;
  secondary?: string;
}

/**
 * One indicator with its (?) and the comparison against the previous period of the same length.
 * The tooltip opens on hover and on keyboard focus, and the button is 18 px so it stays discreet.
 */
export function KpiCard({ label, value, hint, change, invert = false, secondary }: KpiCardProps) {
  const id = useId();
  const variation = change ?? null;
  const good = variation !== null && (invert ? variation < 0 : variation > 0);
  const bad = variation !== null && (invert ? variation > 0 : variation < 0);

  return (
    <article className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="m-0 text-sm font-bold text-muted">{label}</h3>
        <span className="group relative inline-flex shrink-0">
          <button
            type="button"
            aria-label={`Cómo se calcula ${label}`}
            aria-describedby={id}
            className="inline-flex size-[18px] cursor-help items-center justify-center rounded-full border border-line-strong text-[11px] font-bold text-muted focus-visible:outline-2 focus-visible:outline-primary"
          >
            ?
          </button>
          <span
            id={id}
            role="tooltip"
            className="pointer-events-none absolute top-full right-0 z-30 mt-2 w-64 rounded-xl border border-line bg-white p-3 text-left text-xs font-normal text-ink opacity-0 shadow-lg transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          >
            {hint}
          </span>
        </span>
      </div>
      <b className="font-display text-[26px] leading-tight font-extrabold break-words tabular-nums">{value}</b>
      {secondary && <span className="text-xs text-muted">{secondary}</span>}
      <span className="text-xs">
        {variation === null ? (
          <span className="text-muted">Sin datos para comparar</span>
        ) : (
          <span className={cn("font-bold", good && "text-success", bad && "text-danger", !good && !bad && "text-muted")}>
            {formatChange(variation)} <span className="font-normal text-muted">vs período anterior</span>
          </span>
        )}
      </span>
    </article>
  );
}
