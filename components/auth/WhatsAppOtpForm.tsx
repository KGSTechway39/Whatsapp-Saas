"use client";

/**
 * Two-step WhatsApp sign-in: enter number → enter the 6-digit code we send
 * on WhatsApp. Talks to /api/auth/otp/request and /api/auth/otp/verify.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Phone } from "lucide-react";

const RESEND_SECONDS = 60;

const inputClass =
  "w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-muted-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all";

const submitClass =
  "w-full wa-gradient text-primary-foreground font-semibold py-3 rounded-xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-primary/25";

export function WhatsAppOtpForm({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = async () => {
    setError("");
    if (phone.replace(/\D/g, "").length < 10) {
      setError("Enter your WhatsApp number with country code, e.g. +91 98765 43210");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send code");
      setMaskedPhone(data.phone);
      setStep("code");
      setCode("");
      setCooldown(RESEND_SECONDS);
      toast.success(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    setError("");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      toast.success(`Welcome back, ${data.user.name}!`);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setLoading(false);
    }
  };

  if (step === "phone") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); requestCode(); }} className="space-y-4">
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-1.5">
            WhatsApp number
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className={inputClass}
            />
          </div>
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          <p className="text-xs text-muted-foreground mt-1.5">
            Use the number saved on your SendAnjal account. We&apos;ll send a code on WhatsApp.
          </p>
        </div>
        <button type="submit" disabled={loading} className={submitClass}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Sending code...</> : "Send code on WhatsApp"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); verifyCode(); }} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-muted-foreground block mb-1.5">
          Code sent to {maskedPhone}
        </label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="6-digit code"
            className={`${inputClass} tracking-[0.3em]`}
          />
        </div>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>

      <button type="submit" disabled={loading} className={submitClass}>
        {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Verifying...</> : "Verify & sign in"}
      </button>

      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={() => { setStep("phone"); setError(""); }}
          className="text-muted-foreground hover:text-white transition-colors"
        >
          Change number
        </button>
        <button
          type="button"
          disabled={cooldown > 0 || loading}
          onClick={requestCode}
          className="text-primary hover:text-primary/80 disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
      </div>
    </form>
  );
}
