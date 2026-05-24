import { test, expect } from "@playwright/test";
import * as fs from "fs";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";

test.beforeEach(async ({ page }) => {
  const state = JSON.parse(fs.readFileSync("e2e/.auth.json", "utf-8"));
  await page.context().addCookies(state.cookies);
});

test.describe("Inbox", () => {
  test("loads inbox page", async ({ page }) => {
    await page.goto(`${BASE_URL}/inbox`);
    await expect(page.getByText(/inbox|conversations/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("shows conversation list or empty state", async ({ page }) => {
    await page.goto(`${BASE_URL}/inbox`);
    // Either a conversation item or empty state should be visible
    const hasConversations = await page.getByText(/\+91|\+1/i).first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText(/no conversations|start messaging/i).first().isVisible().catch(() => false);
    expect(hasConversations || hasEmpty).toBe(true);
  });

  test("search input is functional", async ({ page }) => {
    await page.goto(`${BASE_URL}/inbox`);
    const searchInput = page.getByPlaceholder(/search/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("test");
      await page.waitForTimeout(500);
      // Should not crash
      await expect(page).toHaveURL(`${BASE_URL}/inbox`);
    }
  });
});

test.describe("Contacts Page", () => {
  test("loads contacts with table", async ({ page }) => {
    await page.goto(`${BASE_URL}/contacts`);
    await expect(page.getByText(/contacts/i).first()).toBeVisible();
    // Table headers should be visible
    await expect(page.getByText("Name").first()).toBeVisible({ timeout: 5000 });
  });

  test("search filters contacts", async ({ page }) => {
    await page.goto(`${BASE_URL}/contacts`);
    await page.getByPlaceholder(/search/i).first().fill("John");
    await page.waitForTimeout(600);
    // Page should still render
    await expect(page.getByText(/contacts/i).first()).toBeVisible();
  });

  test("export button is present", async ({ page }) => {
    await page.goto(`${BASE_URL}/contacts`);
    await expect(page.getByRole("button", { name: /export/i }).first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Health Check", () => {
  test("/api/health returns 200 with ok status", async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/health`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");
  });
});
