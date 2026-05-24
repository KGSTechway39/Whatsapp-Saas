import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { searchParams } = new URL(request.url);

  const audienceType = searchParams.get("audienceType") || "all";
  const tagsParam = searchParams.get("tags") || "";
  const excludeRecentHours = parseInt(searchParams.get("excludeRecentHours") || "0");

  let query = supabase
    .from("contacts")
    .select("id", { count: "exact", head: false })
    .eq("user_id", user.id)
    .eq("status", "active");

  if (audienceType === "tags" && tagsParam) {
    const tags = tagsParam.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length > 0) {
      query = query.overlaps("tags", tags);
    }
  }

  const { data: contactRows, error, count } = await query.limit(100000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let finalCount = count || 0;

  // Exclude contacts who received a message recently
  if (excludeRecentHours > 0 && contactRows && contactRows.length > 0) {
    const cutoff = new Date(Date.now() - excludeRecentHours * 60 * 60 * 1000).toISOString();
    const contactIds = contactRows.map((c: { id: string }) => c.id);

    const { data: recentMessages } = await supabase
      .from("campaign_messages")
      .select("contact_id")
      .in("contact_id", contactIds)
      .gte("sent_at", cutoff);

    if (recentMessages && recentMessages.length > 0) {
      finalCount = Math.max(0, finalCount - recentMessages.length);
    }
  }

  return NextResponse.json({ count: finalCount });
}
