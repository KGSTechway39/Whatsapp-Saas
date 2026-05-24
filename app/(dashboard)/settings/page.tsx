"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import {
  User, Shield, Camera, Loader2, CheckCircle2, Eye, EyeOff,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { settings as settingsApi } from "@/lib/api";

type TabType = "profile" | "security";

const timezones = [
  "Asia/Kolkata (IST)",
  "Asia/Dubai (GST)",
  "America/New_York (EST)",
  "Europe/London (GMT)",
  "Asia/Singapore (SGT)",
  "Asia/Tokyo (JST)",
];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabType>("profile");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [profile, setProfile] = useState({
    company: "",
    name: "",
    email: "",
    phone: "",
    timezone: "Asia/Kolkata (IST)",
  });

  const [security, setSecurity] = useState({
    current: "",
    newPass: "",
    confirm: "",
  });

  useEffect(() => {
    settingsApi.getProfile()
      .then((data: unknown) => {
        const p = data as typeof profile & { email: string };
        setProfile({ company: p.company || "", name: p.name || "", email: p.email || "", phone: p.phone || "", timezone: p.timezone || "Asia/Kolkata (IST)" });
      })
      .catch(() => toast.error("Failed to load profile"));
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await settingsApi.updateProfile({ name: profile.name, company: profile.company, phone: profile.phone, timezone: profile.timezone });
      setSaved(true);
      toast.success("Profile updated!");
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (security.newPass.length < 8) { toast.error("New password must be 8+ characters"); return; }
    if (security.newPass !== security.confirm) { toast.error("Passwords don't match"); return; }
    setSaving(true);
    try {
      await settingsApi.updatePassword(security.newPass);
      toast.success("Password updated!");
      setSecurity({ current: "", newPass: "", confirm: "" });
    } catch {
      toast.error("Failed to update password");
    } finally {
      setSaving(false);
    }
  };

  const updateProfile = (key: string, value: string) =>
    setProfile((p) => ({ ...p, [key]: value }));

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Manage your account and preferences" />

      <div className="flex gap-1 mb-6 bg-muted/30 p-1 rounded-xl w-fit">
        {[
          { id: "profile" as TabType, label: "Profile", icon: User },
          { id: "security" as TabType, label: "Security", icon: Shield },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === id
                ? "bg-card shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <div className="flex items-center gap-5 mb-7 pb-6 border-b border-border/50">
            <div className="relative">
              <div className="w-20 h-20 rounded-full wa-gradient flex items-center justify-center text-2xl font-bold text-white shadow-lg shadow-primary/25">
                VM
              </div>
              <button className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center hover:bg-accent transition-colors shadow-sm">
                <Camera className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
            <div>
              <p className="font-semibold">{profile.name}</p>
              <p className="text-sm text-muted-foreground">{profile.email}</p>
              <p className="text-xs text-primary mt-1 cursor-pointer hover:underline">
                Change avatar
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            {[
              { key: "company", label: "Company Name", placeholder: "Your company name" },
              { key: "name", label: "Full Name", placeholder: "Your full name" },
              { key: "phone", label: "Phone Number", placeholder: "+91 98765 43210" },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-sm font-medium block mb-1.5">{label}</label>
                <input
                  value={profile[key as keyof typeof profile]}
                  onChange={(e) => updateProfile(key, e.target.value)}
                  placeholder={placeholder}
                  className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
            ))}

            <div>
              <label className="text-sm font-medium block mb-1.5">Email Address</label>
              <input
                value={profile.email}
                readOnly
                className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-2.5 text-sm text-muted-foreground cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground mt-1">Email cannot be changed</p>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1.5">Timezone</label>
              <select
                value={profile.timezone}
                onChange={(e) => updateProfile("timezone", e.target.value)}
                className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 transition-all"
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={saving || saved}
              className={`flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-60 ${
                saved
                  ? "bg-emerald-500 text-white"
                  : "wa-gradient text-white shadow-lg shadow-primary/25"
              }`}
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : saved ? (
                <><CheckCircle2 className="w-4 h-4" /> Saved!</>
              ) : (
                "Save Changes"
              )}
            </button>
          </form>
        </div>
      )}

      {tab === "security" && (
        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <h3 className="font-semibold mb-5">Change Password</h3>
          <form onSubmit={handleUpdatePassword} className="space-y-4">
            {[
              { key: "current", label: "Current Password", show: showCurrent, toggle: () => setShowCurrent(!showCurrent) },
              { key: "newPass", label: "New Password", show: showNew, toggle: () => setShowNew(!showNew) },
              { key: "confirm", label: "Confirm New Password", show: showConfirm, toggle: () => setShowConfirm(!showConfirm) },
            ].map(({ key, label, show, toggle }) => (
              <div key={key}>
                <label className="text-sm font-medium block mb-1.5">{label}</label>
                <div className="relative">
                  <input
                    type={show ? "text" : "password"}
                    value={security[key as keyof typeof security]}
                    onChange={(e) => setSecurity((p) => ({ ...p, [key]: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 pr-10 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={toggle}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}

            <div className="bg-muted/30 rounded-xl p-4 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground mb-2">Password requirements:</p>
              <p>• Minimum 8 characters</p>
              <p>• At least one uppercase letter</p>
              <p>• At least one number</p>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-primary/25"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Updating...</>
              ) : (
                <><Shield className="w-4 h-4" /> Update Password</>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
