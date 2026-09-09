import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-[var(--r-sm)] border border-transparent font-semibold cursor-pointer select-none transition-[background,border-color,opacity,transform] duration-[var(--dur-1)] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--focus)] focus-visible:outline-offset-2 active:translate-y-[0.5px]",
  {
    variants: {
      variant: {
        primary: "bg-[var(--primary)] text-[var(--primary-fg)] hover:brightness-[1.07]",
        secondary:
          "bg-[var(--surface)] text-[var(--foreground)] border-[var(--border-strong)] hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)]",
        ghost: "bg-transparent text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]",
        danger:
          "bg-transparent text-[var(--danger)] border-[color-mix(in_srgb,var(--danger)_45%,transparent)] hover:bg-[var(--danger-subtle)]",
        accent: "bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-[1.05]",
      },
      size: {
        sm: "h-8 px-3 text-[12px]",
        md: "h-[34px] px-[13px] text-[13px]",
        lg: "h-11 px-[18px] text-[14px]",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
});

export { buttonVariants };
