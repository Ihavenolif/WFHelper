import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  writeHarnessInventory,
  type ElectronTestHarness,
} from "./electronTestHarness";

const ACCELTRA = "/Lotus/Weapons/Tenno/LongGuns/PrimeAcceltra/PrimeAcceltraWeapon";

// Each test is self-contained: a failed test restarts the worker, which re-runs
// beforeAll with a fresh sandbox and empty localStorage.
test.describe("Horizontal tab persistence", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-tab-persist-e2e-");
    page = harness.page;
    writeHarnessInventory(harness, {
      Suits: [],
      LongGuns: [{ ItemType: ACCELTRA, XP: 450_000 }],
      XPInfo: [{ ItemType: ACCELTRA, XP: 450_000 }],
    });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
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

  test("Mastery keeps its Roadmap sub-tab across view switches", async () => {
    await openView("Mastery");
    await tab("MR Roadmap").click();
    await expect(tab("MR Roadmap")).toHaveAttribute("data-active", "true");

    await openView("Settings");
    await openView("Mastery");
    await expect(tab("MR Roadmap")).toHaveAttribute("data-active", "true");
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
