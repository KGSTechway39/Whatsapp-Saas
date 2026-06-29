/**
 * GET /api/meta/accounts
 *
 * Lists every WhatsApp number connected to the caller, with metadata only.
 * Access tokens are never returned.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("whatsapp_numbers")
    .select(
      "id, waba_id, phone_number_id, phone_number, display_name, status, webhook_verified, is_primary, token_expires_at, created_at, updated_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message, code: "DB_ERROR" }, { status: 500 });
  }

  return NextResponse.json({
    accounts: (data ?? []).map((row) => ({
      id: row.id,
      wabaId: row.waba_id,
      phoneNumberId: row.phone_number_id,
      displayPhoneNumber: row.phone_number,
      businessName: row.display_name,
      status: row.status,
      webhookVerified: row.webhook_verified,
      isPrimary: row.is_primary,
      tokenExpiresAt: row.token_expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}
