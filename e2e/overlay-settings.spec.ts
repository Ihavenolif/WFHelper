import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

test.describe("Overlay settings persistence", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-overlay-settings-e2e-");
    page = harness.page;
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  const TOGGLES = ["relicRewardsOverlay", "rivenOverlay", "arbiSummaryOverlay"];

  function toggle(key: string) {
    return page.locator(`[data-setting="${key}"] input[type=checkbox]`);
  }

  async function openOverlayTab(): Promise<void> {
    await page.locator('#sidebar [data-view="settings"]').click();
    await page.locator('[data-tour-tab="overlay"]').click();
    await page.waitForTimeout(300);
  }

  test("overlay toggles survive a renderer reload", async () => {
    await openOverlayTab();

    const before: boolean[] = [];
    for (const key of TOGGLES) {
      const box = toggle(key);
      await expect(box).toHaveCount(1);
      before.push(await box.isChecked());
      await box.click();
      await page.waitForTimeout(250);
    }

    await page.reload();
    await page.waitForSelector("#sidebar");
    await openOverlayTab();

    for (let i = 0; i < TOGGLES.length; i++) {
      await expect(toggle(TOGGLES[i])).toBeChecked({ checked: !before[i] });
    }
  });
});
