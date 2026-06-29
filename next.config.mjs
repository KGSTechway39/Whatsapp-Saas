/** @type {import('next').NextConfig} */

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control",         value: "on" },
  { key: "X-Frame-Options",                value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options",         value: "nosniff" },
  { key: "Referrer-Policy",                value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",             value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security",      value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // connect.facebook.net serves the Meta Embedded Signup SDK (sdk.js).
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://connect.facebook.net",  // unsafe-* needed for Next.js dev + Recharts
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://api.dicebear.com https://*.facebook.com",
      "font-src 'self'",
      // graph/*.facebook.com: the SDK's XHR + the hidden cross-domain iframe it opens.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://graph.facebook.com https://*.facebook.com",
      // The Embedded Signup SDK mounts a hidden facebook.com iframe for postMessage.
      "frame-src 'self' https://*.facebook.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.dicebear.com" },
    ],
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // CORS for the webhook endpoint — only Meta's IPs ideally, but allow all for simplicity
        source: "/api/webhook/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin",  value: "https://graph.facebook.com" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, X-Hub-Signature-256" },
        ],
      },
      {
        // API routes: only same-origin by default
        source: "/api/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin",  value: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
          { key: "Access-Control-Allow-Credentials", value: "true" },
        ],
      },
    ];
  },

  // Disable powered-by header
  poweredByHeader: false,

  // Strict mode for React
  reactStrictMode: true,
};

export default nextConfig;
