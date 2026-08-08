import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        accent: "bg-accent font-semibold text-accent-on hover:brightness-110",
        outline: "border border-app-border text-ink-secondary hover:bg-app-surfaceAlt",
        ghost: "text-ink-muted hover:bg-app-surfaceAlt hover:text-ink-secondary",
        subtle:
          "border border-app-border bg-[#0a0e12]/75 text-ink-secondary backdrop-blur-sm hover:bg-app-surfaceAlt",
      },
      size: {
        default: "px-6 py-3",
        sm: "px-3.5 py-1.5 text-xs",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "outline", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
