import { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://wasend.app";

  // Only public pages are in the sitemap
  return [
    { url: `${base}/login`,           lastModified: new Date(), changeFrequency: "yearly",  priority: 0.8 },
    { url: `${base}/register`,        lastModified: new Date(), changeFrequency: "yearly",  priority: 0.9 },
    { url: `${base}/forgot-password`, lastModified: new Date(), changeFrequency: "yearly",  priority: 0.3 },
  ];
}
