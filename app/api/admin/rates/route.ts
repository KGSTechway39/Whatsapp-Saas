/**
 * Admin: rate & markup config editor (platform-owner only).
 *
 * Lets you change Meta wholesale rates, per-tier markup/fees, and global settings
 * without code. Wholesale changes are VERSIONED (a new `meta_rates` row), so the
 * old rate is preserved for back-dated margin reports.
 *
 *   GET  → { rates, tiers, settings }   (current config; nulls if 017 not applied)
 *   POST { rates?, tiers?, settings? }  → applies changes, returns fresh config
 *
 * Gated by requireAdmin() (ADMIN_EMAILS allowlist).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE"] as const;
type Category = (typeof CATEGORIES)[number];
type Rates = Record<Category, number>;

interface TierRow {
  tier: string;
  model: string;
  billing_mode: string;
  waba_mode: string;
  default_markup_bps: number;
  monthly_fee_paise: number;
  onboarding_fee_paise: number;
  monthly_msg_cap: number | null;
}
interface Settings {
  buffer_bps: number;
  min_topup_paise: number;
  default_low_balance_threshold_paise: number;
  credit_validity_months: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadConfig(supabase: any) {
  // Latest wholesale per category (one query, reduce to newest per category).
  let rates: Rates | null = null;
  const { data: rateRows, error: rErr } = await supabase
    .from("meta_rates")
    .select("category, wholesale_paise, effective_from")
    .eq("region", "IN")
    .order("effective_from", { ascending: false });
  if (!rErr && rateRows) {
    const seen: Partial<Rates> = {};
    for (const row of rateRows as { category: Category; wholesale_paise: number }[]) {
      if (seen[row.category] === undefined) seen[row.category] = Number(row.wholesale_paise);
    }
    rates = CATEGORIES.reduce((acc, c) => {
      acc[c] = seen[c] ?? 0;
      return acc;
    }, {} as Rates);
  }

  const { data: tiers } = await supabase
    .from("plan_tiers")
    .select("tier, model, billing_mode, waba_mode, default_markup_bps, monthly_fee_paise, onboarding_fee_paise, monthly_msg_cap")
    .order("monthly_fee_paise", { ascending: true });

  const { data: settings } = await supabase
    .from("platform_settings")
    .select("buffer_bps, min_topup_paise, default_low_balance_threshold_paise, credit_validity_months")
    .eq("id", 1)
    .maybeSingle();

  return { rates, tiers: (tiers as TierRow[]) ?? null, settings: (settings as Settings) ?? null };
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await loadConfig(createServiceClient()));
}

const int = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as {
    rates?: Partial<Rates>;
    tiers?: Partial<TierRow>[];
    settings?: Partial<Settings>;
  };
  const supabase = createServiceClient();

  // 1. Wholesale — insert a NEW versioned row only where the value changed.
  if (body.rates) {
    const current = (await loadConfig(supabase)).rates;
    const inserts: { region: string; category: Category; wholesale_paise: number; note: string }[] = [];
    for (const cat of CATEGORIES) {
      const next = int(body.rates[cat]);
      if (next === null) continue;
      if (!current || current[cat] !== next) {
        inserts.push({ region: "IN", category: cat, wholesale_paise: next, note: `admin update by ${admin.email}` });
      }
    }
    if (inserts.length) {
      const { error } = await supabase.from("meta_rates").insert(inserts);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // 2. Tier markup / fees / cap.
  if (Array.isArray(body.tiers)) {
    for (const t of body.tiers) {
      if (!t.tier) continue;
      const patch: Record<string, number | null> = {};
      if (t.default_markup_bps !== undefined) patch.default_markup_bps = int(t.default_markup_bps);
      if (t.monthly_fee_paise !== undefined) patch.monthly_fee_paise = int(t.monthly_fee_paise);
      if (t.onboarding_fee_paise !== undefined) patch.onboarding_fee_paise = int(t.onboarding_fee_paise);
      if (t.monthly_msg_cap !== undefined)
        patch.monthly_msg_cap = t.monthly_msg_cap === null ? null : int(t.monthly_msg_cap);
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from("plan_tiers").update(patch).eq("tier", t.tier);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // 3. Global settings (singleton).
  if (body.settings) {
    const s = body.settings;
    const patch: Record<string, number> = {};
    for (const k of ["buffer_bps", "min_topup_paise", "default_low_balance_threshold_paise", "credit_validity_months"] as const) {
      if (s[k] !== undefined) {
        const v = int(s[k]);
        if (v !== null) patch[k] = v;
      }
    }
    if (Object.keys(patch).length) {
      const { error } = await supabase.from("platform_settings").update(patch).eq("id", 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json(await loadConfig(supabase));
}
