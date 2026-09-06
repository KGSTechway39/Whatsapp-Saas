import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
        // Headings share the body face (Manrope) per the v3 design — they are
        // separated by weight (800) and tight tracking, not by a second family.
        display: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          soft: "hsl(var(--destructive-soft))",
        },
        // Semantic status tokens — single source for badges/states everywhere
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          soft: "hsl(var(--success-soft))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          soft: "hsl(var(--warning-soft))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        // Industry vertical surfaces — a scoped "workbench" palette, separate
        // from the teal app chrome (see docs/verticals/PHASE-4-DESIGN-PLAN.md).
        v: {
          paper: "hsl(var(--v-paper))",
          surface: "hsl(var(--v-surface))",
          surface2: "hsl(var(--v-surface-2))",
          line: "hsl(var(--v-line))",
          ink: "hsl(var(--v-ink))",
          muted: "hsl(var(--v-ink-muted))",
          faint: "hsl(var(--v-ink-faint))",
          accent: "hsl(var(--v-accent))",
          accentSoft: "hsl(var(--v-accent-soft))",
        },
        // Platform super-admin console — an indigo/paper palette, deliberately
        // separate from the teal client-facing chrome. Scoped to /admin via
        // .admin-console, so the rest of the product is untouched.
        adm: {
          bg: "hsl(var(--a-bg))",
          card: "hsl(var(--a-card))",
          line: "hsl(var(--a-line))",
          ink: "hsl(var(--a-ink))",
          muted: "hsl(var(--a-ink-muted))",
          faint: "hsl(var(--a-ink-faint))",
          primary: "hsl(var(--a-primary))",
          primarySoft: "hsl(var(--a-primary-soft))",
          onAccent: "hsl(var(--a-on-accent))",
          green: "hsl(var(--a-green))",
          greenSoft: "hsl(var(--a-green-soft))",
          red: "hsl(var(--a-red))",
          redSoft: "hsl(var(--a-red-soft))",
          amber: "hsl(var(--a-amber))",
          amberSoft: "hsl(var(--a-amber-soft))",
          blue: "hsl(var(--a-blue))",
          blueSoft: "hsl(var(--a-blue-soft))",
          // Categorical chart series — reserved, never reused for status.
          series1: "hsl(var(--a-series-1))",
          series2: "hsl(var(--a-series-2))",
          series3: "hsl(var(--a-series-3))",
        },
        // Amber: a higher per-message cost is information, not an error.
        cost: "hsl(var(--cost-note))",
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Brand palette repointed to the v3 terracotta (was teal-blue, before
        // that WhatsApp green). Aliases kept — and now token-driven — so every
        // existing bg-wa-green / text-wa-teal usage inherits the new brand and
        // follows the theme instead of pinning a light-mode hex.
        wa: {
          green: "hsl(var(--primary))",
          teal: "hsl(var(--primary))",
          dark: "hsl(var(--primary-hover))",
          light: "hsl(var(--accent))",
        },

        // ---- v3 chrome ----
        // The sidebar is a constant navy in BOTH themes, so it carries its own
        // scale rather than riding on card/foreground (which flip).
        rail: {
          DEFAULT: "hsl(var(--rail))",
          foreground: "hsl(var(--rail-foreground))",
          muted: "hsl(var(--rail-muted))",
          faint: "hsl(var(--rail-faint))",
          danger: "hsl(var(--rail-danger))",
        },
        // Conversation surfaces — inbound/outbound bubbles and the pane behind.
        chat: {
          ground: "hsl(var(--chat-ground))",
          in: "hsl(var(--chat-in))",
          inBorder: "hsl(var(--chat-in-border))",
          out: "hsl(var(--chat-out))",
          outForeground: "hsl(var(--chat-out-foreground))",
        },
        // Inner rules inside a card — lighter than the card's own --border.
        hairline: "hsl(var(--hairline))",
        rowHover: "hsl(var(--row-hover))",
        avatar: "hsl(var(--avatar))",
        // Number quality meters.
        quality: {
          high: "hsl(var(--quality-high))",
          med: "hsl(var(--quality-med))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // The design's card radius (16px) and its bubble radius.
        "2xl": "calc(var(--radius) + 0.2rem)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(0)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        shimmer: "shimmer 2s infinite linear",
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in": "slide-in 0.3s ease-out",
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "spin-slow": "spin-slow 3s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
