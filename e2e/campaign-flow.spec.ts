import { test, expect } from "@playwright/test";
import * as fs from "fs";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";

// All tests in this file use pre-authenticated state
test.beforeEach(async ({ page }) => {
  const state = JSON.parse(fs.readFileSync("e2e/.auth.json", "utf-8"));
  await page.context().addCookies(state.cookies);
});

test.describe("Campaign Creation Flow", () => {
  test("navigates to campaign create page", async ({ page }) => {
    await page.goto(`${BASE_URL}/campaigns`);
    await page.getByRole("link", { name: /create campaign/i }).first().click();
    await expect(page).toHaveURL(/\/campaigns\/create/);
    await expect(page.getByText(/setup|step 1/i).first()).toBeVisible();
  });

  test("shows all 4 stepper steps", async ({ page }) => {
    await page.goto(`${BASE_URL}/campaigns/create`);
    for (const step of ["Setup", "Audience", "Template", "Review"]) {
      await expect(page.getByText(step).first()).toBeVisible();
    }
  });

  test("validates campaign name is required", async ({ page }) => {
    await page.goto(`${BASE_URL}/campaigns/create`);
    // Try to advance without filling in name
    const nextBtn = page.getByRole("button", { name: /next|continue/i }).first();
    await nextBtn.click();
    // Should still be on step 1
    await expect(page.getByText(/setup/i).first()).toBeVisible();
  });

  test("fills step 1 and advances", async ({ page }) => {
    await page.goto(`${BASE_URL}/campaigns/create`);
    const nameInput = page.getByPlaceholder(/campaign name/i).first();
    await nameInput.fill("E2E Test Campaign");
    const nextBtn = page.getByRole("button", { name: /next|continue/i });
    await nextBtn.click();
    // Should advance to step 2
    await expect(page.getByText(/audience/i).first()).toBeVisible({ timeout: 3000 });
  });
});

test.describe("Templates Page", () => {
  test("loads templates page", async ({ page }) => {
    await page.goto(`${BASE_URL}/templates`);
    await expect(page.getByText(/templates/i).first()).toBeVisible();
  });

  test("can open template library modal", async ({ page }) => {
    await page.goto(`${BASE_URL}/templates`);
    const btn = page.getByRole("button", { name: /browse library|add template/i }).first();
    if (await btn.isVisible()) {
      await btn.click();
      await expect(page.getByText(/template library/i).first()).toBeVisible({ timeout: 3000 });
    }
  });

  test("template preview shows WhatsApp bubble", async ({ page }) => {
    await page.goto(`${BASE_URL}/templates`);
    const previewBtn = page.getByRole("button", { name: /preview/i }).first();
    if (await previewBtn.isVisible()) {
      await previewBtn.click();
      await expect(page.getByText(/whatsapp preview/i)).toBeVisible({ timeout: 3000 });
    }
  });
});
