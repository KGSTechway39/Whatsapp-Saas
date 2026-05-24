import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listCampaigns, getCampaignInsights, MetaAdsError } from "@/lib/meta-ads";

// GET /api/ads/campaigns — list synced campaigns with insights + attribution.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from("ad_campaigns")
    .select(`
      id, fb_campaign_id, name, objective, status, ctwa_clid,
      spend, impressions, clicks, ctr, cpm,
      leads_count, messages_sent, conversions_count, conversion_value,
      start_date, end_date, last_synced_at, created_at,
      ad_accounts:ad_account_id ( id, fb_account_id, account_name, currency )
    `)
    .eq("user_id", user.id)
    .order("spend", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data });
}

// POST /api/ads/campaigns — sync campaigns from Meta for one (or all) ad accounts.
// Body: { adAccountId?: string, days?: number }   default days = 30
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { adAccountId, days = 30 } = await req.json().catch(() => ({}));
  const supabase = createClient();

  let accountsQuery = supabase
    .from("ad_accounts")
    .select("id, fb_account_id, access_token, status")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (adAccountId) accountsQuery = accountsQuery.eq("id", adAccountId);

  const { data: accounts, error: accErr } = await accountsQuery;
  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 });
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ error: "No active ad accounts. Connect one first." }, { status: 400 });
  }

  const since = new Date(Date.now() - days * 86400_000).toISOString().split("T")[0];
  const until = new Date().toISOString().split("T")[0];

  let totalSynced = 0;
  const errors: string[] = [];

  for (const acc of accounts) {
    try {
      const [campaigns, insights] = await Promise.all([
        listCampaigns(acc.fb_account_id, acc.access_token),
        getCampaignInsights(acc.fb_account_id, acc.access_token, { since, until }),
      ]);

      const insightsByCid = new Map(insights.map((i) => [i.campaign_id, i]));

      const rows = campaigns.map((c) => {
        const ins = insightsByCid.get(c.id);
        return {
          user_id: user.id,
          ad_account_id: acc.id,
          fb_campaign_id: c.id,
          name: c.name,
          objective: c.objective || null,
          status: c.status || null,
          ctwa_clid: c.id, // default; user can rename
          spend: ins ? Number(ins.spend) : 0,
          impressions: ins ? Number(ins.impressions) : 0,
          clicks: ins ? Number(ins.clicks) : 0,
          ctr: ins ? Number(ins.ctr) : 0,
          cpm: ins ? Number(ins.cpm) : 0,
          start_date: c.start_time ? c.start_time.split("T")[0] : null,
          end_date: c.stop_time ? c.stop_time.split("T")[0] : null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      });

      if (rows.length > 0) {
        const { error: upErr } = await supabase
          .from("ad_campaigns")
          .upsert(rows, { onConflict: "user_id,fb_campaign_id" });
        if (upErr) errors.push(`${acc.fb_account_id}: ${upErr.message}`);
        else totalSynced += rows.length;
      }

      await supabase
        .from("ad_accounts")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", acc.id);
    } catch (err) {
      const msg = err instanceof MetaAdsError ? err.message : err instanceof Error ? err.message : "sync failed";
      errors.push(`${acc.fb_account_id}: ${msg}`);
    }
  }

  // Recompute attribution counts from contacts + crm
  await refreshAttribution(supabase, user.id);

  return NextResponse.json({ synced: totalSynced, errors });
}

// Recompute leads_count / messages_sent / conversions_count for every campaign
// based on the contacts and campaign_messages tables.
async function refreshAttribution(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: campaigns } = await supabase
    .from("ad_campaigns")
    .select("id, fb_campaign_id, ctwa_clid")
    .eq("user_id", userId);
  if (!campaigns) return;

  for (const c of campaigns) {
    const cid = c.ctwa_clid || c.fb_campaign_id;
    const { count: leadsCount = 0 } = await supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("ctwa_campaign_id", cid);

    const { count: convCount = 0 } = await supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("ctwa_campaign_id", cid)
      .eq("crm_stage", "converted");

    // sum deal_value for converted contacts in this campaign
    const { data: conv } = await supabase
      .from("contacts")
      .select("deal_value")
      .eq("user_id", userId)
      .eq("ctwa_campaign_id", cid)
      .eq("crm_stage", "converted");
    const convValue = (conv || []).reduce((s, r) => s + Number(r.deal_value || 0), 0);

    // messages sent — count campaign_messages for contacts attributed to this CTWA campaign
    const { data: leadIds } = await supabase
      .from("contacts")
      .select("id")
      .eq("user_id", userId)
      .eq("ctwa_campaign_id", cid);

    let msgCount = 0;
    if (leadIds && leadIds.length > 0) {
      const { count } = await supabase
        .from("campaign_messages")
        .select("id", { count: "exact", head: true })
        .in("contact_id", leadIds.map((r) => r.id))
        .in("status", ["sent", "delivered", "read"]);
      msgCount = count || 0;
    }

    await supabase
      .from("ad_campaigns")
      .update({
        leads_count:       leadsCount || 0,
        messages_sent:     msgCount,
        conversions_count: convCount || 0,
        conversion_value:  convValue,
      })
      .eq("id", c.id);
  }
}
