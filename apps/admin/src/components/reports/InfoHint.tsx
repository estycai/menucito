import { useId } from "react";

/** The (?) of a block: its explanation opens on hover and on keyboard focus. */
export function InfoHint({ label, children }: { label: string; children: string }) {
  const id = useId();
  return (
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
        {children}
      </span>
    </span>
  );
}
