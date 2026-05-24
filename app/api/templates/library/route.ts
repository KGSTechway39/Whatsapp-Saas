import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Meta's Template Library is exposed via:
//   GET https://graph.facebook.com/v22.0/{WABA_ID}/template_library
//     ?category=UTILITY|AUTHENTICATION
//     ?topic=ACCOUNT_UPDATES|...
//     ?language=en_US
// (Requires a valid WABA + access_token.)
//
// We expose this through our own /api/templates/library endpoint so the UI
// doesn't need to hold Meta tokens.

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const category = sp.get("category") || "UTILITY";  // Library only has UTILITY + AUTH
  const topic    = sp.get("topic");
  const language = sp.get("language") || "en_US";
  const search   = sp.get("search")?.toLowerCase().trim();

  // Use any active WABA's token (the library is identical across WABAs;
  // Meta requires *some* valid auth context).
  const supabase = createClient();
  const { data: nums } = await supabase
    .from("whatsapp_numbers")
    .select("waba_id, access_token")
    .eq("user_id", user.id)
    .eq("status", "active")
    .not("waba_id", "is", null)
    .not("access_token", "is", null)
    .limit(1);

  const conn = nums?.[0];
  if (!conn) {
    return NextResponse.json(
      { templates: [], message: "Connect a WhatsApp number to browse Meta's Template Library." },
      { status: 200 },
    );
  }

  const url = new URL(`https://graph.facebook.com/v22.0/${conn.waba_id}/template_library`);
  url.searchParams.set("access_token", conn.access_token);
  url.searchParams.set("category", category);
  if (topic) url.searchParams.set("topic", topic);
  url.searchParams.set("language", language);
  url.searchParams.set("limit", "200");

  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (!res.ok) {
      // Meta sometimes 400s if WABA isn't enrolled; fall back to a curated list.
      const err = data.error?.message || `Graph error ${res.status}`;
      return NextResponse.json({
        templates: FALLBACK_LIBRARY.filter(
          (t) =>
            t.category === category &&
            (!search || t.name.toLowerCase().includes(search) || t.body.toLowerCase().includes(search)),
        ),
        warning: `Live library unavailable (${err}). Showing curated set.`,
      });
    }

    interface LibTemplate {
      id?: string;
      name: string;
      category: string;
      topic?: string;
      industry?: string[];
      language: string;
      body: string;
      header?: string;
      footer?: string;
      buttons?: { type: string; text: string; url?: string }[];
      parameters?: { name: string; type: string }[];
    }

    const templates = ((data.data as LibTemplate[]) || []).map((t) => ({
      id: t.id || `lib_${t.name}`,
      name: t.name,
      displayName: prettyName(t.name),
      category: t.category,
      topic: t.topic,
      industry: t.industry || [],
      language: t.language,
      body: t.body || "",
      header: t.header || "",
      footer: t.footer || "",
      buttons: t.buttons || [],
      parameters: t.parameters || [],
    }));

    const filtered = search
      ? templates.filter((t) =>
          t.name.toLowerCase().includes(search) ||
          t.displayName.toLowerCase().includes(search) ||
          t.body.toLowerCase().includes(search))
      : templates;

    return NextResponse.json({ templates: filtered, total: templates.length });
  } catch (err) {
    return NextResponse.json({
      templates: FALLBACK_LIBRARY.filter((t) => t.category === category),
      warning: err instanceof Error ? err.message : "Library fetch failed",
    });
  }
}

function prettyName(snake: string): string {
  return snake.split(/[_-]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// Curated fallback when Meta's library API isn't available for this WABA yet.
const FALLBACK_LIBRARY = [
  // UTILITY — account
  { id: "lib_account_creation_confirmation", name: "account_creation_confirmation", category: "UTILITY", topic: "ACCOUNT_UPDATES", language: "en_US",
    body: "Hi {{1}},\n\nYour new account has been created successfully.\n\nPlease verify {{2}} to complete your profile.", header: "", footer: "" },
  { id: "lib_address_update", name: "address_update", category: "UTILITY", topic: "ACCOUNT_UPDATES", language: "en_US",
    body: "Hi {{1}}, your delivery address has been successfully updated to {{2}}. Contact {{3}} for any inquiries.", header: "", footer: "" },
  { id: "lib_login_alert", name: "login_alert", category: "UTILITY", topic: "ACCOUNT_UPDATES", language: "en_US",
    body: "Hi {{1}}, a new login was detected on your {{2}} account from {{3}}. If this wasn't you, secure your account immediately.", header: "", footer: "" },
  // UTILITY — orders
  { id: "lib_order_confirmation", name: "order_confirmation", category: "UTILITY", topic: "ORDER_MANAGEMENT", language: "en_US",
    body: "Hi {{1}}, your order #{{2}} has been confirmed!\n\nItems: {{3}}\nDelivery by: {{4}}\nTotal: ₹{{5}}", header: "", footer: "" },
  { id: "lib_shipping_update", name: "shipping_update", category: "UTILITY", topic: "ORDER_MANAGEMENT", language: "en_US",
    body: "Your order #{{1}} has been shipped! Expected delivery: {{2}}. Tracking: {{3}}", header: "", footer: "" },
  { id: "lib_delivery_notification", name: "delivery_notification", category: "UTILITY", topic: "ORDER_MANAGEMENT", language: "en_US",
    body: "Hi {{1}}, your order #{{2}} has been delivered. We hope you love it!", header: "", footer: "" },
  // UTILITY — appointments
  { id: "lib_appointment_reminder", name: "appointment_reminder", category: "UTILITY", topic: "APPOINTMENTS", language: "en_US",
    body: "Hi {{1}}, this is a reminder for your appointment on {{2}} at {{3}}.\n\nLocation: {{4}}", header: "", footer: "Reply YES to confirm" },
  { id: "lib_appointment_cancelled", name: "appointment_cancelled", category: "UTILITY", topic: "APPOINTMENTS", language: "en_US",
    body: "Hi {{1}}, your appointment on {{2}} has been cancelled. Reschedule any time.", header: "", footer: "" },
  // UTILITY — payments
  { id: "lib_payment_receipt", name: "payment_receipt", category: "UTILITY", topic: "PAYMENTS", language: "en_US",
    body: "Payment received! Amount: ₹{{1}}. Transaction ID: {{2}}. Date: {{3}}. Thank you, {{4}}.", header: "", footer: "" },
  { id: "lib_payment_reminder", name: "payment_reminder", category: "UTILITY", topic: "PAYMENTS", language: "en_US",
    body: "Hi {{1}}, your invoice of ₹{{2}} is due on {{3}}. Pay now to avoid late fees.", header: "", footer: "" },
  // AUTHENTICATION
  { id: "lib_otp_verification", name: "otp_verification", category: "AUTHENTICATION", topic: "OTP", language: "en_US",
    body: "{{1}} is your verification code for {{2}}. Do not share this code with anyone.", header: "", footer: "Code expires in 10 minutes" },
  { id: "lib_login_otp", name: "login_otp", category: "AUTHENTICATION", topic: "OTP", language: "en_US",
    body: "Your login code is {{1}}. This code expires in 5 minutes.", header: "", footer: "" },
  { id: "lib_account_recovery", name: "account_recovery", category: "AUTHENTICATION", topic: "OTP", language: "en_US",
    body: "Your {{1}} account recovery code is {{2}}. Enter this code within 15 minutes to reset your password.", header: "", footer: "" },
];
