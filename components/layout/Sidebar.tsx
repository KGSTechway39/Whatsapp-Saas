"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Smartphone,
  Plus,
  Users,
  Upload,
  MessageSquare,
  Send,
  Megaphone,
  PlusCircle,
  Zap,
  BarChart3,
  Wallet,
  CreditCard,
  Settings,
  UsersRound,
  LogOut,
  ChevronDown,
  X,
  Target,
  CalendarDays,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
  Facebook,
  Filter,
  ShoppingBag,
  Package,
  ShoppingCart,
  KeyRound,
  ShieldCheck,
  Building2,
  Headset,
  Layers,
  ClipboardList,
} from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

interface NavItem {
  label: string;
  href?: string;
  icon: React.ElementType;
  badge?: number;
  children?: { label: string; href: string; icon: React.ElementType }[];
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Inbox", href: "/inbox", icon: Inbox, badge: 3 },
  {
    label: "WhatsApp Numbers",
    icon: Smartphone,
    children: [
      { label: "My Numbers", href: "/numbers", icon: Smartphone },
      { label: "Connect Number", href: "/numbers/connect", icon: Plus },
    ],
  },
  {
    label: "Contacts",
    icon: Users,
    children: [
      { label: "All Contacts", href: "/contacts", icon: Users },
      { label: "Smart Segments", href: "/segments", icon: Filter },
      { label: "Import Contacts", href: "/contacts/import", icon: Upload },
    ],
  },
  {
    label: "Templates",
    icon: MessageSquare,
    children: [
      { label: "All Templates", href: "/templates", icon: MessageSquare },
      { label: "Send Message", href: "/templates/send", icon: Send },
    ],
  },
  {
    label: "Campaigns",
    icon: Megaphone,
    children: [
      { label: "All Campaigns",   href: "/campaigns",        icon: Megaphone  },
      { label: "Create Campaign", href: "/campaigns/create", icon: PlusCircle },
      { label: "CRM Pipeline",    href: "/crm",              icon: Target     },
    ],
  },
  {
    label: "Automation",
    icon: Zap,
    children: [
      { label: "My Automations", href: "/automation", icon: Zap },
      { label: "Create Automation", href: "/automation/create", icon: PlusCircle },
    ],
  },
  {
    label: "Appointments",
    icon: CalendarDays,
    children: [
      { label: "All Appointments",  href: "/appointments",             icon: CalendarDays },
      { label: "Book Appointment",  href: "/appointments/book",        icon: PlusCircle   },
      { label: "Appt. Automations", href: "/appointments/automations", icon: Zap          },
    ],
  },
  { label: "Analytics", href: "/analytics", icon: BarChart3   },
  { label: "Ads ROI",   href: "/ads",       icon: Facebook    },
  {
    label: "Catalog",
    icon: ShoppingBag,
    children: [
      { label: "Products",         href: "/catalog",         icon: Package },
      { label: "Orders",           href: "/catalog/orders",  icon: ShoppingCart },
      { label: "Catalog Settings", href: "/catalog/connect", icon: Settings },
    ],
  },
  {
    label: "Billing",
    icon: Wallet,
    children: [
      { label: "Wallet & Billing", href: "/billing", icon: Wallet },
      { label: "Upgrade Plan", href: "/billing/plans", icon: CreditCard },
    ],
  },
  {
    label: "Settings",
    icon: Settings,
    children: [
      { label: "Profile", href: "/settings", icon: Settings },
      { label: "Team Members", href: "/settings/team", icon: UsersRound },
      { label: "API & Webhooks", href: "/settings/api", icon: KeyRound },
    ],
  },
];

/**
 * Platform-admin nav, appended only when /api/auth/me reports isAdmin.
 *
 * These pages already existed and worked — they were simply unreachable, because
 * nothing in the nav linked to them. Hiding the section is presentation only:
 * every /api/admin/* route independently enforces requireAdmin() server-side, so
 * a non-admin who guesses the URL still gets nothing.
 */
const adminNavItem: NavItem = {
  label: "Platform Admin",
  icon: ShieldCheck,
  children: [
    { label: "Overview", href: "/admin", icon: LayoutDashboard },
    { label: "Support & Ops", href: "/admin/ops", icon: Headset },
    // Tenants is the directory (find anyone, assign their industry); Tier is the
    // single-tenant billing switch. Directory first — it's the way in.
    { label: "Tenants", href: "/admin/tenants", icon: Building2 },
    { label: "Industries", href: "/admin/industries", icon: Layers },
    { label: "Tier & Billing", href: "/admin/tier", icon: CreditCard },
    { label: "Rates & Margin", href: "/admin/rates", icon: Wallet },
    { label: "Audit Logs", href: "/admin/audit", icon: ClipboardList },
  ],
};

interface SidebarProps {
  isOpen: boolean;
  onClose?: () => void;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
}

export function Sidebar({ isOpen, onClose, collapsed, onCollapsedChange }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [openMenus, setOpenMenus] = useState<string[]>([
    "WhatsApp Numbers", "Contacts", "Templates", "Campaigns",
    "Automation", "Appointments", "Catalog", "Billing", "Settings",
    // Every other group is expanded by default; keep Platform Admin consistent so
    // its links are visible rather than hidden behind an extra click.
    "Platform Admin",
  ]);
  const [userName, setUserName] = useState("Account");
  const [userCompany, setUserCompany] = useState("SendAnjal");
  const [userInitials, setUserInitials] = useState("WA");
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.id) {
          const name = data.name || data.email || "Account";
          setUserName(name);
          setUserCompany(data.company || "SendAnjal");
          setUserInitials(
            name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
          );
          setIsAdmin(data.isAdmin === true);
        }
      })
      .catch(() => {});
  }, []);

  const visibleNavItems = isAdmin ? [...navItems, adminNavItem] : navItems;

  const toggleMenu = (label: string) => {
    if (collapsed) { onCollapsedChange(false); return; }
    setOpenMenus((prev) =>
      prev.includes(label) ? prev.filter((m) => m !== label) : [...prev, label]
    );
  };

  const handleLogout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    toast.success("Logged out successfully");
    router.push("/login");
  };

  /**
   * A link is active on its own page and on pages beneath it — EXCEPT where a
   * sibling lives underneath it. "/catalog" (Products) has "/catalog/orders"
   * and "/catalog/connect" as siblings, so a plain startsWith would light up
   * Products while you're on Orders. Those parents match exactly.
   */
  const EXACT_ONLY = new Set(["/dashboard", "/catalog", "/admin", "/contacts", "/templates", "/campaigns"]);

  const isActive = (href: string) => {
    if (EXACT_ONLY.has(href)) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  };

  const sidebarWidth = collapsed ? "w-[60px]" : "w-64";

  return (
    <>
      {isOpen && onClose && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      <motion.aside
        animate={{ width: collapsed ? 60 : 256 }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        className={cn(
          // The rail is a constant navy in BOTH themes — bg-rail, not bg-card.
          "fixed top-0 left-0 h-full bg-rail z-40",
          "flex flex-col transition-transform duration-300 ease-in-out overflow-hidden",
          "lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-3.5 border-b border-rail-foreground/10 flex-shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
            {/* Solid terracotta tile with the wordmark's initial — the design's
                logo lockup, replacing the old gradient + chat glyph. */}
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
              <span className="text-primary-foreground font-extrabold text-base leading-none">S</span>
            </div>
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.18 }}
                  className="font-extrabold text-lg tracking-tight overflow-hidden whitespace-nowrap text-rail-foreground"
                >
                  SendAnjal
                </motion.span>
              )}
            </AnimatePresence>
          </Link>
          {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 rounded-md text-rail-muted hover:bg-rail-foreground/10">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin px-2 py-3 space-y-0.5">
          {visibleNavItems.map((item) => {
            if (item.href) {
              const active = isActive(item.href);
              return (
                <div key={item.label} className="relative">
                  <Link
                    href={item.href}
                    onClick={onClose}
                    onMouseEnter={() => setHoveredItem(item.label)}
                    onMouseLeave={() => setHoveredItem(null)}
                    className={cn(
                      "sidebar-item relative",
                      active && "sidebar-item-active",
                      collapsed && "justify-center px-0"
                    )}
                  >
                    <div className="relative flex-shrink-0">
                      <item.icon className="w-4 h-4" />
                      {item.badge && item.badge > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary rounded-full text-[9px] font-bold text-primary-foreground flex items-center justify-center">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <AnimatePresence>
                      {!collapsed && (
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="flex-1 truncate"
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </Link>
                  {/* Collapsed tooltip */}
                  {collapsed && hoveredItem === item.label && (
                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 bg-popover text-popover-foreground border border-border rounded-xl text-xs font-bold whitespace-nowrap z-50 pointer-events-none shadow-xl">
                      {item.label}
                      {item.badge ? ` (${item.badge})` : ""}
                    </div>
                  )}
                </div>
              );
            }

            const isExpanded = openMenus.includes(item.label) && !collapsed;
            const hasActiveChild = item.children?.some((child) => isActive(child.href));

            return (
              <div key={item.label} className="relative">
                <button
                  onClick={() => toggleMenu(item.label)}
                  onMouseEnter={() => setHoveredItem(item.label)}
                  onMouseLeave={() => setHoveredItem(null)}
                  className={cn(
                    "sidebar-item w-full",
                    hasActiveChild && "text-rail-foreground",
                    collapsed && "justify-center px-0"
                  )}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  <AnimatePresence>
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="flex-1 text-left truncate"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {!collapsed && (
                    <ChevronDown
                      className={cn(
                        "w-3.5 h-3.5 transition-transform duration-200 flex-shrink-0",
                        isExpanded && "rotate-180"
                      )}
                    />
                  )}
                </button>

                {/* Collapsed tooltip */}
                {collapsed && hoveredItem === item.label && (
                  <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 bg-popover text-popover-foreground border border-border rounded-xl text-xs font-bold whitespace-nowrap z-50 pointer-events-none shadow-xl">
                    {item.label}
                  </div>
                )}

                <AnimatePresence>
                  {isExpanded && item.children && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="ml-4 mt-0.5 space-y-0.5 border-l border-rail-foreground/15 pl-3">
                        {item.children.map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={onClose}
                            className={cn(
                              "sidebar-item text-xs",
                              isActive(child.href) && "sidebar-item-active"
                            )}
                          >
                            <child.icon className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{child.label}</span>
                          </Link>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-2 border-t border-rail-foreground/10 flex-shrink-0 space-y-1">
          {/* Collapse toggle — desktop only */}
          <button
            onClick={() => onCollapsedChange(!collapsed)}
            className="hidden lg:flex sidebar-item w-full"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4 flex-shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="w-4 h-4 flex-shrink-0" />
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs"
                >
                  Collapse
                </motion.span>
              </>
            )}
          </button>

          <div className={cn(
            "flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-rail-foreground/8 transition-colors",
            collapsed && "justify-center px-0"
          )}>
            <div className="w-8 h-8 rounded-full bg-rail-foreground/15 flex items-center justify-center text-xs font-bold text-rail-foreground flex-shrink-0">
              {userInitials}
            </div>
            <AnimatePresence>
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 min-w-0"
                >
                  <p className="text-sm font-bold truncate text-rail-foreground">{userName}</p>
                  <p className="text-xs text-rail-muted truncate">{userCompany}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={handleLogout}
            className={cn(
              "sidebar-item w-full !text-rail-danger hover:!bg-rail-danger/15",
              collapsed && "justify-center px-0"
            )}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  Logout
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </motion.aside>
    </>
  );
}
