import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const checks: Record<string, string> = {
    status:  "ok",
    version: process.env.npm_package_version || "unknown",
    env:     process.env.NODE_ENV || "unknown",
  };

  // Ping Supabase
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("users").select("id").limit(1);
    checks.database = error ? "degraded" : "ok";
  } catch {
    checks.database = "error";
  }

  // Check required env vars
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "JWT_SECRET",
  ];
  const missing = required.filter((k) => !process.env[k]);
  checks.config = missing.length === 0 ? "ok" : `missing: ${missing.join(", ")}`;

  const isHealthy = checks.database === "ok" && checks.config === "ok";

  return NextResponse.json(
    { ...checks, timestamp: new Date().toISOString() },
    { status: isHealthy ? 200 : 503 }
  );
}
