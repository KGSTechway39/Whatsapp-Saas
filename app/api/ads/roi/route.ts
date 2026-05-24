import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// GET /api/ads/roi — aggregate ROI across all ad campaigns for this user.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { data: campaigns, error } = await supabase
    .from("ad_campaigns")
    .select(`
      id, name, status, ctwa_clid, fb_campaign_id,
      spend, impressions, clicks, ctr, cpm,
      leads_count, messages_sent, conversions_count, conversion_value,
      ad_accounts:ad_account_id ( fb_account_id, account_name, currency )
    `)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (campaigns || []).map((c) => {
    const spend       = Number(c.spend) || 0;
    const leads       = Number(c.leads_count) || 0;
    const conversions = Number(c.conversions_count) || 0;
    const revenue     = Number(c.conversion_value) || 0;
    const cac         = leads > 0 ? spend / leads : 0;
    const cpc         = (Number(c.clicks) || 0) > 0 ? spend / Number(c.clicks) : 0;
    const conversionRate = leads > 0 ? (conversions / leads) * 100 : 0;
    const roas        = spend > 0 ? revenue / spend : 0;
    const profit      = revenue - spend;

    return {
      id: c.id,
      name: c.name,
      status: c.status,
      account: Array.isArray(c.ad_accounts) ? c.ad_accounts[0]?.account_name : (c.ad_accounts as { account_name?: string } | null)?.account_name,
      currency: (Array.isArray(c.ad_accounts) ? c.ad_accounts[0]?.currency : (c.ad_accounts as { currency?: string } | null)?.currency) || "INR",
      ctwa_clid: c.ctwa_clid || c.fb_campaign_id,
      spend,
      impressions: Number(c.impressions) || 0,
      clicks: Number(c.clicks) || 0,
      ctr: Number(c.ctr) || 0,
      cpm: Number(c.cpm) || 0,
      cpc: Math.round(cpc * 100) / 100,
      leads,
      messages_sent: Number(c.messages_sent) || 0,
      conversions,
      revenue,
      cac: Math.round(cac * 100) / 100,
      conversion_rate: Math.round(conversionRate * 10) / 10,
      roas: Math.round(roas * 100) / 100,
      profit: Math.round(profit * 100) / 100,
    };
  });

  const totals = rows.reduce(
    (a, r) => ({
      spend:       a.spend + r.spend,
      impressions: a.impressions + r.impressions,
      clicks:      a.clicks + r.clicks,
      leads:       a.leads + r.leads,
      messages:    a.messages + r.messages_sent,
      conversions: a.conversions + r.conversions,
      revenue:     a.revenue + r.revenue,
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0, conversions: 0, revenue: 0 },
  );

  const summary = {
    ...totals,
    cac:             totals.leads > 0 ? Math.round((totals.spend / totals.leads) * 100) / 100 : 0,
    roas:            totals.spend > 0 ? Math.round((totals.revenue / totals.spend) * 100) / 100 : 0,
    profit:          Math.round((totals.revenue - totals.spend) * 100) / 100,
    conversion_rate: totals.leads > 0 ? Math.round((totals.conversions / totals.leads) * 1000) / 10 : 0,
  };

  return NextResponse.json({ summary, campaigns: rows });
}
