import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("whatsapp_numbers")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const numbers = data.map((n) => ({
    id: n.id,
    phoneNumber: n.phone_number,
    displayName: n.display_name,
    status: n.status,
    dailyLimit: n.daily_limit,
    messagesSent: n.messages_sent,
    connectedDate: n.connected_date,
    metaAccountId: n.waba_id,
    phoneNumberId: n.phone_number_id,
    isPrimary: n.is_primary,
  }));

  return NextResponse.json({ numbers });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { phoneNumber, displayName, metaAppId, metaAppSecret, wabaId, phoneNumberId, accessToken } = body;

  if (!phoneNumber || !displayName) {
    return NextResponse.json({ error: "Phone number and display name required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("whatsapp_numbers")
    .insert({
      user_id: user.id,
      phone_number: phoneNumber,
      display_name: displayName,
      meta_app_id: metaAppId || null,
      meta_app_secret: metaAppSecret || null,
      waba_id: wabaId || null,
      phone_number_id: phoneNumberId || null,
      access_token: accessToken || null,
      status: "active",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    phoneNumber: data.phone_number,
    displayName: data.display_name,
    status: data.status,
    dailyLimit: data.daily_limit,
    messagesSent: data.messages_sent,
    connectedDate: data.connected_date,
  }, { status: 201 });
}
