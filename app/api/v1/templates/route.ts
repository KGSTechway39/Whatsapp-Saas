import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { withApiAuth, ApiAuthError } from "@/lib/api-keys";

// GET /api/v1/templates?status=APPROVED
export async function GET(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "templates:read");
    const status = req.nextUrl.searchParams.get("status");

    const supabase = createServiceClient();
    let q = supabase
      .from("templates")
      .select("id, name, display_name, category, language, status, body, variables, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data } = await q;

    return NextResponse.json({
      data: (data || []).map((t) => ({
        id: t.id,
        object: "template",
        name: t.name,
        display_name: t.display_name,
        category: t.category,
        language: t.language,
        status: t.status,
        body: t.body,
        variables: t.variables || [],
        created_at: t.created_at,
      })),
    });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return NextResponse.json({ error: "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}
