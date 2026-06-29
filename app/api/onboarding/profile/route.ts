/**
 * POST /api/onboarding/profile
 * Body: { businessName?, vertical?, city?, path? }
 *
 * Persists the business details collected up-front in the onboarding modal
 * (DetailsBlock) onto the current user's row, so we keep them even if the user
 * bails before completing Meta's Embedded Signup. Best-effort: if the 018
 * columns aren't applied yet, returns { persisted: false } instead of 500.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { businessName, vertical, city, path } = await request.json().catch(() => ({}));

  const patch: Record<string, string> = {};
  if (typeof businessName === "string" && businessName.trim()) patch.business_name = businessName.trim();
  if (typeof vertical === "string" && vertical) patch.business_category = vertical;
  if (typeof city === "string" && city.trim()) patch.city = city.trim();
  if (path === "A" || path === "B" || path === "C") patch.onboarding_path = path;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("users").update(patch).eq("id", user.id);
  if (error) {
    // Columns may not exist yet (pre-018) — never block onboarding over this.
    return NextResponse.json({ ok: true, persisted: false, note: error.message });
  }
  return NextResponse.json({ ok: true, persisted: true });
}
