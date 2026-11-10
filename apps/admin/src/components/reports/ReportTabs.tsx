import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface ReportTabOption {
  key: string;
  label: string;
}

interface ReportTabsProps {
  tabs: readonly ReportTabOption[];
  active: string;
  onSelect: (key: string) => void;
}

/** Tab header of Reports; Campaigns stays gray until it exists. */
export function ReportTabs({ tabs, active, onSelect }: ReportTabsProps) {
  return (
    <nav aria-label="Pestañas de Reportes" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-current={active === tab.key ? "page" : undefined}
          onClick={() => onSelect(tab.key)}
          className={cn(
            "min-h-11 shrink-0 cursor-pointer rounded-t-xl px-4 text-sm font-bold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary",
            active === tab.key ? "bg-white text-primary shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted hover:text-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
      <button
        type="button"
        aria-disabled="true"
        title="Próximamente"
        onClick={() => toast.info("Las campañas llegan pronto.")}
        className="min-h-11 shrink-0 cursor-not-allowed rounded-t-xl px-4 text-sm font-bold whitespace-nowrap text-line-strong"
      >
        Campañas
      </button>
    </nav>
  );
}
