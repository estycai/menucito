import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label: string;
  error?: string;
  /** Helper text shown under the input. */
  hint?: string;
  /** Short adornment inside the input, at the left (e.g. "$"). */
  prefix?: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, hint, prefix, id, className, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const describedBy = [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(" ");
    const input = (
      <Input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(prefix && "pl-8", className)}
        {...props}
      />
    );
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>{label}</Label>
        {prefix ? (
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted">
              {prefix}
            </span>
            {input}
          </div>
        ) : (
          input
        )}
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
FormField.displayName = "FormField";
