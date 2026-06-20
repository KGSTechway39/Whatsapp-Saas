import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { withApiAuth, ApiAuthError } from "@/lib/api-keys";

/**
 * POST /api/v1/otp/verify   { to, code }
 *
 * Verifies the latest active code for `to`. Single-use (sets consumed_at on
 * success), expiry-checked, attempt-capped. On success, /api/v1/messages/send
 * with require_otp:true will accept a send to this number for ~15 min.
 *
 * Returns: { verified: boolean, error? }   (raw codes are never logged)
 */
const E164 = /^\+?[1-9]\d{7,14}$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function POST(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "messages:write");
    const body = await req.json().catch(() => ({}));

    const rawTo = typeof body.to === "string" ? body.to.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!E164.test(rawTo)) {
      return NextResponse.json({ verified: false, error: "invalid_phone" }, { status: 400 });
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ verified: false, error: "invalid_code_format" }, { status: 400 });
    }
    const to = rawTo.replace(/\D/g, "");
    const supabase = createServiceClient();

    // Latest unconsumed, unexpired code for this tenant + number.
    const { data: row } = await supabase
      .from("otp_codes")
      .select("id, code_hash, attempts, max_attempts")
      .eq("user_id", ctx.userId)
      .eq("phone", to)
      .is("consumed_at", null)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ verified: false, error: "no_active_code" });
    }
    if (row.attempts >= row.max_attempts) {
      return NextResponse.json({ verified: false, error: "too_many_attempts" });
    }

    if (sha256(code) === row.code_hash) {
      // Single-use: consume it.
      await supabase
        .from("otp_codes")
        .update({ consumed_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq("id", row.id);
      return NextResponse.json({ verified: true });
    }

    await supabase.from("otp_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return NextResponse.json({ verified: false, error: "incorrect_code" });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}
