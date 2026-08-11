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

test.describe("Feature tour", () => {
  test.setTimeout(180_000);

  let app: ElectronApplication;
  let page: Page;
  let sandboxDir: string;

  test.beforeAll(async () => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-feature-tour-e2e-"));
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
      localStorage.setItem("wf_tab_visible_foundry", "0");
      localStorage.setItem("wf_inventory_tab", "resources");
      localStorage.setItem("wf_mastery_view_tab", "roadmap");
      localStorage.setItem("wf_rivens_tab", "finder");
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

  test("walks every available step and restores expected sub-tabs", async () => {
    await page.locator("#sidebar").getByText("Settings", { exact: true }).click();
    await page.getByRole("button", { name: "Show feature tour" }).click();

    const card = page.locator("[data-tour-card]");
    const next = card.getByRole("button", { name: "Next" });

    async function expectStep(position: number, text: string): Promise<void> {
      await expect(card).toContainText(`${position} / 16`);
      await expect(card).toContainText(text);
      await expect(card).toHaveAttribute("data-tour-target-matched", "true", {
        timeout: 5_000,
      });
    }

    await expectStep(1, "Inventory shows");
    await expect(
      page.locator('[data-tour="inventory-tabs"]').getByRole("button", { name: "All Parts" }),
    ).toHaveAttribute("data-active", "true");

    await next.click();
    await expectStep(2, "Use these tabs to switch item types");
    await next.click();
    await expectStep(3, "Mastery tracks");
    await expect(
      page.locator('[data-tour="mastery-view-tabs"]').getByRole("button", { name: "Collection" }),
    ).toHaveAttribute("data-active", "true");

    await next.click();
    await expectStep(4, "Press Ctrl+F");
    await next.click();
    await expectStep(5, "MR Roadmap suggests");
    await expect(
      page.locator('[data-tour="mastery-view-tabs"]').getByRole("button", { name: "MR Roadmap" }),
    ).toHaveAttribute("data-active", "true");
    await expect(page.getByRole("button", { name: "From Relics" })).toBeVisible();

    const remainingSteps = [
      "Stats tracks resources",
      "World shows cycles",
      "Filter the arbitration schedule",
      "Relics can show your collection",
      "View and manage your warframe.market orders",
      "Browse shows public buy and sell orders",
      "Use these tabs for unveiled Rivens",
      "Arbitration runs are recorded automatically",
      "Search for an item",
      "Configure the relic",
      "Choose which tabs",
    ];

    for (const [offset, text] of remainingSteps.entries()) {
      await next.click();
      await expectStep(offset + 6, text);
      if (text.startsWith("Use these tabs")) {
        await expect(
          page
            .locator('[data-tour="riven-view-tabs"]')
            .getByRole("button", { name: /^Unveiled \(\d+\)$/ }),
        ).toHaveAttribute("data-active", "true");
      }
    }

    await card.getByRole("button", { name: "Done" }).click();
    await expect(card).toHaveCount(0);
  });
});
