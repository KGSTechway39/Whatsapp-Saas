import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { exchangeCodeForToken, extendToken, getWABAsForToken, subscribeWABAToApp } from "@/lib/meta";

// POST /api/whatsapp/connect
// Body: { code, wabaId?, phoneNumberId? }
// Exchanges Meta OAuth code → long-lived token, fetches WABA + phone numbers, stores in DB
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code, wabaId: hintWabaId, phoneNumberId: hintPhoneNumberId } = await request.json();
  if (!code) return NextResponse.json({ error: "OAuth code required" }, { status: 400 });

  let userToken: string;
  try {
    const shortToken = await exchangeCodeForToken(code);
    userToken = await extendToken(shortToken);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Token exchange failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Fetch all WABAs the user granted access to
  let wabas;
  try {
    wabas = await getWABAsForToken(userToken);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch WhatsApp accounts";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!wabas.length) {
    return NextResponse.json({ error: "No WhatsApp Business Accounts found. Make sure you granted access during setup." }, { status: 400 });
  }

  const supabase = createClient();
  const connected: unknown[] = [];

  for (const waba of wabas) {
    // If hint provided, only process matching WABA
    if (hintWabaId && waba.id !== hintWabaId) continue;

    // Subscribe WABA to our app for webhook events
    try {
      await subscribeWABAToApp(waba.id, userToken);
    } catch {
      // non-fatal — subscription may already exist
    }

    for (const phone of waba.phoneNumbers) {
      if (hintPhoneNumberId && phone.id !== hintPhoneNumberId) continue;

      const { data: existing } = await supabase
        .from("whatsapp_numbers")
        .select("id")
        .eq("user_id", user.id)
        .eq("phone_number_id", phone.id)
        .single();

      if (existing) {
        // Update token + status for existing number
        await supabase
          .from("whatsapp_numbers")
          .update({ access_token: userToken, status: "active", updated_at: new Date().toISOString() })
          .eq("id", existing.id);

        connected.push({ id: existing.id, phoneNumber: phone.display_phone_number, status: "active", updated: true });
        continue;
      }

      // Determine if this should be the primary number
      const { count } = await supabase
        .from("whatsapp_numbers")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      const isPrimary = (count ?? 0) === 0;

      const { data: inserted, error: insertErr } = await supabase
        .from("whatsapp_numbers")
        .insert({
          user_id: user.id,
          phone_number: phone.display_phone_number,
          display_name: phone.verified_name || phone.display_phone_number,
          waba_id: waba.id,
          phone_number_id: phone.id,
          access_token: userToken,
          status: phone.status === "VERIFIED" ? "active" : "inactive",
          is_primary: isPrimary,
          webhook_verified: false,
        })
        .select("id, phone_number, display_name, status")
        .single();

      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }

      connected.push({
        id: inserted!.id,
        phoneNumber: inserted!.phone_number,
        displayName: inserted!.display_name,
        status: inserted!.status,
        wabaId: waba.id,
        isPrimary,
      });
    }
  }

  if (!connected.length) {
    return NextResponse.json({ error: "No phone numbers were connected. Check WABA and phone number access." }, { status: 400 });
  }

  return NextResponse.json({ connected }, { status: 201 });
}
