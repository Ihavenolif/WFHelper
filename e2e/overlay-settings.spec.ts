import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

// Guards the settings form <-> saved payload round-trip: the form is one
// normalized draft object, so a dropped field would silently stop persisting.
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

  const TOGGLES = ["Relic rewards overlay", "Riven overlay", "Arbitration post-run summary"];

  function toggle(label: string) {
    return page
      .locator("#content .view.active label.settings-control-row")
      .filter({ hasText: label })
      .locator("input[type=checkbox]");
  }

  async function openOverlayTab(): Promise<void> {
    await page.locator("#sidebar").getByText("Settings", { exact: true }).click();
    await page.locator('[data-tour-tab="overlay"]').click();
    await page.waitForTimeout(300);
  }

  test("overlay toggles survive a renderer reload", async () => {
    await openOverlayTab();

    const before: boolean[] = [];
    for (const label of TOGGLES) {
      const box = toggle(label);
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
