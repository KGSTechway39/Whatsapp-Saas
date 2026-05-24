import { cn } from "@/lib/utils";
import { StatusType } from "@/types";

const statusConfig: Record<
  StatusType,
  { label: string; className: string }
> = {
  active: {
    label: "Active",
    className:
      "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25",
  },
  inactive: {
    label: "Inactive",
    className: "bg-slate-500/15 text-slate-400 border border-slate-500/25",
  },
  approved: {
    label: "Approved",
    className:
      "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25",
  },
  pending: {
    label: "Pending",
    className: "bg-amber-500/15 text-amber-400 border border-amber-500/25",
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-500/15 text-red-400 border border-red-500/25",
  },
  running: {
    label: "Running",
    className: "bg-blue-500/15 text-blue-400 border border-blue-500/25",
  },
  completed: {
    label: "Completed",
    className:
      "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/15 text-red-400 border border-red-500/25",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-purple-500/15 text-purple-400 border border-purple-500/25",
  },
  draft: {
    label: "Draft",
    className: "bg-slate-500/15 text-slate-400 border border-slate-500/25",
  },
  invited: {
    label: "Invited",
    className: "bg-amber-500/15 text-amber-400 border border-amber-500/25",
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
              ? "bg-emerald-400"
              : status === "pending" || status === "invited"
              ? "bg-amber-400"
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
