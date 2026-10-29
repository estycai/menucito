import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * "Subir"/"Bajar" buttons (44 px targets). Up/down buttons instead of drag-and-drop: they work the
 * same with mouse, touch and keyboard and do not fight page scrolling on phones.
 */
export function ReorderButtons({
  name,
  isFirst,
  isLast,
  disabled,
  onMove,
  className,
}: {
  /** What is moved, for screen readers ("Subir Hamburguesas"). */
  name: string;
  isFirst: boolean;
  isLast: boolean;
  disabled?: boolean;
  onMove: (direction: -1 | 1) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0", className)}>
      <IconButton label={`Subir ${name}`} disabled={disabled || isFirst} onClick={() => onMove(-1)}>
        <path d="m6 15 6-6 6 6" />
      </IconButton>
      <IconButton label={`Bajar ${name}`} disabled={disabled || isLast} onClick={() => onMove(1)}>
        <path d="m6 9 6 6 6-6" />
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label.split(" ")[0]}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[10px] text-ink hover:bg-tab focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
