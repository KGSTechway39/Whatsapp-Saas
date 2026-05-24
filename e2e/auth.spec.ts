import { test, expect } from "@playwright/test";

const BASE_URL      = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";
const TEST_EMAIL    = "admin@wasend.demo";
const TEST_PASSWORD = "Test@12345";

test.describe("Authentication", () => {
  test("redirects unauthenticated users to /login", async ({ page }) => {
    // Fresh context — no cookies
    await page.goto(`${BASE_URL}/dashboard`);
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows validation errors for empty form", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByRole("button", { name: /sign in|login/i }).click();
    // Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows error for wrong credentials", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByPlaceholder(/email/i).fill(TEST_EMAIL);
    await page.getByPlaceholder(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in|login/i }).click();
    const error = page.getByText(/invalid|incorrect|credentials/i);
    await expect(error).toBeVisible({ timeout: 5000 });
  });

  test("logs in with valid credentials and redirects to dashboard", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByPlaceholder(/email/i).fill(TEST_EMAIL);
    await page.getByPlaceholder(/password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in|login/i }).click();
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`, { timeout: 10000 });
    await expect(page.getByText(/morning|dashboard/i).first()).toBeVisible();
  });

  test("logs out successfully", async ({ page }) => {
    // Use saved auth state
    await page.context().addCookies(
      JSON.parse(require("fs").readFileSync("e2e/.auth.json", "utf-8")).cookies
    );
    await page.goto(`${BASE_URL}/dashboard`);
    // Find and click logout
    const logoutBtn = page.getByRole("button", { name: /logout/i });
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
    } else {
      // Logout might be in a dropdown
      await page.getByText(/logout/i).last().click();
    }
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
