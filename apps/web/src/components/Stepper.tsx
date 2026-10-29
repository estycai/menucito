interface StepperProps {
  /** What is being counted, used in the accessible names ("Quitar una unidad de Bacon"). */
  name: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/** A − N + control. The count is a polite live region so a screen reader hears each change. */
export function Stepper({ name, value, min, max, onChange }: StepperProps) {
  return (
    <div class="stepper">
      <button
        type="button"
        class="stepper-button"
        aria-label={`Quitar una unidad de ${name}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <span aria-hidden="true">−</span>
      </button>
      <span class="stepper-value" aria-live="polite" aria-atomic="true">
        {value}
      </span>
      <button
        type="button"
        class="stepper-button"
        aria-label={`Agregar una unidad de ${name}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
