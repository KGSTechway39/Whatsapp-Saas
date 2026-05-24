// Thin email helper — uses Resend if RESEND_API_KEY is set, otherwise logs to console.
// Swap the provider by changing only this file.

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log(`[email] Would send to ${payload.to}: ${payload.subject}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "WASend <noreply@wasend.io>",
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[email] Send failed for ${payload.to}:`, err);
  }
}

export function paymentSuccessEmail(name: string, amount: number, planName: string, nextBillingDate: string): string {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0f1117;color:#f0f0f0;border-radius:12px">
      <h2 style="color:#25D366;margin-top:0">Payment Successful ✅</h2>
      <p>Hi ${name},</p>
      <p>Your payment of <strong>₹${amount.toLocaleString()}</strong> for the <strong>${planName}</strong> plan has been received.</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0">
        <tr><td style="padding:8px 0;color:#999">Plan</td><td style="padding:8px 0;text-align:right">${planName}</td></tr>
        <tr><td style="padding:8px 0;color:#999">Amount Paid</td><td style="padding:8px 0;text-align:right">₹${amount.toLocaleString()}</td></tr>
        <tr><td style="padding:8px 0;color:#999">Next Billing</td><td style="padding:8px 0;text-align:right">${nextBillingDate}</td></tr>
      </table>
      <p style="color:#888;font-size:13px">Thank you for using WASend. Reply to this email if you have any questions.</p>
    </div>
  `;
}

export function paymentFailedEmail(name: string, planName: string, retryUrl: string): string {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0f1117;color:#f0f0f0;border-radius:12px">
      <h2 style="color:#ef4444;margin-top:0">Payment Failed ❌</h2>
      <p>Hi ${name},</p>
      <p>We were unable to collect your payment for the <strong>${planName}</strong> plan.</p>
      <p>Your account will remain active temporarily, but please update your payment method to avoid service interruption.</p>
      <a href="${retryUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#25D366;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
        Retry Payment
      </a>
      <p style="color:#888;font-size:13px">If you believe this is an error, please contact support.</p>
    </div>
  `;
}
