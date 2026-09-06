import { chromium, FullConfig } from "@playwright/test";

/**
 * Establish an authenticated browser context once, and save it for every spec.
 *
 * WHY THIS NO LONGER DRIVES THE LOGIN FORM
 * It used to fill in the email/password fields on /login. That stopped working
 * the moment auto-login was enabled: /login now redirects straight to the
 * dashboard, the email field never renders, and globalSetup timed out — which
 * failed the WHOLE e2e suite before a single test ran, not just new specs.
 *
 * The dev-login bypass (/api/auth/dev-login) is the supported way in while auth
 * is deferred: it mints the same `wa_session` cookie the real login sets, and it
 * refuses to run unless DEV_AUTO_LOGIN=true (or DEMO_AUTO_LOGIN=true), so it
 * cannot be reached on a normal production deploy.
 *
 * The password path is kept as a fallback so this still works against a build
 * where the bypass is switched off.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";
const TEST_EMAIL = process.env.E2E_EMAIL || "admin@sendanjal.com";
const TEST_PASSWORD = process.env.E2E_PASSWORD || "Test@12345";

export default async function globalSetup(_config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // 1) Preferred: the dev/demo bypass. Redirects to the dashboard on success.
    await page.goto(`${BASE_URL}/api/auth/dev-login?from=/dashboard`, {
      waitUntil: "domcontentloaded",
    });

    const authed = await page
      .waitForURL((url) => !url.pathname.startsWith("/api/auth"), { timeout: 15000 })
      .then(() => !page.url().includes("/login"))
      .catch(() => false);

    if (!authed) {
      // 2) Fallback: drive the real form, for builds without the bypass.
      await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      await page.getByPlaceholder(/email/i).fill(TEST_EMAIL);
      await page.getByPlaceholder(/password/i).fill(TEST_PASSWORD);
      await page.getByRole("button", { name: /sign in|login/i }).click();
      await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
    }

    // Fail loudly here rather than letting every spec fail on a missing cookie.
    const cookies = await page.context().cookies();
    if (!cookies.some((c) => c.name === "wa_session")) {
      throw new Error(
        "e2e global setup: no wa_session cookie. Set DEV_AUTO_LOGIN=true in .env.local, " +
          "or provide E2E_EMAIL / E2E_PASSWORD for a build without the bypass.",
      );
    }

    await page.context().storageState({ path: "e2e/.auth.json" });
  } finally {
    await browser.close();
  }
}
