"use client";

import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-muted",
        className
      )}
    />
  );
}

export function StatsCardSkeleton() {
  return (
    <div className="bg-card rounded-2xl border border-border/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="w-9 h-9 rounded-xl" />
      </div>
      <Skeleton className="h-8 w-28 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-b border-border/30">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <Skeleton className={`h-4 ${i === 0 ? "w-36" : "w-20"}`} />
          {i === 0 && <Skeleton className="h-3 w-24 mt-1.5" />}
        </td>
      ))}
    </tr>
  );
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="w-full space-y-2" style={{ height }}>
      <div className="flex items-end gap-1.5 h-full px-2">
        {[65, 40, 75, 55, 80, 45, 70, 60, 85, 50, 65, 75, 40, 60].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm animate-pulse bg-muted"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="bg-card rounded-2xl border border-border/50 p-6 space-y-3">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-3/4" : "w-full"}`} />
      ))}
    </div>
  );
}
