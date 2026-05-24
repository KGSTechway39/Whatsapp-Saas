import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster
            theme="dark"
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
