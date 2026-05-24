"use client";

import { useEffect, useState } from "react";
import { Zap, Heart, Clock, AlertTriangle, UserPlus, Star, Users, TrendingUp, Crown } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/shared/Skeleton";

const SEGMENT_ICONS: Record<string, React.ElementType> = {
  zap: Zap, heart: Heart, clock: Clock, alert: AlertTriangle,
  "user-plus": UserPlus, star: Star,
};
const SEGMENT_COLORS: Record<string, string> = {
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  blue:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
  amber:   "bg-amber-500/10 text-amber-400 border-amber-500/20",
  red:     "bg-red-500/10 text-red-400 border-red-500/20",
  violet:  "bg-violet-500/10 text-violet-400 border-violet-500/20",
  yellow:  "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
};
const TIER_COLORS: Record<string, string> = {
  Champions: "bg-yellow-500/10 text-yellow-400",
  Loyal:     "bg-emerald-500/10 text-emerald-400",
  Potential: "bg-blue-500/10 text-blue-400",
  "At Risk": "bg-red-500/10 text-red-400",
};

interface Segment {
  id: string; name: string; description: string; color: string; icon: string;
  count: number; percentage: number;
}
interface RFMEntry {
  id: string; name: string; phone: string; r: number; f: number; m: number;
  score: number; tier: string;
}

export default function ContactSegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [rfm, setRfm] = useState<RFMEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeSegment, setActiveSegment] = useState<string | null>(null);
  const [segContacts, setSegContacts] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [segLoading, setSegLoading] = useState(false);

  useEffect(() => {
    fetch("/api/contacts/segments")
      .then((r) => r.json())
      .then((d) => { setSegments(d.segments ?? []); setRfm(d.rfmLeaderboard ?? []); setTotal(d.total ?? 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadSegment = (id: string) => {
    setActiveSegment(id);
    setSegLoading(true);
    fetch(`/api/contacts/segments?segment=${id}`)
      .then((r) => r.json())
      .then((d) => setSegContacts(d.contacts ?? []))
      .catch(() => {})
      .finally(() => setSegLoading(false));
  };

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            Smart Segments
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-powered contact segmentation — {total.toLocaleString()} contacts analysed
          </p>
        </div>
        <Link href="/contacts" className="text-sm text-primary hover:underline">← All Contacts</Link>
      </div>

      {/* Segment cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
          : segments.map((seg) => {
              const Icon = SEGMENT_ICONS[seg.icon] ?? Users;
              const color = SEGMENT_COLORS[seg.color] ?? SEGMENT_COLORS.blue;
              const isActive = activeSegment === seg.id;
              return (
                <button
                  key={seg.id}
                  onClick={() => loadSegment(seg.id)}
                  className={`p-4 rounded-2xl border text-left transition-all hover:scale-[1.02] ${
                    isActive
                      ? `${color} ring-1 shadow-lg`
                      : "border-border/50 bg-card hover:border-border"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl border flex items-center justify-center mb-3 ${color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold">{seg.count.toLocaleString()}</p>
                  <p className="text-sm font-semibold mt-0.5">{seg.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{seg.description}</p>
                  <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full wa-gradient rounded-full" style={{ width: `${seg.percentage}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">{seg.percentage}% of contacts</p>
                </button>
              );
            })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Segment contacts panel */}
        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
          <div className="p-4 border-b border-border/50 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm">
                {activeSegment
                  ? `${segments.find((s) => s.id === activeSegment)?.name} Contacts`
                  : "Select a segment above"}
              </h3>
              {activeSegment && <p className="text-xs text-muted-foreground mt-0.5">{segContacts.length} contacts</p>}
            </div>
            {activeSegment && (
              <Link
                href={`/campaigns/create?segment=${activeSegment}`}
                className="text-xs wa-gradient text-white px-3 py-1.5 rounded-lg font-medium hover:opacity-90 transition-all"
              >
                Campaign →
              </Link>
            )}
          </div>
          <div className="overflow-y-auto max-h-80">
            {!activeSegment ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Click a segment card to see contacts
              </div>
            ) : segLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
              </div>
            ) : segContacts.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No contacts in this segment</div>
            ) : (
              <table className="w-full">
                <tbody>
                  {segContacts.map((c) => (
                    <tr key={c.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                            {c.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.phone}</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RFM Leaderboard */}
        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
          <div className="p-4 border-b border-border/50 flex items-center gap-2">
            <Crown className="w-4 h-4 text-yellow-400" />
            <h3 className="font-semibold text-sm">RFM Champions</h3>
            <span className="ml-auto text-xs text-muted-foreground">Recency · Frequency · Monetary</span>
          </div>
          <div className="overflow-y-auto max-h-80">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 rounded-xl" />)}
              </div>
            ) : rfm.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Add contacts with deal values to see RFM scores
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50">
                    {["Contact", "R", "F", "M", "Score", "Tier"].map((h) => (
                      <th key={h} className="text-left text-[10px] font-medium text-muted-foreground px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rfm.map((c, i) => (
                    <tr key={c.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground w-4">{i + 1}</span>
                          <span className="text-xs font-medium truncate max-w-[90px]">{c.name}</span>
                        </div>
                      </td>
                      {[c.r, c.f, c.m].map((v, j) => (
                        <td key={j} className="px-3 py-2.5">
                          <span className={`text-xs font-bold ${v >= 4 ? "text-emerald-400" : v >= 3 ? "text-amber-400" : "text-red-400"}`}>{v}</span>
                        </td>
                      ))}
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-bold">{c.score}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TIER_COLORS[c.tier] ?? ""}`}>
                          {c.tier}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* RFM explanation */}
      <div className="bg-card rounded-2xl border border-border/50 p-5">
        <h3 className="font-semibold text-sm mb-3">Understanding RFM Scoring</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          {[
            { letter: "R", name: "Recency", desc: "How recently they were contacted. Score 5 = contacted in last 7 days.", color: "text-emerald-400" },
            { letter: "F", name: "Frequency", desc: "How often they engage. Score 5 = very frequent interactions.", color: "text-blue-400" },
            { letter: "M", name: "Monetary", desc: "Deal value. Score 5 = top 10% by deal value.", color: "text-yellow-400" },
          ].map((item) => (
            <div key={item.letter} className="flex gap-3">
              <span className={`text-2xl font-black ${item.color} flex-shrink-0`}>{item.letter}</span>
              <div>
                <p className="font-semibold">{item.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
