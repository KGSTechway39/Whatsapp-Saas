"use client";

/**
 * MetaConnectButton — thin trigger that opens EmbeddedSignupModal.
 *
 * Drop into any page where you want a "Connect WhatsApp Business" CTA.
 * All onboarding logic (SDK loading, FB.login, server calls) lives inside
 * the modal so it stays in lockstep with the AiSensy-style UX.
 */

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { EmbeddedSignupModal } from "./EmbeddedSignupModal";

export interface ConnectedAccount {
  accountId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  businessName: string | null;
}

interface Props {
  onConnected?: (acc: ConnectedAccount) => void;
  onMigrate?: () => void;
  label?: string;
  className?: string;
}

export function MetaConnectButton({
  onConnected,
  onMigrate,
  label = "Connect WhatsApp Number",
  className,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-[#25D366] px-6 py-4 font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-[#1DA851]"
        }
      >
        <MessageCircle className="h-5 w-5" />
        <span>{label}</span>
      </button>

      <EmbeddedSignupModal
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={(acc) => {
          onConnected?.(acc);
          // Leave the success state on screen briefly before closing.
          setTimeout(() => setOpen(false), 1500);
        }}
        onMigrate={onMigrate}
      />
    </>
  );
}
