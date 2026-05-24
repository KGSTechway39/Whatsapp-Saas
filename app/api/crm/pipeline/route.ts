import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";

const STAGES = ["new_lead", "qualified", "contacted", "interested", "converted", "lost"] as const;

// GET /api/crm/pipeline — per-stage contact counts, total deal values, conversion rates
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();

  const [contactsRes, dealsRes] = await Promise.allSettled([
    supabase
      .from("contacts")
      .select("crm_stage, deal_value, crm_score")
      .eq("user_id", user.id)
      .eq("status", "active"),

    supabase
      .from("crm_deals")
      .select("stage, value, probability, won_at")
      .eq("user_id", user.id),
  ]);

  const contacts = contactsRes.status === "fulfilled" ? contactsRes.value.data || [] : [];
  const deals    = dealsRes.status === "fulfilled"    ? dealsRes.value.data || []    : [];

  const pipeline = STAGES.map((stageId) => {
    const stageContacts = contacts.filter((c) => (c.crm_stage || "new_lead") === stageId);
    const totalValue = stageContacts.reduce((s, c) => s + (Number(c.deal_value) || 0), 0);
    const avgScore   = stageContacts.length
      ? Math.round(stageContacts.reduce((s, c) => s + (c.crm_score || 50), 0) / stageContacts.length)
      : 0;
    return { stage: stageId, count: stageContacts.length, totalValue, avgScore };
  });

  const totalContacts  = contacts.length;
  const convertedCount = contacts.filter((c) => c.crm_stage === "converted").length;
  const conversionRate = totalContacts > 0 ? Math.round((convertedCount / totalContacts) * 100) : 0;

  const totalPipelineValue = deals
    .filter((d) => !d.won_at && d.stage !== "closed_lost")
    .reduce((s, d) => s + (Number(d.value) || 0), 0);
  const weightedPipelineValue = deals
    .filter((d) => !d.won_at && d.stage !== "closed_lost")
    .reduce((s, d) => s + (Number(d.value) || 0) * (d.probability / 100), 0);
  const wonValue = deals
    .filter((d) => d.stage === "closed_won")
    .reduce((s, d) => s + (Number(d.value) || 0), 0);

  return NextResponse.json({
    pipeline,
    summary: {
      totalContacts,
      conversionRate,
      totalPipelineValue: Math.round(totalPipelineValue),
      weightedPipelineValue: Math.round(weightedPipelineValue),
      wonValue: Math.round(wonValue),
      openDeals: deals.filter((d) => !["closed_won", "closed_lost"].includes(d.stage)).length,
    },
  });
}
