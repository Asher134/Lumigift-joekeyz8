import { clsx } from "clsx";
import { forwardRef } from "react";

export type BadgeVariant =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "error"
  | "info";

export type BadgeSize = "sm" | "md" | "lg";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = "secondary", size = "md", className, children, ...props },
  ref
) {
  return (
    <span
      ref={ref}
      className={clsx(
        "badge",
        `badge--${variant}`,
        size !== "md" && `badge--${size}`,
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
});

Badge.displayName = "Badge";
