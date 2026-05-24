import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/templates/use-library
// Clones a Meta Template Library entry into the user's WABA and submits it
// for approval. Body: {
//   library_template_name: string,
//   name?: string,                      // override name (defaults to library name)
//   language?: string,                  // default 'en_US'
//   button_inputs?: { type: string; url?: { base_url: string; url_suffix_example?: string }; phone_number?: string }[]
// }
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.library_template_name) {
    return NextResponse.json({ error: "library_template_name required" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: nums } = await supabase
    .from("whatsapp_numbers")
    .select("waba_id, access_token")
    .eq("user_id", user.id)
    .eq("status", "active")
    .not("waba_id", "is", null)
    .not("access_token", "is", null)
    .limit(1);

  const conn = nums?.[0];
  if (!conn) {
    return NextResponse.json({ error: "Connect a WhatsApp number first" }, { status: 400 });
  }

  const language = body.language || "en_US";
  const finalName = body.name || body.library_template_name;

  // Meta endpoint: POST /{WABA_ID}/message_templates
  const url = `https://graph.facebook.com/v22.0/${conn.waba_id}/message_templates?access_token=${encodeURIComponent(conn.access_token)}`;

  const metaBody: Record<string, unknown> = {
    name: finalName,
    language,
    library_template_name: body.library_template_name,
  };
  if (body.button_inputs) metaBody.library_template_button_inputs = body.button_inputs;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metaBody),
  });
  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: data.error?.message || `Graph error ${res.status}` },
      { status: res.status },
    );
  }

  // Save a placeholder row in our DB; full sync will pull body+status next time.
  await supabase.from("templates").insert({
    user_id:          user.id,
    name:             finalName,
    display_name:     finalName.split(/[_-]/).filter(Boolean).map((w: string) => w[0].toUpperCase() + w.slice(1)).join(" "),
    category:         data.category || "UTILITY",
    language,
    status:           data.status || "PENDING",
    body:             "(synced from Meta library — pending approval)",
    variables:        [],
    meta_template_id: data.id,
  });

  return NextResponse.json({
    id: data.id,
    name: finalName,
    status: data.status || "PENDING",
    category: data.category,
  });
}
