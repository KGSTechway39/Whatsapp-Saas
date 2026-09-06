import type { Metadata, Viewport } from "next";
import { Manrope, Space_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";

/**
 * Type pairing comes from the v3 Inbox design: Manrope carries body AND
 * headings (it holds up at 800 for display sizes, so no third face), Space
 * Mono carries every number, eyebrow label, timestamp and template name.
 *
 * The CSS variable names are deliberately unchanged — tailwind.config.ts maps
 * font-sans / font-display / font-mono onto them, so swapping the face here
 * repoints the whole app without touching a single utility class.
 */
const sans = Manrope({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// NOTE: there is deliberately no second loader for a display face. The design
// sets headings in Manrope too, and calling Manrope() twice emits only one
// variable — leaving --font-display undefined, which invalidates the whole
// font-family declaration and drops headings to the serif default. Instead
// tailwind.config.ts points font-display straight at --font-geist-sans.

// Space Mono ships 400/700 only — there is no 500/600 to fall back to.
const mono = Space_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sendanjal.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "SendAnjal — WhatsApp Business Platform",
    template: "%s | SendAnjal",
  },
  description:
    "Professional WhatsApp Business messaging platform. Send bulk messages, run campaigns, automate follow-ups and manage contacts — all from one dashboard.",
  keywords: [
    "WhatsApp Business", "WhatsApp bulk messaging", "WhatsApp campaigns",
    "WhatsApp automation", "WhatsApp marketing India", "SendAnjal",
  ],
  authors: [{ name: "SendAnjal" }],
  creator: "SendAnjal",
  publisher: "SendAnjal",
  robots: { index: false, follow: false }, // App is behind auth — no indexing
  openGraph: {
    type:        "website",
    locale:      "en_IN",
    url:         siteUrl,
    title:       "SendAnjal — WhatsApp Business Platform",
    description: "Send bulk WhatsApp messages, automate campaigns, and manage your customer inbox.",
    siteName:    "SendAnjal",
  },
  twitter: {
    card:        "summary_large_image",
    title:       "SendAnjal — WhatsApp Business Platform",
    description: "Professional WhatsApp Business messaging for Indian businesses.",
    creator:     "@sendanjal",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
    apple:    "/apple-icon.png",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: [
    // Match the v3 grounds: deep navy in dark, warm cream in light.
    { media: "(prefers-color-scheme: dark)",  color: "#0f1a21" },
    { media: "(prefers-color-scheme: light)", color: "#f2f0ec" },
  ],
  width:           "device-width",
  initialScale:    1,
  maximumScale:    1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} antialiased`}>
        {/* Mount point the Meta/Facebook SDK expects; without it the Embedded
            Signup SDK can fail to initialise its cross-domain iframe. */}
        <div id="fb-root" />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster
            theme="light"
            position="top-right"
            toastOptions={{
              style: {
                background: "hsl(var(--card))",
                border:     "1px solid hsl(var(--border))",
                color:      "hsl(var(--foreground))",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
