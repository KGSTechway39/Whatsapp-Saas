"use client";

import { useEffect, useState } from "react";

export interface AuthProviders {
  google: boolean;
  whatsapp: boolean;
}

/**
 * Which sign-in methods this deployment has configured. `null` while loading,
 * so callers can avoid flashing a button that then disappears.
 */
export function useAuthProviders(): AuthProviders | null {
  const [providers, setProviders] = useState<AuthProviders | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((r) => (r.ok ? r.json() : { google: false, whatsapp: false }))
      .catch(() => ({ google: false, whatsapp: false }))
      .then((p: AuthProviders) => { if (!cancelled) setProviders(p); });
    return () => { cancelled = true; };
  }, []);

  return providers;
}
