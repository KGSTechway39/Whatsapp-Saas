"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Bell,
  Sun,
  Moon,
  Search,
  Menu,
  Settings,
  User,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/inbox": "Live Inbox",
  "/numbers": "WhatsApp Numbers",
  "/numbers/connect": "Connect Number",
  "/contacts": "Contacts",
  "/contacts/import": "Import Contacts",
  "/templates": "Templates",
  "/templates/send": "Send Message",
  "/campaigns": "Campaigns",
  "/campaigns/create": "Create Campaign",
  "/automation": "Automation",
  "/automation/create": "Create Automation",
  "/analytics": "Analytics",
  "/billing": "Wallet & Billing",
  "/billing/recharge": "Recharge Wallet",
  "/settings": "Profile Settings",
  "/settings/team": "Team Members",
};

interface NavbarProps {
  onMenuClick: () => void;
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  /**
   * next-themes cannot know the theme during SSR, so rendering Sun-vs-Moon
   * straight from `theme` made the server and client markup disagree and threw
   * the whole root into client rendering. Render a stable placeholder until
   * mount, then swap in the real icon.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const title = pageTitles[pathname] || "Dashboard";

  const handleLogout = () => {
    localStorage.removeItem("wa_auth");
    toast.success("Logged out successfully");
    router.push("/login");
  };

  return (
    <header className="h-16 border-b border-border bg-background sticky top-0 z-20 flex items-center px-4 gap-4">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-full hover:bg-secondary transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="hidden sm:flex items-center gap-2.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
          <h2 className="text-base font-extrabold tracking-tight truncate">{title}</h2>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-2.5 bg-card rounded-full px-4 py-2 w-80 border border-border focus-within:border-primary transition-colors">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          placeholder="Search chats, contacts, templates"
          className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground"
        />
        <kbd className="font-mono text-[0.6rem] text-muted-foreground flex-shrink-0">⌘K</kbd>
      </div>

      {/* Primary CTA, per the design's header. Broadcast is what the design
          calls a bulk send, which is this app's campaign-create flow. */}
      <Link href="/campaigns/create" className="hidden sm:inline-flex btn-solid flex-shrink-0">
        Broadcast
      </Link>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="p-2 rounded-full hover:bg-secondary transition-colors"
          title="Toggle theme"
        >
          {mounted && theme === "dark" ? (
            <Sun className="w-4.5 h-4.5 text-muted-foreground hover:text-foreground transition-colors" />
          ) : (
            <Moon
              className="w-4.5 h-4.5 text-muted-foreground hover:text-foreground transition-colors"
              suppressHydrationWarning
            />
          )}
        </button>

        <div className="relative">
          <button
            onClick={() => {
              setNotifOpen(!notifOpen);
              setDropdownOpen(false);
            }}
            className="p-2 rounded-full hover:bg-secondary transition-colors relative"
          >
            <Bell className="w-4.5 h-4.5 text-muted-foreground hover:text-foreground transition-colors" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />
          </button>

          {notifOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setNotifOpen(false)}
              />
              <div className="absolute right-0 top-12 w-80 bg-card border border-border rounded-2xl shadow-xl z-20 overflow-hidden">
                <div className="p-4 border-b border-border">
                  <h3 className="font-bold text-sm">Notifications</h3>
                </div>
                {[
                  {
                    title: "Campaign completed",
                    desc: "January Sale reached 445/890 recipients",
                    time: "2m ago",
                  },
                  {
                    title: "Low wallet balance",
                    desc: "Your wallet balance is below ₹500",
                    time: "1h ago",
                  },
                  {
                    title: "Template approved",
                    desc: "promo_offer template is now live",
                    time: "3h ago",
                  },
                ].map((n, i) => (
                  <div
                    key={i}
                    className="p-4 hover:bg-rowHover transition-colors cursor-pointer border-b border-hairline last:border-0"
                  >
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {n.desc}
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {n.time}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => {
              setDropdownOpen(!dropdownOpen);
              setNotifOpen(false);
            }}
            className="flex items-center gap-2 p-1.5 pr-2.5 rounded-full hover:bg-secondary transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground">
              VM
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />
          </button>

          {dropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setDropdownOpen(false)}
              />
              <div className="absolute right-0 top-12 w-48 bg-card border border-border rounded-2xl shadow-xl z-20 overflow-hidden">
                <div className="p-3 border-b border-border">
                  <p className="text-sm font-medium">Vikram Malhotra</p>
                  <p className="text-xs text-muted-foreground">
                    admin@sendanjal.com
                  </p>
                </div>
                <div className="p-1">
                  <Link
                    href="/settings"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold hover:bg-secondary transition-colors"
                  >
                    <User className="w-4 h-4" />
                    Profile
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold hover:bg-secondary transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-destructive hover:bg-destructive-soft transition-colors w-full text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
