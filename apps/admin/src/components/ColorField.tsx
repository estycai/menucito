import { useId, useRef, type KeyboardEvent } from "react";
import { normalizeHexColor } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface Swatch {
  hex: string;
  /** Spoken name of the swatch. */
  name: string;
}

/** Swatches offered for the page background (from the canvas). */
export const BACKGROUND_SWATCHES: readonly Swatch[] = [
  { hex: "#F7F5F2", name: "Crema" },
  { hex: "#FFFFFF", name: "Blanco" },
  { hex: "#FEF3C7", name: "Amarillo suave" },
  { hex: "#1C1917", name: "Negro" },
];

/** Swatches offered for the primary color (from the canvas). */
export const PRIMARY_SWATCHES: readonly Swatch[] = [
  { hex: "#C2410C", name: "Naranja" },
  { hex: "#15803D", name: "Verde" },
  { hex: "#1D4ED8", name: "Azul" },
  { hex: "#7E22CE", name: "Violeta" },
];

interface ColorFieldProps {
  label: string;
  /** What the owner typed or picked: any text, normalized only to compare with the swatches. */
  value: string;
  onChange: (value: string) => void;
  swatches: readonly Swatch[];
  /** Inline error for the hex field. */
  error?: string;
  /** Advisory under the hex field: shown in amber and never marks the field as invalid. */
  warning?: string;
}

/**
 * A color picker made of swatches (a radio group, arrow keys move the selection) and a free hex
 * field. Both edit the same text value; the form decides what is valid.
 */
export function ColorField({ label, value, onChange, swatches, error, warning }: ColorFieldProps) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = normalizeHexColor(value);
  // Roving tabindex: the selected swatch (or the first one) is the single tab stop of the group.
  const tabStop = Math.max(0, swatches.findIndex((swatch) => swatch.hex === current));

  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + swatches.length) % swatches.length;
    const swatch = swatches[next];
    if (!swatch) return;
    onChange(swatch.hex);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-[13px] font-bold">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2.5">
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap items-center gap-2.5">
          {swatches.map((swatch, index) => {
            const selected = swatch.hex === current;
            return (
              <button
                key={swatch.hex}
                ref={(element) => {
                  refs.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${swatch.name} ${swatch.hex}`}
                tabIndex={index === tabStop ? 0 : -1}
                onClick={() => onChange(swatch.hex)}
                onKeyDown={(event) => onKeyDown(event, index)}
                style={{ backgroundColor: swatch.hex }}
                className={cn(
                  "size-11 shrink-0 cursor-pointer rounded-full border-[#d6d3d1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  selected ? "border-[3px] border-ink" : "border",
                )}
              />
            );
          })}
        </div>
        <Input
          id={`${id}-hex`}
          value={value}
          maxLength={9}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label={`${label} en hexadecimal`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : warning ? `${id}-warning` : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-[110px] rounded-xl px-3 text-[15px]"
        />
      </div>
      {error ? (
        <p id={`${id}-error`} className="m-0 text-[13px] text-danger">
          {error}
        </p>
      ) : (
        warning && (
          <div id={`${id}-warning`}>
            <Notice tone="warning">{warning}</Notice>
          </div>
        )
      )}
    </div>
  );
}

/** Read-only color (Basic plan with colors saved before a downgrade): a swatch and its hex text. */
export function ColorReadOnly({ label, hex }: { label: string; hex: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" style={{ backgroundColor: hex }} className="size-6 shrink-0 rounded-full border border-[#d6d3d1]" />
      <span className="text-sm text-ink">
        {label}: <b>{hex}</b>
      </span>
    </div>
  );
}
