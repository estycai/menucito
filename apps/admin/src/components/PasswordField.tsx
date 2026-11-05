import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PasswordFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
  hint?: string;
}

/** Password input with a "Mostrar" / "Ocultar" button, so whoever types it can check it. */
export const PasswordField = React.forwardRef<HTMLInputElement, PasswordFieldProps>(
  ({ label, error, hint, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const [visible, setVisible] = React.useState(false);
    const describedBy = [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(" ");

    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>{label}</Label>
        <div className="flex items-stretch gap-2">
          <Input
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            className="min-w-0 flex-1"
            {...props}
          />
          <button
            type="button"
            aria-pressed={visible}
            onClick={() => setVisible((value) => !value)}
            className="min-h-12 min-w-[84px] shrink-0 cursor-pointer rounded-xl border border-line-strong bg-white px-3 text-sm font-bold text-ink hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {visible ? "Ocultar" : "Mostrar"}
            <span className="sr-only"> contraseña</span>
          </button>
        </div>
        {hint && (
          <p id={`${inputId}-hint`} className="m-0 text-xs text-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${inputId}-error`} className="m-0 text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    );
  },
);
PasswordField.displayName = "PasswordField";
