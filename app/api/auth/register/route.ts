import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { checkRateLimit, AUTH_LIMIT, rateLimitHeaders } from "@/lib/rate-limit";
import { registerSchema } from "@/lib/validate";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = checkRateLimit(`register:${ip}`, AUTH_LIMIT);

  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please wait a moment." },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { email, password, fullName, companyName } = parsed.data;
  const supabase = createClient();

  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (existing) {
    // Don't reveal if email exists — return generic message to prevent enumeration
    return NextResponse.json(
      { error: "Registration failed. Please check your details." },
      { status: 409 }
    );
  }

  const password_hash = await bcrypt.hash(password, 12);

  const { data: user, error } = await supabase
    .from("users")
    .insert({ email, password_hash, full_name: fullName, company_name: companyName })
    .select("id, email, full_name, company_name")
    .single();

  if (error || !user) {
    logger.error("User registration failed", { email, error: error?.message });
    return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 500 });
  }

  // Create wallet for new user
  await supabase.from("wallet").insert({ user_id: user.id, balance: 0 });

  const token = await createSessionToken({
    id:      user.id,
    email:   user.email,
    name:    user.full_name,
    company: user.company_name,
  });

  const response = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.full_name, company: user.company_name },
    message: "Account created successfully",
  }, { status: 201 });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   60 * 60 * 24 * 7,
    path:     "/",
  });

  logger.info("New user registered", { userId: user.id });
  return response;
}
