#!/usr/bin/env node
// Run: node scripts/seed.mjs
// Seeds the database with dummy data for testing.
// Login: admin@wasend.demo / Test@12345

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from .env.local
const envPath = join(__dirname, "../.env.local");
const envContent = readFileSync(envPath, "utf-8");
const env = Object.fromEntries(
  envContent.split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const sql = readFileSync(join(__dirname, "../supabase/seed.sql"), "utf-8");

// Split on statement boundaries and run each statement via rpc
// Since supabase-js doesn't expose raw SQL, we call the REST API directly
const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`;
const headers = {
  "Content-Type": "application/json",
  "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
  "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
};

// Try using the pg REST endpoint directly
const pgUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/pg/query`;
const pgRes = await fetch(pgUrl, {
  method: "POST",
  headers,
  body: JSON.stringify({ query: sql }),
}).catch(() => null);

if (pgRes?.ok) {
  console.log("✅ Seed completed via pg/query");
  process.exit(0);
}

// Fallback: run via supabase-js table inserts (slower but always works)
console.log("ℹ️  pg/query not available — running via Supabase client inserts...\n");

const USER_ID = "a1b2c3d4-0000-0000-0000-000000000001";

// ------ CLEANUP ------
console.log("🧹 Cleaning up existing seed data...");
for (const table of ["daily_analytics","transactions","team_members","campaign_messages","campaigns","automations","templates","contacts","whatsapp_numbers","wallet"]) {
  await supabase.from(table).delete().eq("user_id", USER_ID);
}
await supabase.from("team_members").delete().eq("owner_id", USER_ID);
await supabase.from("users").delete().eq("id", USER_ID);

// ------ USER ------
console.log("👤 Creating test user...");
const { error: userErr } = await supabase.from("users").insert({
  id: USER_ID,
  email: "admin@wasend.demo",
  password_hash: "$2b$12$nH2GwSd0w4dLDGK0ifh6EuJRzmB6wqpPSkCoYnDLIYbVT2Zaufcl.",
  full_name: "Arjun Sharma",
  company_name: "TechSell Solutions",
  phone: "+91 98765 43210",
  timezone: "Asia/Kolkata (IST)",
});
if (userErr) { console.error("❌ User insert failed:", userErr.message); process.exit(1); }

// ------ WALLET ------
await supabase.from("wallet").insert({ user_id: USER_ID, balance: 4850.00, currency: "INR" });

// ------ WHATSAPP NUMBERS ------
console.log("📱 Adding WhatsApp numbers...");
await supabase.from("whatsapp_numbers").insert([
  { id: "b1000000-0000-0000-0000-000000000001", user_id: USER_ID, phone_number: "+91 98765 43210", display_name: "TechSell Main",    status: "active", daily_limit: 1000, messages_sent: 3842, waba_id: "123456789012345", phone_number_id: "987654321098765", access_token: "EAABs__DEMO_TOKEN_PRIMARY__xyzabc123",  is_primary: true,  webhook_verified: true },
  { id: "b1000000-0000-0000-0000-000000000002", user_id: USER_ID, phone_number: "+91 91234 56789", display_name: "TechSell Support", status: "active", daily_limit: 500,  messages_sent: 1204, waba_id: "123456789012345", phone_number_id: "112233445566778", access_token: "EAABs__DEMO_TOKEN_SUPPORT__xyzabc456", is_primary: false, webhook_verified: true },
]);

// ------ TEMPLATES ------
console.log("📝 Adding templates...");
await supabase.from("templates").insert([
  { id: "c1000000-0000-0000-0000-000000000001", user_id: USER_ID, name: "welcome_new_user",      display_name: "Welcome New User",       category: "MARKETING",     language: "en_IN", status: "APPROVED", body: "Hi {{1}}! 👋 Welcome to TechSell Solutions. We're excited to have you on board. Explore our latest deals at techsell.in and get 10% off your first order with code WELCOME10.", variables: ["customer_name"] },
  { id: "c1000000-0000-0000-0000-000000000002", user_id: USER_ID, name: "order_confirmation",    display_name: "Order Confirmation",     category: "UTILITY",       language: "en_IN", status: "APPROVED", body: "Hi {{1}}, your order #{{2}} has been confirmed! 🎉 Total: ₹{{3}}. Expected delivery: {{4}}. Track your order at techsell.in/track.", variables: ["customer_name","order_id","amount","delivery_date"] },
  { id: "c1000000-0000-0000-0000-000000000003", user_id: USER_ID, name: "flash_sale_alert",      display_name: "Flash Sale Alert",       category: "MARKETING",     language: "en_IN", status: "APPROVED", body: "🔥 FLASH SALE ALERT! {{1}}, grab up to {{2}}% OFF on selected products. Hurry! Offer valid only till {{3}}. Shop now 👉 techsell.in/sale", variables: ["customer_name","discount_percent","expiry_date"] },
  { id: "c1000000-0000-0000-0000-000000000004", user_id: USER_ID, name: "appointment_reminder",  display_name: "Appointment Reminder",   category: "UTILITY",       language: "en_IN", status: "APPROVED", body: "Hi {{1}}, this is a reminder for your appointment on {{2}} at {{3}}. Please reply CONFIRM to confirm or CANCEL to reschedule. 🗓️", variables: ["customer_name","date","time"] },
  { id: "c1000000-0000-0000-0000-000000000005", user_id: USER_ID, name: "payment_due_reminder",  display_name: "Payment Due Reminder",   category: "UTILITY",       language: "en_IN", status: "PENDING",  body: "Hi {{1}}, your payment of ₹{{2}} is due on {{3}}. Please make the payment to avoid service interruption. Pay now at techsell.in/pay", variables: ["customer_name","amount","due_date"] },
  { id: "c1000000-0000-0000-0000-000000000006", user_id: USER_ID, name: "diwali_special_offer",  display_name: "Diwali Special Offer",   category: "MARKETING",     language: "en_IN", status: "REJECTED", body: "🪔 Diwali Dhamaka! {{1}}, celebrate with flat ₹{{2}} OFF on orders above ₹999. Use code DIWALI{{3}}. Shop at techsell.in 🎆", variables: ["customer_name","discount_amount","year"] },
]);

// ------ CONTACTS ------
console.log("👥 Adding 60 contacts...");
const groups = { "VIP Clients": 15, "E-commerce": 15, "Healthcare": 15, "Retail": 15 };
const names = [
  ["Priya Mehta","Rajesh Kumar","Sunita Patel","Amit Singh","Kavya Reddy","Deepak Nair","Ananya Sharma","Vikram Joshi","Meera Iyer","Suresh Babu","Lakshmi Devi","Harish Chand","Nisha Gupta","Ravi Shankar","Pooja Agarwal"],
  ["Sanjay Mishra","Divya Kapoor","Aryan Verma","Shreya Das","Mohit Tiwari","Rekha Pillai","Gaurav Bose","Preeti Saxena","Nikhil Rao","Shweta Jain","Pranav Khanna","Asha Srivastava","Siddharth Roy","Pallavi Menon","Rohit Bansal"],
  ["Dr. Radhika Shah","Dr. Vinay Kumar","Swati Bhatt","Kiran Malhotra","Ashok Shetty","Madhuri Patil","Balaji Krishnan","Indira Mohan","Arun Pillai","Geeta Narayan","Manoj Thakur","Usha Rani","Prakash Nambiar","Vijaya Laxmi","Chandra Sekhar"],
  ["Hari Prasad","Sonal Desai","Tushar Pawar","Kamala Hegde","Santosh Mane","Hemalatha Nair","Dinesh Garg","Sushma Yadav","Naresh Solanki","Ratna Kumari","Ramesh Pandey","Vimala Srinivas","Girish Kulkarni","Sumithra Balan","Pavan Kumar"],
];
const tagSets = [
  [["vip","customer"],["vip","lead"],["vip","customer"],["vip"],["vip","customer"],["vip"],["vip","lead"],["vip","customer"],["vip"],["vip","customer"],["vip"],["vip","lead"],["vip","customer"],["vip"],["vip","customer"]],
  [["customer","warm"],["lead","warm"],["customer"],["lead"],["customer","warm"],["customer"],["lead","cold"],["customer"],["lead","warm"],["customer"],["lead"],["customer","warm"],["cold"],["customer"],["lead","cold"]],
  [["customer","warm"],["lead"],["customer"],["lead","warm"],["customer"],["customer","warm"],["lead"],["customer"],["lead","cold"],["customer"],["customer","warm"],["lead"],["customer"],["warm"],["customer"]],
  [["customer","warm"],["lead"],["customer"],["lead","warm"],["customer"],["cold"],["customer","warm"],["lead"],["customer"],["lead","cold"],["customer"],["warm"],["customer"],["lead","warm"],["customer"]],
];

const contacts = [];
let phoneBase = 9876543201;
for (let g = 0; g < 4; g++) {
  const groupName = Object.keys(groups)[g];
  for (let i = 0; i < 15; i++) {
    const daysAgo = [2,5,1,3,1,7,4,6,2,9,3,11,5,8,2,10,12,15,20,8,14,25,6,18,22,30,9,null,16,28,3,7,16,23,7,null,4,31,9,40,6,14,18,26,3,null,11,21,5,12,19,null,13,null,17,10,24][g*15+i] || null;
    contacts.push({
      user_id: USER_ID,
      name: names[g][i],
      phone: `+91${phoneBase++}`,
      email: `${names[g][i].toLowerCase().replace(/[^a-z]/g,"").slice(0,8)}@example.com`,
      contact_group: groupName,
      tags: tagSets[g][i],
      status: tagSets[g][i].includes("cold") && i > 10 ? "inactive" : "active",
      last_contacted: daysAgo !== null ? new Date(Date.now() - daysAgo * 86400000).toISOString() : null,
    });
  }
}
const { error: cErr } = await supabase.from("contacts").insert(contacts);
if (cErr) console.error("⚠️  Contacts:", cErr.message);
else console.log(`   ✓ ${contacts.length} contacts inserted`);

// ------ CAMPAIGNS ------
console.log("📣 Adding campaigns...");
const now = Date.now();
await supabase.from("campaigns").insert([
  { id: "d1000000-0000-0000-0000-000000000001", user_id: USER_ID, name: "Diwali Flash Sale 2024",       description: "Special Diwali offers for all customers",         status: "completed", template_id: "c1000000-0000-0000-0000-000000000003", template_name: "flash_sale_alert",      whatsapp_number_id: "b1000000-0000-0000-0000-000000000001", audience_type: "all",   group_name: null,        recipients_count: 1250, sent_count: 1230, delivered_count: 1180, failed_count: 20, read_count: 680, cost: 738.00,  started_at: new Date(now - 15*86400000).toISOString(), completed_at: new Date(now - 15*86400000 + 7200000).toISOString(), created_at: new Date(now - 16*86400000).toISOString() },
  { id: "d1000000-0000-0000-0000-000000000002", user_id: USER_ID, name: "Welcome New Users — Oct",     description: "Onboarding message for October signups",          status: "completed", template_id: "c1000000-0000-0000-0000-000000000001", template_name: "welcome_new_user",     whatsapp_number_id: "b1000000-0000-0000-0000-000000000001", audience_type: "group", group_name: "E-commerce",recipients_count: 342,  sent_count: 339,  delivered_count: 325,  failed_count: 3,  read_count: 201, cost: 203.40, started_at: new Date(now - 10*86400000).toISOString(), completed_at: new Date(now - 10*86400000 + 1800000).toISOString(),  created_at: new Date(now - 11*86400000).toISOString() },
  { id: "d1000000-0000-0000-0000-000000000003", user_id: USER_ID, name: "VIP Exclusive Offer",        description: "Special discount for VIP members",               status: "completed", template_id: "c1000000-0000-0000-0000-000000000003", template_name: "flash_sale_alert",      whatsapp_number_id: "b1000000-0000-0000-0000-000000000001", audience_type: "group", group_name: "VIP Clients",recipients_count: 156, sent_count: 154,  delivered_count: 149,  failed_count: 2,  read_count: 112, cost: 92.40,  started_at: new Date(now - 5*86400000).toISOString(),  completed_at: new Date(now - 5*86400000 + 900000).toISOString(),   created_at: new Date(now - 6*86400000).toISOString() },
  { id: "d1000000-0000-0000-0000-000000000004", user_id: USER_ID, name: "Order Confirmations Batch",  description: "Automated order confirmation messages",          status: "running",   template_id: "c1000000-0000-0000-0000-000000000002", template_name: "order_confirmation",   whatsapp_number_id: "b1000000-0000-0000-0000-000000000001", audience_type: "tags",  group_name: null,        recipients_count: 89,   sent_count: 67,   delivered_count: 61,   failed_count: 4,  read_count: 38,  cost: 0.00,   started_at: new Date(now - 2*3600000).toISOString(),  completed_at: null,                                                created_at: new Date(now - 3*3600000).toISOString() },
  { id: "d1000000-0000-0000-0000-000000000005", user_id: USER_ID, name: "Weekend Mega Sale",          description: "Flash sale for the upcoming weekend",            status: "scheduled", template_id: "c1000000-0000-0000-0000-000000000003", template_name: "flash_sale_alert",      whatsapp_number_id: "b1000000-0000-0000-0000-000000000001", audience_type: "all",   group_name: null,        recipients_count: 1800, sent_count: 0,    delivered_count: 0,    failed_count: 0,  read_count: 0,   cost: 0.00,   started_at: null,                                       completed_at: null,                                                created_at: new Date(now - 1*86400000).toISOString() },
  { id: "d1000000-0000-0000-0000-000000000006", user_id: USER_ID, name: "Healthcare Appt Reminders",  description: "Remind healthcare contacts of upcoming slots",   status: "draft",     template_id: "c1000000-0000-0000-0000-000000000004", template_name: "appointment_reminder", whatsapp_number_id: "b1000000-0000-0000-0000-000000000002", audience_type: "group", group_name: "Healthcare", recipients_count: 0,    sent_count: 0,    delivered_count: 0,    failed_count: 0,  read_count: 0,   cost: 0.00,   started_at: null,                                       completed_at: null,                                                created_at: new Date(now - 2*86400000).toISOString() },
]);

// ------ AUTOMATIONS ------
console.log("⚡ Adding automations...");
await supabase.from("automations").insert([
  { user_id: USER_ID, name: "New Contact Welcome Flow",             is_active: true,  trigger_type: "new_contact", trigger_value: null,  action_type: "send_template", action_template_id: "c1000000-0000-0000-0000-000000000001", action_delay_hours: 0,  last_triggered: new Date(now - 3*3600000).toISOString() },
  { user_id: USER_ID, name: "Order Keyword Auto-Reply",             is_active: true,  trigger_type: "keyword",     trigger_value: "ORDER", action_type: "send_template", action_template_id: "c1000000-0000-0000-0000-000000000002", action_delay_hours: 0,  last_triggered: new Date(now - 45*60000).toISOString() },
  { user_id: USER_ID, name: "Re-engage Inactive (30 days)",         is_active: false, trigger_type: "inactivity",  trigger_value: "30",  action_type: "send_template", action_template_id: "c1000000-0000-0000-0000-000000000003", action_delay_hours: 24, last_triggered: new Date(now - 8*86400000).toISOString() },
]);

// ------ TEAM MEMBERS ------
console.log("🏢 Adding team members...");
await supabase.from("team_members").insert([
  { owner_id: USER_ID, name: "Sneha Rao",     email: "sneha@techsell.in",   role: "admin", status: "active",  joined_date: new Date(now - 60*86400000).toISOString() },
  { owner_id: USER_ID, name: "Karthik Varma", email: "karthik@techsell.in", role: "agent", status: "active",  joined_date: new Date(now - 30*86400000).toISOString() },
  { owner_id: USER_ID, name: "Nandini Bhat",  email: "nandini@techsell.in", role: "agent", status: "invited", joined_date: new Date().toISOString() },
]);

// ------ TRANSACTIONS ------
console.log("💰 Adding transactions...");
await supabase.from("transactions").insert([
  { user_id: USER_ID, type: "credit", description: "Wallet Recharge — Razorpay",       amount: 5000.00, balance_after: 5000.00, payment_method: "razorpay", created_at: new Date(now - 30*86400000).toISOString() },
  { user_id: USER_ID, type: "debit",  description: "Campaign: Diwali Flash Sale",       amount: -738.00, balance_after: 4262.00, payment_method: null,       created_at: new Date(now - 15*86400000).toISOString() },
  { user_id: USER_ID, type: "debit",  description: "Campaign: Welcome New Users",       amount: -203.40, balance_after: 4058.60, payment_method: null,       created_at: new Date(now - 10*86400000).toISOString() },
  { user_id: USER_ID, type: "credit", description: "Wallet Recharge — UPI",             amount: 1000.00, balance_after: 5058.60, payment_method: "upi",      created_at: new Date(now - 8*86400000).toISOString() },
  { user_id: USER_ID, type: "debit",  description: "Campaign: VIP Exclusive Offer",     amount: -92.40,  balance_after: 4966.20, payment_method: null,       created_at: new Date(now - 5*86400000).toISOString() },
  { user_id: USER_ID, type: "debit",  description: "Subscription — Pro Plan",           amount: -76.00,  balance_after: 4890.20, payment_method: "razorpay", created_at: new Date(now - 1*86400000).toISOString() },
  { user_id: USER_ID, type: "debit",  description: "Campaign: Order Confirmations",     amount: -40.20,  balance_after: 4850.00, payment_method: null,       created_at: new Date(now - 2*3600000).toISOString() },
]);

// ------ DAILY ANALYTICS (30 days) ------
console.log("📊 Adding 30 days of analytics...");
const analytics = [];
for (let s = 0; s < 30; s++) {
  const d = new Date(Date.now() - s * 86400000);
  const date = d.toISOString().split("T")[0];
  let sent = 0, delivered = 0, failed = 0;
  if (s === 15)     { sent = 1230; delivered = 1180; failed = 20; }
  else if (s === 10){ sent = 339;  delivered = 325;  failed = 3; }
  else if (s === 5) { sent = 154;  delivered = 149;  failed = 2; }
  else if (s % 7 === 0){ sent = 0; delivered = 0; failed = 0; }
  else { sent = 40 + (s * 3) % 80; delivered = 36 + (s * 3) % 75; failed = (s * 2) % 5; }
  analytics.push({ user_id: USER_ID, date, total_sent: sent, total_delivered: delivered, total_failed: failed });
}
const { error: aErr } = await supabase.from("daily_analytics").insert(analytics);
if (aErr) console.error("⚠️  Analytics:", aErr.message);

console.log("\n✅ Seed complete!");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Email   : admin@wasend.demo");
console.log("  Password: Test@12345");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
