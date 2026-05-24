import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/ads/track-lead
// Called by /api/webhook/whatsapp when an incoming message arrives with a
// CTWA referral payload, OR manually for testing.
//
// Body: {
//   phone:           string,                    // contact phone (with or without +)
//   name?:           string,
//   ctwa_clid?:      string,                    // referral.ctwa_clid from Meta
//   fb_campaign_id?: string,
//   fb_ad_id?:       string,
//   source_url?:     string,
//   body?:           string,                    // first message text
//   raw?:            object,                    // full referral payload
// }
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json();
  const phone = String(payload.phone || "").replace(/[^\d+]/g, "");
  if (!phone || phone.length < 7) {
    return NextResponse.json({ error: "valid phone is required" }, { status: 400 });
  }

  const clid = payload.ctwa_clid || payload.fb_campaign_id || null;
  if (!clid) {
    return NextResponse.json({ error: "ctwa_clid or fb_campaign_id is required" }, { status: 400 });
  }

  const supabase = createClient();

  // Resolve which internal campaign this belongs to (by clid or fb_campaign_id).
  const { data: matchedCampaign } = await supabase
    .from("ad_campaigns")
    .select("id, name, fb_campaign_id, ctwa_clid")
    .eq("user_id", user.id)
    .or(`ctwa_clid.eq.${clid},fb_campaign_id.eq.${clid}`)
    .limit(1)
    .maybeSingle();

  // Upsert the contact (create or attribute existing one).
  const { data: existing } = await supabase
    .from("contacts")
    .select("id, ctwa_campaign_id, name")
    .eq("user_id", user.id)
    .eq("phone", phone)
    .maybeSingle();

  let contactId: string;
  let isNew = false;
  if (existing) {
    contactId = existing.id;
    // Don't overwrite an earlier attribution.
    if (!existing.ctwa_campaign_id) {
      await supabase
        .from("contacts")
        .update({
          ctwa_campaign_id: clid,
          ctwa_ad_id: payload.fb_ad_id || null,
          ctwa_campaign_name: matchedCampaign?.name || null,
          ctwa_clicked_at: new Date().toISOString(),
          crm_source: "ctwa",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }
  } else {
    isNew = true;
    const { data: created, error } = await supabase
      .from("contacts")
      .insert({
        user_id: user.id,
        name: payload.name || `Lead ${phone.slice(-4)}`,
        phone,
        crm_source: "ctwa",
        crm_stage: "new_lead",
        ctwa_campaign_id: clid,
        ctwa_ad_id: payload.fb_ad_id || null,
        ctwa_campaign_name: matchedCampaign?.name || null,
        ctwa_clicked_at: new Date().toISOString(),
        tags: ["ctwa", matchedCampaign?.name].filter(Boolean) as string[],
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    contactId = created.id;
  }

  // Log the lead event for traceability.
  await supabase.from("ad_leads").insert({
    user_id: user.id,
    ad_campaign_id: matchedCampaign?.id || null,
    contact_id: contactId,
    phone,
    ctwa_clid: clid,
    fb_campaign_id: payload.fb_campaign_id || null,
    fb_ad_id: payload.fb_ad_id || null,
    source_url: payload.source_url || null,
    body: payload.body || null,
    raw_referral: payload.raw || null,
    is_new_contact: isNew,
  });

  // Bump the campaign's lead counter if we matched an internal campaign.
  if (matchedCampaign && isNew) {
    await supabase.rpc("increment_ad_campaign_leads", { p_campaign_id: matchedCampaign.id }).then(
      () => {},
      async () => {
        // Fall back: explicit update if RPC doesn't exist
        const { data: cur } = await supabase
          .from("ad_campaigns")
          .select("leads_count")
          .eq("id", matchedCampaign.id)
          .single();
        await supabase
          .from("ad_campaigns")
          .update({ leads_count: (cur?.leads_count || 0) + 1 })
          .eq("id", matchedCampaign.id);
      },
    );
  }

  return NextResponse.json({ ok: true, contactId, isNew, campaignId: matchedCampaign?.id || null });
}
