/**
 * GET /api/auth/dev-login?from=/dashboard
 *
 * **Dev-only** auto-login as the seeded test user (admin@wasend.demo).
 * Refuses to run in production. Used by the dev-mode middleware bypass so
 * you can land directly on the dashboard without a manual login.
 *
 * Toggle with `DEV_AUTO_LOGIN=true` in .env.local.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { logger } from "@/lib/logger";

const DEV_USER_EMAIL = "admin@wasend.demo";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }
  if (process.env.DEV_AUTO_LOGIN !== "true") {
    return NextResponse.json(
      { error: "Set DEV_AUTO_LOGIN=true in .env.local to enable this bypass" },
      { status: 403 },
    );
  }

  const supabase = createServiceClient();
  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, full_name, company_name")
    .eq("email", DEV_USER_EMAIL)
    .single();

  if (error || !user) {
    return NextResponse.json(
      { error: `Seed user ${DEV_USER_EMAIL} not found. Run supabase/seed.sql first.` },
      { status: 500 },
    );
  }

  const token = await createSessionToken({
    id:      user.id,
    email:   user.email,
    name:    user.full_name,
    company: user.company_name,
  });

  const fromRaw = req.nextUrl.searchParams.get("from") || "/dashboard";
  const from = fromRaw.startsWith("/") && !fromRaw.startsWith("//") ? fromRaw : "/dashboard";
  const res = NextResponse.redirect(new URL(from, req.url));

  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   false,
    sameSite: "lax",
    maxAge:   60 * 60 * 24 * 7,
    path:     "/",
  });

  logger.info("Dev auto-login", { userId: user.id, from });
  return res;
}
