import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { createClient } from "@/lib/supabase/server";
import { createLibraryTemplate } from "@/lib/meta";

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

  // Route through the typed Graph wrapper (single pinned version, no scattered fetch).
  let created;
  try {
    created = await createLibraryTemplate(conn.waba_id, await decrypt(conn.access_token), {
      name: finalName,
      language,
      libraryTemplateName: body.library_template_name,
      buttonInputs: body.button_inputs,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create template" },
      { status: 502 },
    );
  }

  // Save a placeholder row in our DB; full sync will pull body+status next time.
  await supabase.from("templates").insert({
    user_id:          user.id,
    name:             finalName,
    display_name:     finalName.split(/[_-]/).filter(Boolean).map((w: string) => w[0].toUpperCase() + w.slice(1)).join(" "),
    category:         created.category || "UTILITY",
    language,
    status:           created.status || "PENDING",
    body:             "(synced from Meta library — pending approval)",
    variables:        [],
    meta_template_id: created.id,
  });

  return NextResponse.json({
    id: created.id,
    name: finalName,
    status: created.status || "PENDING",
    category: created.category,
  });
}
