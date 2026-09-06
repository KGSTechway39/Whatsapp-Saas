import { cn } from "@/lib/utils";
import { StatusType } from "@/types";

/**
 * v3 status vocabulary: every state is a solid tinted PILL — an ink paired with
 * its own soft ground (--success / --success-soft), never an opacity overlay.
 *
 * The design only ever shows three signal colours plus neutral, so states
 * collapse onto them: anything settled/healthy is green, anything in-flight or
 * awaiting a human is amber, anything broken is red, and anything inert (draft,
 * inactive, scheduled) is neutral. "running" and "scheduled" lose their old
 * blue/purple, which had no counterpart in the palette.
 */
const statusConfig: Record<StatusType, { label: string; className: string }> = {
  active:    { label: "Active",    className: "pill-success" },
  inactive:  { label: "Inactive",  className: "pill-neutral" },
  approved:  { label: "Approved",  className: "pill-success" },
  pending:   { label: "Pending",   className: "pill-warning" },
  rejected:  { label: "Rejected",  className: "pill-danger"  },
  running:   { label: "Running",   className: "pill-success" },
  completed: { label: "Completed", className: "pill-success" },
  failed:    { label: "Failed",    className: "pill-danger"  },
  scheduled: { label: "Scheduled", className: "pill-neutral" },
  draft:     { label: "Draft",     className: "pill-neutral" },
  invited:   { label: "Invited",   className: "pill-warning" },
};

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
  showDot?: boolean;
}

export function StatusBadge({
  status,
  className,
  showDot = false,
}: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.inactive;

  return (
    <span className={cn("pill", config.className, className)}>
      {showDot && (
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full bg-current",
            status === "running" && "animate-pulse"
          )}
        />
      )}
      {config.label}
    </span>
  );
}
