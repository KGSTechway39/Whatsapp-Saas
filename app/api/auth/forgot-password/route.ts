import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { email } = await request.json();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const supabase = createClient();
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("email", email.toLowerCase())
    .single();

  // Always return success to prevent email enumeration
  if (!data) {
    return NextResponse.json({ message: "If that email exists, a reset link has been sent" });
  }

  // TODO: integrate an email provider (Resend, SendGrid, etc.) to send a real reset link
  return NextResponse.json({ message: "If that email exists, a reset link has been sent" });
}
