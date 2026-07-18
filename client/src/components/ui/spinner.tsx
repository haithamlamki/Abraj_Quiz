import { cn } from "@/lib/utils";

const sizeMap = {
  sm: "h-5 w-5 border-2",
  md: "h-8 w-8 border-2",
  lg: "h-12 w-12 border-[3px]",
} as const;

export interface SpinnerProps {
  size?: keyof typeof sizeMap;
  className?: string;
}

/**
 * Brand-colored loading spinner. Uses `text-primary` so the ring follows the
 * (tenant-aware) brand token; `border-b-transparent` creates the gap that reads
 * as spinning. Override the color with a `text-*` class via `className`.
 */
export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="loading"
      className={cn(
        "inline-block animate-spin rounded-full border-current border-b-transparent text-primary",
        sizeMap[size],
        className,
      )}
    />
  );
}
