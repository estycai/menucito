import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name; the switch has no visible text. */
  "aria-label": string;
  disabled?: boolean;
}

/**
 * On/off toggle (`role="switch"`). The visible track is 44 x 24 px with a 20 px knob and a 2 px gap
 * on every side; the transparent button around it keeps the 44 x 44 px touch target.
 */
export function Switch({ checked, onCheckedChange, disabled, "aria-label": ariaLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="group inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors duration-150 ease-out group-focus-visible:ring-2 group-focus-visible:ring-primary group-focus-visible:ring-offset-2 motion-reduce:transition-none",
          checked ? "bg-success" : "bg-switch-off",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}
