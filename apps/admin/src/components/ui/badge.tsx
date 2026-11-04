import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("rounded-md text-xs font-bold", {
  variants: {
    tone: {
      neutral: "bg-line text-ink",
      subtle: "bg-bg text-muted",
      info: "bg-info-soft text-info",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      danger: "bg-danger-soft text-danger",
      new: "bg-status-new-soft text-status-new",
      preparing: "bg-status-preparing-soft text-status-preparing",
      ready: "bg-status-ready-soft text-status-ready",
      sent: "bg-status-sent-soft text-status-sent",
    },
    size: {
      sm: "px-2 py-0.5",
      md: "px-2.5 py-1",
    },
  },
  defaultVariants: { tone: "neutral", size: "sm" },
});

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
