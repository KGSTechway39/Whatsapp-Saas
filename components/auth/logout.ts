"use client";

/**
 * End the session and leave the app. A full page load (not router.push) drops
 * the client router cache, so Back can't show a cached dashboard afterwards.
 */
export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Fall through: the redirect below still lands on /login.
  }
  try { localStorage.removeItem("wa_auth"); } catch {}
  window.location.replace("/login");
}
