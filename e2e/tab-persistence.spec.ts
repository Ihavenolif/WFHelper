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

// Each test is self-contained: a failed test restarts the worker, which re-runs
// beforeAll with a fresh sandbox and empty localStorage.
test.describe("Horizontal tab persistence", () => {
  test.setTimeout(180_000);

  let app: ElectronApplication;
  let page: Page;
  let sandboxDir: string;

  test.beforeAll(async () => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-tab-persist-e2e-"));
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

    await expect(page.locator("#app")).toBeVisible({ timeout: 90_000 });
    await page.evaluate(() => {
      localStorage.setItem("setup-completed-v2", "1");
      localStorage.setItem("feature-tour-done", "1");
    });
    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });

    // The startup inventory read is pushed before renderer listeners attach, so
    // masteryData stays null in the sandbox. Rewrite the helper file now that the
    // renderer is live: the watcher re-push loads mastery data for real.
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

  function tab(name: string | RegExp) {
    return page.locator("#content .view.active").getByRole("button", { name, exact: true });
  }

  test("Inventory keeps its filter tab across view switches", async () => {
    await openView("Inventory");
    await tab("Full Sets").click();
    await expect(tab("Full Sets")).toHaveAttribute("data-active", "true");

    await openView("Settings");
    await openView("Inventory");
    await expect(tab("Full Sets")).toHaveAttribute("data-active", "true");
  });

  test("Mastery keeps its category and status tabs across view switches", async () => {
    await openView("Mastery");
    await expect(tab("Primary")).toBeVisible({ timeout: 30_000 });
    await tab("Primary").click();
    await tab("Mastered").click();

    await openView("Settings");
    await openView("Mastery");
    await expect(tab("Primary")).toHaveAttribute("data-active", "true");
    await expect(tab("Mastered")).toHaveAttribute("data-active", "true");
  });

  test("Rivens keeps its view tab across view switches", async () => {
    await openView("Rivens");
    await tab(/^Veiled \(\d+\)$/).click();
    await expect(tab(/^Veiled \(\d+\)$/)).toHaveAttribute("data-active", "true");

    await openView("Settings");
    await openView("Rivens");
    await expect(tab(/^Veiled \(\d+\)$/)).toHaveAttribute("data-active", "true");
  });

  test("Tabs survive a renderer reload", async () => {
    await openView("Inventory");
    await tab("Full Sets").click();
    await openView("Rivens");
    await tab(/^Veiled \(\d+\)$/).click();

    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });

    await openView("Inventory");
    await expect(tab("Full Sets")).toHaveAttribute("data-active", "true");
    await openView("Rivens");
    await expect(tab(/^Veiled \(\d+\)$/)).toHaveAttribute("data-active", "true");
  });
});
