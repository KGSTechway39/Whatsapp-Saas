import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";

// Body — friendly, highly readable humanist sans (distinct from generic Inter)
const sans = Plus_Jakarta_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// Display — characterful editorial grotesque for headings
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://wasend.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "WASend — WhatsApp Business Platform",
    template: "%s | WASend",
  },
  description:
    "Professional WhatsApp Business messaging platform. Send bulk messages, run campaigns, automate follow-ups and manage contacts — all from one dashboard.",
  keywords: [
    "WhatsApp Business", "WhatsApp bulk messaging", "WhatsApp campaigns",
    "WhatsApp automation", "WhatsApp marketing India", "WASend",
  ],
  authors: [{ name: "WASend" }],
  creator: "WASend",
  publisher: "WASend",
  robots: { index: false, follow: false }, // App is behind auth — no indexing
  openGraph: {
    type:        "website",
    locale:      "en_IN",
    url:         siteUrl,
    title:       "WASend — WhatsApp Business Platform",
    description: "Send bulk WhatsApp messages, automate campaigns, and manage your customer inbox.",
    siteName:    "WASend",
  },
  twitter: {
    card:        "summary_large_image",
    title:       "WASend — WhatsApp Business Platform",
    description: "Professional WhatsApp Business messaging for Indian businesses.",
    creator:     "@wasend",
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
    { media: "(prefers-color-scheme: dark)",  color: "#0b141a" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
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
      <body className={`${sans.variable} ${display.variable} ${jetbrainsMono.variable} antialiased`}>
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
