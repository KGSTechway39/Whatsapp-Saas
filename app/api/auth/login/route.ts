import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { checkRateLimit, AUTH_LIMIT, rateLimitHeaders } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validate";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = checkRateLimit(`login:${ip}`, AUTH_LIMIT);

  if (!rl.allowed) {
    logger.warn("Login rate limit exceeded", { ip });
    return NextResponse.json(
      { error: "Too many login attempts. Please wait a moment." },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;
  const supabase = createClient();

  const { data: user } = await supabase
    .from("users")
    .select("id, email, password_hash, full_name, company_name")
    .eq("email", email)
    .single();

  // Constant-time: always run bcrypt even if user not found
  const dummyHash = "$2b$12$invalidhashfortimingprotection000000000000000000000";
  const valid = user
    ? await bcrypt.compare(password, user.password_hash)
    : await bcrypt.compare(password, dummyHash).then(() => false);

  if (!user || !valid) {
    logger.warn("Failed login attempt", { ip, email });
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = await createSessionToken({
    id:      user.id,
    email:   user.email,
    name:    user.full_name,
    company: user.company_name,
  });

  const response = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.full_name, company: user.company_name },
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   60 * 60 * 24 * 7,
    path:     "/",
  });

  logger.info("User logged in", { userId: user.id });
  return response;
}
