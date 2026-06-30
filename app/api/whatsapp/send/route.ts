import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { getSessionUser } from "@/lib/auth";
import { sendTemplateMessage, sendTextMessage } from "@/lib/meta";
import { guardedSingleSend, resolveTemplateCategory } from "@/lib/billing/guarded-send";
import { InsufficientBalanceError } from "@/lib/billing/wallet";
import { randomUUID } from "crypto";

// POST /api/whatsapp/send
// Body: { numberId, to, type: "template"|"text", templateName?, languageCode?, components?, text? }
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { numberId, to, type = "template", templateName, languageCode, components, text } = body;

  // Stable billing idempotency key so a retried send debits the wallet once.
  // Caller may pass an Idempotency-Key header or `idempotencyKey` body field;
  // falls back to a fresh UUID (no dedupe) when absent.
  const clientIdem =
    request.headers.get("idempotency-key") || body.idempotencyKey || randomUUID();

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
  const decryptedToken = await decrypt(number.access_token);

  // Validate type-specific inputs before any billing happens.
  if (type === "text" && !text) {
    return NextResponse.json({ error: "text body required" }, { status: 400 });
  }
  if (type !== "text" && !templateName) {
    return NextResponse.json({ error: "templateName required" }, { status: 400 });
  }

  // Prepaid billing: SERVICE for text, the template's category otherwise.
  // No-op for BYO users (guardedSingleSend passes through).
  const category =
    type === "text" ? "SERVICE" : await resolveTemplateCategory(user.id, templateName);

  try {
    const result = await guardedSingleSend({
      userId: user.id,
      category,
      idempotencyKey: `wa:${clientIdem}`,
      referenceId: to,
      send: () =>
        type === "text"
          ? sendTextMessage(number.phone_number_id, decryptedToken, to, text)
          : sendTemplateMessage({
              phoneNumberId: number.phone_number_id,
              accessToken: decryptedToken,
              to,
              templateName,
              languageCode: languageCode || "en",
              components: components || [],
            }),
    });

    // Increment messages_sent counter (fire-and-forget, ignore errors)
    void supabase.rpc("increment_messages_sent", { number_id: numberId });

    return NextResponse.json({ messageId: result.messageId });
  } catch (err: unknown) {
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json(
        { error: "Insufficient wallet balance. Please recharge to send.", code: "INSUFFICIENT_BALANCE" },
        { status: 402 },
      );
    }
    const msg = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
