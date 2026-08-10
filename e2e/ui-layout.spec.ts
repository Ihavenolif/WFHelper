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

const ACCELTRA = "/Lotus/Weapons/Tenno/LongGuns/PrimeAcceltra/PrimeAcceltraWeapon";

test.describe("Shared view layout", () => {
  test.setTimeout(180_000);

  let app: ElectronApplication;
  let page: Page;
  let sandboxDir: string;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-ui-layout-e2e-"));
    const localAppData = path.join(sandboxDir, "local");
    const userData = path.join(sandboxDir, "user-data");
    const helperDir = path.join(userData, "api-helper");
    fs.mkdirSync(localAppData, { recursive: true });
    fs.mkdirSync(helperDir, { recursive: true });
    fs.writeFileSync(path.join(helperDir, "inventory.json"), JSON.stringify({ Suits: [] }));

    const env = { ...process.env } as Record<string, string>;
    delete env.ELECTRON_RUN_AS_NODE;
    env.WFHELPER_DISABLE_KEYBOARD_HOOK = "1";
    env.LOCALAPPDATA = localAppData;
    env.WFHELPER_USER_DATA = userData;

    app = await electron.launch({ args: ["--no-sandbox", "."], env });
    page = await mainWindow(app);
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await expect(page.locator("#app")).toBeVisible({ timeout: 90_000 });
    await page.evaluate(() => {
      localStorage.setItem("setup-completed-v2", "1");
      localStorage.setItem("feature-tour-done", "1");
    });
    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
    fs.writeFileSync(
      path.join(helperDir, "inventory.json"),
      JSON.stringify({
        Suits: [],
        LongGuns: [{ ItemType: ACCELTRA, XP: 450_000 }],
        XPInfo: [{ ItemType: ACCELTRA, XP: 450_000 }],
      }),
    );
  });

  test.afterAll(async () => {
    await app?.close();
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  async function openView(label: string): Promise<void> {
    await page.locator("#sidebar").getByText(label, { exact: true }).click();
    await page.waitForTimeout(300);
  }

  async function headingSize(label: string): Promise<string> {
    await openView(label);
    const heading = page.locator("#content .view.active h2").first();
    await expect(heading).toBeVisible();
    return heading.evaluate((node) => getComputedStyle(node).fontSize);
  }

  test("Stats file import respects CSP", async () => {
    await openView("Stats");
    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await expect(fileInput).toBeHidden();
    expect(consoleErrors.filter((line) => line.includes("Refused to apply inline style"))).toEqual(
      [],
    );
  });

  test("Rivens, Wiki, and Arbitrations share the standard heading size", async () => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const standard = await headingSize("Settings");
    expect(await headingSize("Rivens")).toBe(standard);
    expect(await headingSize("Wiki")).toBe(standard);
    expect(await headingSize("Arbitrations")).toBe(standard);
  });

  test("Stats trade filters fit at both panel widths", async () => {
    for (const viewport of [
      { width: 1280, height: 820 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      await openView("Stats");
      const filters = page.locator("[data-trade-filters]");
      await expect(filters).toBeVisible();
      expect(
        await filters.evaluate((node) => ({
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
        })),
      ).toEqual(
        expect.objectContaining({
          clientWidth: expect.any(Number),
          scrollWidth: expect.any(Number),
        }),
      );
      expect(await filters.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
  });

  test("Inventory starts without an empty listings panel", async () => {
    await page.setViewportSize({ width: 900, height: 600 });
    await openView("Inventory");
    await expect(page.getByRole("heading", { name: "Market Listings" })).toHaveCount(0);
    expect(
      await page.locator("#content").evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  });

  test("new planning and inventory filters are reachable", async () => {
    await page.setViewportSize({ width: 1280, height: 820 });

    await openView("Inventory");
    await page.getByRole("button", { name: "Filters" }).click();
    const customMinimum = page.getByRole("spinbutton", { name: "Custom minimum platinum" });
    await expect(customMinimum).toBeVisible();
    await customMinimum.fill("7");
    await expect(customMinimum).toHaveValue("7");

    await openView("Mastery");
    await page.getByRole("button", { name: "MR Roadmap" }).click();
    await expect(page.getByRole("button", { name: "Easy" })).toBeVisible();
    await expect(page.getByRole("button", { name: "From Relics" })).toBeVisible();
    await expect(page.getByRole("button", { name: "With Platinum" })).toBeVisible();

    await openView("Relics");
    await expect(page.getByRole("combobox", { name: "Relics" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unowned reward" })).toBeVisible();
  });
});
