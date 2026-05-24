import { chromium, FullConfig } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";
const TEST_EMAIL    = "admin@wasend.demo";
const TEST_PASSWORD = "Test@12345";

export default async function globalSetup(_config: FullConfig) {
  const browser = await chromium.launch();
  const page    = await browser.newPage();

  await page.goto(`${BASE_URL}/login`);
  await page.getByPlaceholder(/email/i).fill(TEST_EMAIL);
  await page.getByPlaceholder(/password/i).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in|login/i }).click();
  await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 10000 });

  // Save cookies so tests can start pre-authenticated
  await page.context().storageState({ path: "e2e/.auth.json" });
  await browser.close();
}
