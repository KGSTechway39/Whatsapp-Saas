/**
 * DELETE /api/meta/disconnect?accountId=...
 *
 * Disconnects a WhatsApp number from the caller's account.
 *
 * Steps:
 *   1. Verify the caller owns the number.
 *   2. Best-effort unsubscribe the WABA webhook from Meta (non-fatal).
 *   3. Delete the whatsapp_numbers row.
 *   4. Audit the action.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { unsubscribeWabaFromApp } from "@/lib/meta-client";

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId =
    new URL(req.url).searchParams.get("accountId")?.trim() ??
    (await tryReadBody(req)).accountId;

  if (!accountId) {
    return NextResponse.json(
      { error: "accountId is required", code: "MISSING_ACCOUNT_ID" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // Load + verify ownership.
  const { data: number } = await supabase
    .from("whatsapp_numbers")
    .select("id, user_id, waba_id, access_token")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!number) {
    return NextResponse.json({ error: "Number not found", code: "NOT_FOUND" }, { status: 404 });
  }

  // Best-effort: unsubscribe the WABA webhook from Meta.
  if (number.waba_id && number.access_token) {
    try {
      await unsubscribeWabaFromApp(number.waba_id, number.access_token);
      logger.info("[api/meta/disconnect] unsubscribed waba", { wabaId: number.waba_id });
    } catch (err) {
      logger.warn("[api/meta/disconnect] graph unsubscribe failed (non-fatal)", {
        wabaId: number.waba_id,
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const { error: delErr } = await supabase
    .from("whatsapp_numbers")
    .delete()
    .eq("id", accountId)
    .eq("user_id", user.id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message, code: "DB_ERROR" }, { status: 500 });
  }

  await audit({
    action: "whatsapp_account.disconnect",
    userId: user.id,
    resourceType: "whatsapp_number",
    resourceId: accountId,
    details: { wabaId: number.waba_id },
    request: req,
  });

  return NextResponse.json({ status: "disconnected", accountId });
}

async function tryReadBody(req: NextRequest): Promise<{ accountId?: string }> {
  try {
    return (await req.json()) as { accountId?: string };
  } catch {
    return {};
  }
}
