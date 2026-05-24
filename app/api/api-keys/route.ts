import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey, ALL_SCOPES } from "@/lib/api-keys";

// GET /api/api-keys — list keys (raw key never returned)
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, prefix, environment, scopes, rate_limit_per_min, is_active, last_used_at, request_count, expires_at, revoked_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    keys: data ?? [],
    available_scopes: ALL_SCOPES,
  });
}

// POST /api/api-keys — create a new key (full key returned ONCE)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.name?.trim()) return NextResponse.json({ error: "Key name required" }, { status: 400 });

  const env: "live" | "test" = body.environment === "test" ? "test" : "live";
  const scopes: string[] = Array.isArray(body.scopes) && body.scopes.length > 0
    ? body.scopes
    : ["messages:write", "contacts:read"];

  const supabase = createClient();

  // Limit: 5 active keys per user (per environment) — prevents key sprawl
  const { count } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("environment", env);

  if ((count ?? 0) >= 5) {
    return NextResponse.json({ error: `Maximum 5 active ${env} API keys allowed` }, { status: 400 });
  }

  const { fullKey, prefix, hash } = generateApiKey(env);

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      user_id:            user.id,
      name:               body.name.trim().slice(0, 50),
      prefix,
      key_hash:           hash,
      environment:        env,
      scopes,
      rate_limit_per_min: Number(body.rate_limit_per_min) || 60,
      expires_at:         body.expires_at || null,
      is_active:          true,
    })
    .select("id, name, prefix, environment, scopes, rate_limit_per_min, is_active, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Raw key shown ONCE — never persisted in plaintext.
  return NextResponse.json({
    key: { ...data, full_key: fullKey },
    warning: "Save this key now. You won't be able to see it again.",
  }, { status: 201 });
}
