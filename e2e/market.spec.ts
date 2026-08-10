import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { mainWindow } from "./mainWindow";

const ORDER_COUNT = 24;

function fixtureOrders(): { sell: unknown[]; buy: unknown[] } {
  // Order ids must satisfy the IPC validator's 24-hex WFM ObjectId shape.
  const sell = Array.from({ length: ORDER_COUNT }, (_, index) => ({
    id: (index + 1).toString(16).padStart(24, "0"),
    orderType: "sell",
    platinum: 10 + index,
    quantity: 1 + (index % 3),
    visible: true,
    modRank: null,
    itemId: `fixture-item-${index + 1}`,
    itemName: `Fixture Item ${index + 1}`,
    itemUrlName: `fixture_item_${index + 1}`,
    itemThumb: null,
  }));
  return { sell, buy: [] };
}

test.describe("Market tab (fixture mode)", () => {
  test.setTimeout(240_000);

  let app: ElectronApplication;
  let page: Page;
  let sandboxDir: string;

  test.beforeAll(async () => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-market-e2e-"));
    const localAppData = path.join(sandboxDir, "local");
    fs.mkdirSync(localAppData, { recursive: true });
    const fixturePath = path.join(sandboxDir, "wfm-orders.json");
    fs.writeFileSync(fixturePath, JSON.stringify(fixtureOrders()));

    // Without an inventory the app reopens setup on reload
    // (reopenSetupWhenInventoryIsUnavailable) and #sidebar never renders.
    // Seed the sandbox helper dir; local runs only passed by accident via
    // the real profile's Downloads/Documents scan.
    const helperDir = path.join(sandboxDir, "user-data", "api-helper");
    fs.mkdirSync(helperDir, { recursive: true });
    fs.writeFileSync(path.join(helperDir, "inventory.json"), JSON.stringify({ Suits: [] }));

    const env = { ...process.env } as Record<string, string>;
    delete env.ELECTRON_RUN_AS_NODE;
    env.WFHELPER_DISABLE_KEYBOARD_HOOK = "1";
    env.LOCALAPPDATA = localAppData;
    env.WFHELPER_USER_DATA = path.join(sandboxDir, "user-data");
    env.WFHELPER_WFM_FIXTURES = fixturePath;

    app = await electron.launch({ args: ["--no-sandbox", "."], env });
    page = await mainWindow(app);

    // Renderer errors only surface in the CI log if we forward them.
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[renderer console]", msg.text());
    });
    page.on("pageerror", (err) => console.log("[renderer pageerror]", String(err)));

    // Fresh sandbox starts on the setup view; flag it done and reload.
    // Cold CI runners need the same generous boot timeouts as smoke.spec.
    await expect(page.locator("#app")).toBeVisible({ timeout: 90_000 });
    await page.evaluate(() => localStorage.setItem("setup-completed-v2", "1"));
    await page.reload();
    try {
      await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
    } catch (err) {
      // Post-mortem for CI: which state did the reload land in?
      const flag = await page
        .evaluate(() => localStorage.getItem("setup-completed-v2"))
        .catch(() => "<evaluate failed>");
      const welcome = await page.getByRole("heading", { name: "Welcome to WFHelper" }).count();
      const body = await page
        .evaluate(() => document.body.innerHTML.slice(0, 1500))
        .catch(() => "<evaluate failed>");
      console.log(`[market e2e] no sidebar: setupFlag=${flag} welcomeHeadings=${welcome}`);
      console.log(`[market e2e] body snippet: ${body}`);
      throw err;
    }

    await page.locator("#sidebar").getByText("Market", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "My Orders" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('[title="Fixture Item 1"]').first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test.afterAll(async () => {
    await app?.close();
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  test("edit modal autofocuses the price and steps it without a confirm dialog", async () => {
    const firstRow = page.locator(".order-row", { hasText: "Fixture Item 1" }).first();
    await firstRow.getByRole("button", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog", { name: "Edit Order" });
    const priceInput = page.locator("#order-platinum");
    await expect(priceInput).toBeVisible();
    await expect(priceInput).toBeFocused();
    await expect(priceInput).toHaveValue("10");

    await dialog.getByRole("button", { name: "Increase price by 1" }).click();
    await dialog.getByRole("button", { name: "Increase price by 1" }).click();
    await expect(priceInput).toHaveValue("12");
    await dialog.getByRole("button", { name: "Decrease price by 1" }).click();
    await expect(priceInput).toHaveValue("11");

    await expect(dialog.getByText(/^Market: lowest sell/)).toBeVisible();

    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(priceInput).not.toBeVisible({ timeout: 15_000 });

    await expect(
      page.locator(".order-row", { hasText: "Fixture Item 1" }).first().getByLabel("Listed price"),
    ).toHaveValue("11", { timeout: 15_000 });
  });

  test("card steppers adjust price and quantity inline, without opening the panel", async () => {
    const row = page.locator(".order-row", { hasText: "Fixture Item 3" }).first();
    const priceValue = row.getByLabel("Listed price");
    const qtyValue = row.getByLabel("Listed quantity", { exact: true });
    await expect(priceValue).toHaveValue("12");

    await row.getByRole("button", { name: "Increase price" }).click();
    await row.getByRole("button", { name: "Increase price" }).click();
    await expect(priceValue).toHaveValue("14");
    await row.getByRole("button", { name: "Increase quantity" }).click();
    await expect(qtyValue).toHaveValue("4");

    await expect(page.getByRole("heading", { name: "Market Listings" })).toHaveCount(0);

    const apply = row.getByRole("button", { name: "Apply changes" });
    await apply.click();
    await expect(apply).not.toBeVisible({ timeout: 15_000 });
    await expect(priceValue).toHaveValue("14");
    await expect(qtyValue).toHaveValue("4");
  });

  test("order-book panel is sticky and height-capped while the list scrolls", async () => {
    // Card centers can land on a stepper arrow, which swallows clicks - use the title.
    await page.locator('[title="Fixture Item 2"]').first().click();
    const heading = page.getByRole("heading", { name: "Market Listings" });
    await expect(heading).toBeVisible();
    await expect(page.getByText("Fixture Item 2", { exact: true }).first()).toBeVisible();

    const aside = page.locator("aside", { has: heading });
    const maxHeight = await aside.evaluate((node) => getComputedStyle(node).maxHeight);
    expect(maxHeight).not.toBe("none");

    const before = await heading.boundingBox();
    await page.locator("#content").evaluate((node) => node.scrollTo(0, node.scrollHeight));
    // Give sticky positioning a frame to settle before re-measuring.
    await page.waitForTimeout(250);
    const after = await heading.boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(24);
  });
});
