"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { numbers as numbersApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { WhatsAppNumber } from "@/types";
import {
  Plus,
  Edit2,
  Trash2,
  Smartphone,
  MoreVertical,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function NumbersPage() {
  const [numberList, setNumberList] = useState<WhatsAppNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    numbersApi.list()
      .then((data) => setNumberList(data.numbers))
      .catch(() => toast.error("Failed to load numbers"))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await numbersApi.remove(id);
      setNumberList((prev) => prev.filter((n) => n.id !== id));
      toast.success("Number removed");
      setOpenMenu(null);
    } catch {
      toast.error("Failed to remove number");
    }
  };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="WhatsApp Numbers"
        subtitle="Manage your connected WhatsApp Business numbers"
        action={
          <Link
            href="/numbers/connect"
            className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
          >
            <Plus className="w-4 h-4" />
            Connect Number
          </Link>
        }
      />

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {numberList.map((num) => (
          <div
            key={num.id}
            className="bg-card rounded-2xl border border-border/50 p-6 hover:border-border transition-all"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Smartphone className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">{num.phoneNumber}</p>
                  <p className="text-sm text-muted-foreground">{num.displayName}</p>
                </div>
              </div>
              <div className="relative">
                <button
                  onClick={() => setOpenMenu(openMenu === num.id ? null : num.id)}
                  className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                >
                  <MoreVertical className="w-4 h-4 text-muted-foreground" />
                </button>
                {openMenu === num.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
                    <div className="absolute right-0 top-8 bg-card border border-border rounded-xl shadow-xl z-20 overflow-hidden w-36">
                      <button className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors w-full text-left">
                        <Edit2 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => handleDelete(num.id)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors w-full text-left"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Status", value: <StatusBadge status={num.status} /> },
                { label: "Daily Limit", value: <span className="text-sm font-medium">{num.dailyLimit.toLocaleString()}</span> },
                { label: "Messages Sent", value: <span className="text-sm font-medium text-primary">{num.messagesSent.toLocaleString()}</span> },
                { label: "Connected", value: <span className="text-sm">{formatDate(num.connectedDate)}</span> },
              ].map(({ label, value }) => (
                <div key={label} className="bg-muted/30 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  {value}
                </div>
              ))}
            </div>

            {num.status === "active" && (
              <div className="mt-4 flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Connected and sending
              </div>
            )}
          </div>
        ))}

        <Link
          href="/numbers/connect"
          className="flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-center group"
        >
          <div className="w-12 h-12 rounded-2xl bg-muted/50 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
            <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <div>
            <p className="font-medium text-sm group-hover:text-primary transition-colors">
              Connect New Number
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Link your WhatsApp Business account
            </p>
          </div>
        </Link>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="p-5 border-b border-border/50">
          <h3 className="font-semibold">All Numbers</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                {["Phone Number", "Status", "Daily Limit", "Messages Sent", "Connected Date", "Actions"].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {numberList.map((num) => (
                <tr key={num.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{num.phoneNumber}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4"><StatusBadge status={num.status} /></td>
                  <td className="px-5 py-4 text-sm">{num.dailyLimit.toLocaleString()}/day</td>
                  <td className="px-5 py-4 text-sm font-medium">{num.messagesSent.toLocaleString()}</td>
                  <td className="px-5 py-4 text-sm text-muted-foreground">{formatDate(num.connectedDate)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1">
                      <button className="p-1.5 rounded-lg hover:bg-accent transition-colors" title="Edit">
                        <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => handleDelete(num.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
