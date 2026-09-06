import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface StatsCardProps {
  title: string;
  value: string | number;
  /**
   * Kept for source compatibility with the ~20 call sites that pass one, but no
   * longer rendered as a tile: the v3 KPI card carries no icon. Passing it is
   * harmless; new call sites can omit it.
   */
  icon?: LucideIcon;
  trend?: number;
  trendLabel?: string;
  /** @deprecated The v3 card has no icon tile — these are accepted and ignored. */
  iconColor?: string;
  /** @deprecated The v3 card has no icon tile — these are accepted and ignored. */
  iconBg?: string;
  suffix?: string;
  prefix?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * The v3 KPI card: a mono eyebrow, an oversized figure, then a tinted delta
 * pill sitting beside a plain-language note.
 *
 * The delta is a solid tinted pill (bg-success-soft / text-success), not an
 * opacity overlay — that pairing is the design's status vocabulary and is what
 * the pill-* helpers in globals.css encode.
 */
export function StatsCard({
  title,
  value,
  trend,
  trendLabel,
  suffix,
  prefix,
  children,
  className,
}: StatsCardProps) {
  const isPositive = trend !== undefined && trend >= 0;

  return (
    <div className={cn("stat-card flex flex-col gap-3", className)}>
      <p className="text-eyebrow">{title}</p>

      <div className="flex items-baseline gap-1.5">
        {prefix && (
          <span className="text-xl font-bold text-muted-foreground">{prefix}</span>
        )}
        <span className="text-4xl font-extrabold tracking-tight leading-none">
          {value}
        </span>
        {suffix && (
          <span className="text-base font-bold text-muted-foreground">{suffix}</span>
        )}
      </div>

      {(trend !== undefined || trendLabel) && (
        <div className="flex items-center gap-2 flex-wrap">
          {trend !== undefined && (
            <span
              className={cn(
                "pill font-mono normal-case tracking-normal",
                isPositive ? "pill-success" : "pill-danger"
              )}
            >
              {isPositive ? "+" : ""}
              {trend}%
            </span>
          )}
          {trendLabel && (
            <span className="text-xs text-muted-foreground leading-snug">
              {trendLabel}
            </span>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
