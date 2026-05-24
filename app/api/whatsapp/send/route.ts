import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { sendTemplateMessage, sendTextMessage } from "@/lib/meta";

// POST /api/whatsapp/send
// Body: { numberId, to, type: "template"|"text", templateName?, languageCode?, components?, text? }
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { numberId, to, type = "template", templateName, languageCode, components, text } = await request.json();

  if (!numberId || !to) {
    return NextResponse.json({ error: "numberId and to are required" }, { status: 400 });
  }

  const supabase = createClient();

  // Fetch the WhatsApp number belonging to this user
  const { data: number, error: numErr } = await supabase
    .from("whatsapp_numbers")
    .select("phone_number_id, access_token, status")
    .eq("id", numberId)
    .eq("user_id", user.id)
    .single();

  if (numErr || !number) {
    return NextResponse.json({ error: "WhatsApp number not found" }, { status: 404 });
  }
  if (number.status !== "active") {
    return NextResponse.json({ error: "WhatsApp number is not active" }, { status: 400 });
  }
  if (!number.phone_number_id || !number.access_token) {
    return NextResponse.json({ error: "Number not connected via Meta API" }, { status: 400 });
  }

  try {
    let result;
    if (type === "text") {
      if (!text) return NextResponse.json({ error: "text body required" }, { status: 400 });
      result = await sendTextMessage(number.phone_number_id, number.access_token, to, text);
    } else {
      if (!templateName) return NextResponse.json({ error: "templateName required" }, { status: 400 });
      result = await sendTemplateMessage({
        phoneNumberId: number.phone_number_id,
        accessToken: number.access_token,
        to,
        templateName,
        languageCode: languageCode || "en",
        components: components || [],
      });
    }

    // Increment messages_sent counter (fire-and-forget, ignore errors)
    void supabase.rpc("increment_messages_sent", { number_id: numberId });

    return NextResponse.json({ messageId: result.messageId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
