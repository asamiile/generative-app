import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center whitespace-nowrap font-medium", {
  variants: {
    variant: {
      outline: "rounded-full border border-app-border text-ink-muted",
      accent: "rounded-md bg-accent font-mono font-semibold text-accent-on",
    },
    size: {
      default: "px-2 py-0.5 text-xs",
      sm: "px-1.5 py-0.5 text-[10px]",
    },
  },
  defaultVariants: { variant: "outline", size: "default" },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size, className }))} {...props} />;
}

export { Badge, badgeVariants };
