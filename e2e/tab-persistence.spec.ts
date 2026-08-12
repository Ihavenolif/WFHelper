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

  test("Foundry keeps its category tab across view switches", async () => {
    await openView("Foundry");
    await tab("Primary").click();
    await expect(tab("Primary")).toHaveAttribute("data-active", "true");

    await openView("Inventory");
    await openView("Foundry");
    await expect(tab("Primary")).toHaveAttribute("data-active", "true");
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
    await tab("From Relics").click();
    await expect(tab("MR Roadmap")).toHaveAttribute("data-active", "true");
    await expect(tab("From Relics")).toHaveAttribute("data-active", "true");

    await openView("Settings");
    await openView("Mastery");
    await expect(tab("MR Roadmap")).toHaveAttribute("data-active", "true");
    await expect(tab("From Relics")).toHaveAttribute("data-active", "true");
  });

  test("Rivens keeps its view tab across view switches", async () => {
    await openView("Rivens");
    await tab(/^Veiled \(\d+\)$/).click();
    await expect(tab(/^Veiled \(\d+\)$/)).toHaveAttribute("data-active", "true");

    await openView("Settings");
    await openView("Rivens");
    await expect(tab(/^Veiled \(\d+\)$/)).toHaveAttribute("data-active", "true");
  });

  test("World keeps its view tab across view switches", async () => {
    await openView("World");
    await tab("Arbitrations").click();
    await expect(tab("Arbitrations")).toHaveAttribute("data-active", "true");

    await openView("Inventory");
    await openView("World");
    await expect(tab("Arbitrations")).toHaveAttribute("data-active", "true");
  });

  test("Relics keeps its tier tab across view switches", async () => {
    await openView("Relics");
    await tab("Axi").click();
    await expect(tab("Axi")).toHaveAttribute("data-active", "true");

    await openView("Inventory");
    await openView("Relics");
    await expect(tab("Axi")).toHaveAttribute("data-active", "true");
  });

  test("Market keeps its order tab across view switches", async () => {
    await openView("Market");
    await tab("Browse").click();
    await expect(tab("Browse")).toHaveAttribute("data-active", "true");

    await openView("Inventory");
    await openView("Market");
    await expect(tab("Browse")).toHaveAttribute("data-active", "true");
  });

  test("Settings intentionally returns to General", async () => {
    await openView("Settings");
    await tab("Appearance").click();
    await expect(tab("Appearance")).toHaveClass(/active/);

    await openView("Inventory");
    await openView("Settings");
    await expect(tab("General")).toHaveClass(/active/);
  });

  test("Every non-Settings tab survives a renderer reload", async () => {
    await openView("Inventory");
    await tab("Full Sets").click();
    await openView("Foundry");
    await tab("Primary").click();
    await openView("Mastery");
    await tab("MR Roadmap").click();
    await tab("From Relics").click();
    await openView("World");
    await tab("Arbitrations").click();
    await openView("Relics");
    await tab("Axi").click();
    await openView("Market");
    await tab("Browse").click();
    await openView("Rivens");
    await tab(/^Veiled \(\d+\)$/).click();

    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });

    await openView("Inventory");
    await expect(tab("Full Sets")).toHaveAttribute("data-active", "true");
    await openView("Foundry");
    await expect(tab("Primary")).toHaveAttribute("data-active", "true");
    await openView("Mastery");
    await expect(tab("MR Roadmap")).toHaveAttribute("data-active", "true");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("wf_mastery_roadmap_tab")))
      .toBe("relics");
    await openView("World");
    await expect(tab("Arbitrations")).toHaveAttribute("data-active", "true");
    await openView("Relics");
    await expect(tab("Axi")).toHaveAttribute("data-active", "true");
    await openView("Market");
    await expect(tab("Browse")).toHaveAttribute("data-active", "true");
    await openView("Rivens");
    await expect(tab(/^Veiled \(\d+\)$/)).toHaveAttribute("data-active", "true");
    await openView("Settings");
    await expect(tab("General")).toHaveClass(/active/);
  });
});
