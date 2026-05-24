"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  MessageCircle,
  Loader2,
  Building2,
  User,
  Mail,
  Lock,
} from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [form, setForm] = useState({
    company: "",
    name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.company) errs.company = "Company name is required";
    if (!form.name) errs.name = "Full name is required";
    if (!form.email) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      errs.email = "Invalid email";
    if (!form.password) errs.password = "Password is required";
    else if (form.password.length < 8)
      errs.password = "Minimum 8 characters";
    if (form.password !== form.confirm) errs.confirm = "Passwords don't match";
    if (!agreed) errs.terms = "Please accept terms";
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          fullName: form.name,
          companyName: form.company,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      toast.success("Account created! Welcome to WASend.");
      router.push("/dashboard");
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
      setLoading(false);
    }
  };

  const fields = [
    { key: "company", label: "Company name", icon: Building2, type: "text", placeholder: "Acme Corp" },
    { key: "name", label: "Full name", icon: User, type: "text", placeholder: "Vikram Malhotra" },
    { key: "email", label: "Email address", icon: Mail, type: "email", placeholder: "you@company.com" },
  ];

  return (
    <div className="min-h-screen bg-[#0f1117] grid-bg flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl wa-gradient mb-3 shadow-lg shadow-primary/25">
            <MessageCircle className="w-7 h-7 text-white" fill="white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="text-sm text-slate-400 mt-1">
            Start sending messages in minutes
          </p>
        </div>

        <div className="glass-card rounded-2xl p-8 shadow-2xl">
          <GoogleSignInButton label="Sign up with Google" />

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] uppercase tracking-wider text-slate-500">or use email</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {fields.map(({ key, label, icon: Icon, type, placeholder }) => (
              <div key={key}>
                <label className="text-sm font-medium text-slate-300 block mb-1.5">
                  {label}
                </label>
                <div className="relative">
                  <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={type}
                    value={form[key as keyof typeof form]}
                    onChange={(e) => update(key, e.target.value)}
                    placeholder={placeholder}
                    className={`w-full bg-white/5 border rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all ${
                      errors[key] ? "border-red-500/60" : "border-white/10"
                    }`}
                  />
                </div>
                {errors[key] && (
                  <p className="text-xs text-red-400 mt-1">{errors[key]}</p>
                )}
              </div>
            ))}

            {[
              { key: "password", label: "Password", show: showPassword, toggle: () => setShowPassword(!showPassword) },
              { key: "confirm", label: "Confirm password", show: showConfirm, toggle: () => setShowConfirm(!showConfirm) },
            ].map(({ key, label, show, toggle }) => (
              <div key={key}>
                <label className="text-sm font-medium text-slate-300 block mb-1.5">
                  {label}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={show ? "text" : "password"}
                    value={form[key as keyof typeof form]}
                    onChange={(e) => update(key, e.target.value)}
                    placeholder="••••••••"
                    className={`w-full bg-white/5 border rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all ${
                      errors[key] ? "border-red-500/60" : "border-white/10"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={toggle}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors[key] && (
                  <p className="text-xs text-red-400 mt-1">{errors[key]}</p>
                )}
              </div>
            ))}

            <div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 rounded accent-primary"
                />
                <span className="text-xs text-slate-400">
                  I agree to the{" "}
                  <span className="text-primary hover:underline cursor-pointer">
                    Terms of Service
                  </span>{" "}
                  and{" "}
                  <span className="text-primary hover:underline cursor-pointer">
                    Privacy Policy
                  </span>
                </span>
              </label>
              {errors.terms && (
                <p className="text-xs text-red-400 mt-1">{errors.terms}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full wa-gradient text-white font-semibold py-3 rounded-xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-primary/25"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          <p className="text-center text-sm text-slate-400 mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:text-primary/80 font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
