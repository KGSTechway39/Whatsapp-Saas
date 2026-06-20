import { cn } from "@/lib/utils";
import { StatusType } from "@/types";

const statusConfig: Record<
  StatusType,
  { label: string; className: string }
> = {
  // Semantic tokens (theme-aware). Emerald (success) is reserved for
  // sent/delivered-style states only; pending→warning, rejected→destructive.
  active: {
    label: "Active",
    className: "bg-success/15 text-success border border-success/25",
  },
  inactive: {
    label: "Inactive",
    className: "bg-muted text-muted-foreground border border-border",
  },
  approved: {
    label: "Approved",
    className: "bg-success/15 text-success border border-success/25",
  },
  pending: {
    label: "Pending",
    className: "bg-warning/15 text-warning border border-warning/25",
  },
  rejected: {
    label: "Rejected",
    className: "bg-destructive/15 text-destructive border border-destructive/25",
  },
  running: {
    label: "Running",
    className: "bg-blue-500/15 text-blue-400 border border-blue-500/25",
  },
  completed: {
    label: "Completed",
    className: "bg-success/15 text-success border border-success/25",
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/15 text-destructive border border-destructive/25",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-purple-500/15 text-purple-400 border border-purple-500/25",
  },
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground border border-border",
  },
  invited: {
    label: "Invited",
    className: "bg-warning/15 text-warning border border-warning/25",
  },
};

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
  showDot?: boolean;
}

export function StatusBadge({
  status,
  className,
  showDot = true,
}: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.inactive;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium",
        config.className,
        className
      )}
    >
      {showDot && (
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            status === "active" || status === "approved" || status === "completed"
              ? "bg-success"
              : status === "pending" || status === "invited"
              ? "bg-warning"
              : status === "running"
              ? "bg-blue-400 animate-pulse"
              : status === "scheduled"
              ? "bg-purple-400"
              : "bg-current"
          )}
        />
      )}
      {config.label}
    </span>
  );
}
