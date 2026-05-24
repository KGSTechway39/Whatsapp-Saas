"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { ConnectWhatsApp } from "@/components/whatsapp/ConnectWhatsApp";
import type { ConnectedAccount } from "@/components/whatsapp/ConnectWhatsApp";
import { useRouter } from "next/navigation";

export default function ConnectNumberPage() {
  const router = useRouter();

  const handleConnected = (accounts: ConnectedAccount[]) => {
    // Redirect to the numbers list after a short delay so the success state
    // is visible before navigation
    setTimeout(() => {
      if (accounts.length > 0) router.push("/numbers");
    }, 2500);
  };

  return (
    <div className="max-w-lg">
      <PageHeader
        title="Connect WhatsApp Number"
        subtitle="Link your WhatsApp Business account to start sending messages"
      />

      <div className="space-y-4">
        <ConnectWhatsApp onConnected={handleConnected} />

        {/* What happens section */}
        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <h4 className="font-semibold text-sm mb-4">What happens when you connect</h4>
          <div className="space-y-3">
            {[
              "Log in with the Facebook account that owns your WhatsApp Business Account",
              "Grant this platform permission to send messages on your behalf",
              "Your WABA ID, Phone Number ID, and access token are securely stored",
              "Webhook is subscribed so delivery receipts flow back automatically",
              "Start sending campaigns immediately after connecting",
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs text-primary font-bold">{i + 1}</span>
                </div>
                <p className="text-sm text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center px-4">
          By connecting, you agree to Meta&apos;s{" "}
          <a
            href="https://www.whatsapp.com/legal/business-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            WhatsApp Business Policy
          </a>
          . Your credentials are encrypted and never shared.
        </p>
      </div>
    </div>
  );
}
