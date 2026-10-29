import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center font-bold transition-colors disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary cursor-pointer",
  {
    variants: {
      variant: {
        primary: "min-h-[52px] rounded-[14px] bg-primary text-base text-white hover:bg-[#9a3412]",
        outline: "min-h-12 rounded-xl border border-[#d6d3d1] bg-white text-[15px] text-ink hover:bg-bg",
        ghost: "min-h-10 rounded-xl px-4 text-[15px] text-ink hover:bg-tab",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />;
}
