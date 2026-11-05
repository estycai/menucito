import type { ReactNode } from "react";
import { Notice } from "@/components/AuthLayout";
import { cn } from "@/lib/utils";

/**
 * Wraps a screen the member can see but not edit. Every control inside is disabled by the browser
 * (`<fieldset disabled>`) and the buttons that would act are hidden; switches stay visible, disabled,
 * because they show a state. With `readOnly` false it renders the children untouched.
 */
export function ReadOnlyFieldset({
  readOnly,
  notice,
  className,
  children,
}: {
  readOnly: boolean;
  /** Explains why nothing can be changed, e.g. "Solo podés ver el menú.". */
  notice: string;
  className?: string;
  children: ReactNode;
}) {
  if (!readOnly) return <>{children}</>;
  return (
    <>
      <Notice tone="info">{notice}</Notice>
      <fieldset
        disabled
        className={cn(
          "m-0 min-w-0 border-0 p-0 [&_button:disabled:not([role=switch])]:hidden [&_input:disabled]:cursor-default [&_input:disabled]:opacity-100",
          className,
        )}
      >
        {children}
      </fieldset>
    </>
  );
}
