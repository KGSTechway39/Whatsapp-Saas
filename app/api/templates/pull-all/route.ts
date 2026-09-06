/**
 * One-button "get everything from Meta" for a WABA.
 *
 *   POST → { mine, available, summary }
 *
 * Two things live under "templates at Meta", and conflating them is what made
 * this app claim four sendable templates while every send failed:
 *
 *   • MINE      — templates that exist on this tenant's WABA and are APPROVED.
 *                 These are real and sendable. Mirrored into `templates`.
 *   • AVAILABLE — Meta's Template Library: pre-written templates Meta offers
 *                 to any WABA. They are NOT yours and NOT sendable until you
 *                 add them to your WABA and Meta approves them. Returned as a
 *                 catalogue to pick from, never written into the library as if
 *                 they were owned.
 *
 * So this endpoint fetches everything Meta will tell us about, in one call,
 * while keeping the two categories honestly separate.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { GRAPH_API_BASE } from "@/lib/meta-version";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Meta's Template Library is organised by category; there is no "all" filter. */
const LIBRARY_CATEGORIES = ["UTILITY", "AUTHENTICATION", "MARKETING"] as const;

interface LibraryItem {
  name: string;
  displayName: string;
  category: string;
  topic: string | null;
  language: string;
  body: string;
  header: string;
  footer: string;
}

function prettyName(snake: string): string {
  return snake.split(/[_-]/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: num } = await supabase
    .from("whatsapp_numbers")
    .select("waba_id, access_token")
    .eq("user_id", user.id)
    .eq("status", "active")
    .not("waba_id", "is", null)
    .not("access_token", "is", null)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle<{ waba_id: string; access_token: string }>();

  if (!num) {
    return NextResponse.json(
      { error: "Connect a WhatsApp number first.", code: "NO_NUMBER" },
      { status: 409 },
    );
  }

  const token = await decrypt(num.access_token);
  const errors: string[] = [];

  // ── 1. What this WABA actually owns ──────────────────────────────────────
  let mineTotal = 0;
  let mineApproved = 0;
  try {
    const url = new URL(`${GRAPH_API_BASE}/${num.waba_id}/message_templates`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("fields", "name,status,language,category");
    url.searchParams.set("limit", "200");
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? `Graph ${res.status}`);
    const rows = (data.data ?? []) as { status: string }[];
    mineTotal = rows.length;
    mineApproved = rows.filter((r) => r.status === "APPROVED").length;
  } catch (err) {
    errors.push(`your templates: ${(err as Error).message}`);
  }

  // ── 2. Everything Meta offers, across every category ─────────────────────
  const available: LibraryItem[] = [];
  for (const category of LIBRARY_CATEGORIES) {
    try {
      const url = new URL(`${GRAPH_API_BASE}/${num.waba_id}/template_library`);
      url.searchParams.set("access_token", token);
      url.searchParams.set("category", category);
      url.searchParams.set("language", "en_US");
      url.searchParams.set("limit", "200");
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        // A category Meta doesn't offer for this WABA is not an error worth
        // surfacing — MARKETING is routinely empty.
        continue;
      }
      for (const t of (data.data ?? []) as Record<string, string>[]) {
        available.push({
          name: t.name,
          displayName: prettyName(t.name),
          category: t.category ?? category,
          topic: t.topic ?? null,
          language: t.language ?? "en_US",
          body: t.body ?? "",
          header: t.header ?? "",
          footer: t.footer ?? "",
        });
      }
    } catch (err) {
      errors.push(`${category} library: ${(err as Error).message}`);
    }
  }

  logger.info("templates: pull-all", {
    wabaId: num.waba_id, mineTotal, mineApproved, available: available.length,
  });

  return NextResponse.json({
    wabaId: num.waba_id,
    mine: { total: mineTotal, approved: mineApproved },
    available,
    summary:
      mineApproved > 0
        ? `${mineApproved} approved template${mineApproved === 1 ? "" : "s"} on your WhatsApp account` +
          (available.length ? `, plus ${available.length} ready to add from Meta.` : ".")
        : available.length
          ? `Your WhatsApp account has no templates yet. ${available.length} are ready to add from Meta — pick one and Meta will approve it.`
          : "No templates found, and Meta's library is unavailable for this account.",
    errors,
  });
}
