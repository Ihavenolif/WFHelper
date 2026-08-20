import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

// The planner window is warmed on boot from the same file, so the reward window
// is the one without a mode parameter.
async function rewardOverlayPage(harness: ElectronTestHarness): Promise<Page> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const win of harness.app.windows()) {
      const url = win.url();
      if (url.includes("renderer/overlay.html") && !url.includes("planner")) return win;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("reward overlay window never appeared");
}

test("the reward overlay speaks the stored language and follows a live switch", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-overlay-lang-e2e-", {
      storage: { "app-language": "de" },
    });
    const { page } = harness;

    await page.evaluate(() => window.api.simulateRelicTrigger());
    const overlay = await rewardOverlayPage(harness);

    await expect(overlay.locator("#scanning-text")).toHaveText("Lese Belohnungsbildschirm...", {
      timeout: 30_000,
    });
    await expect(overlay.locator("#best-label")).toHaveText("Beste:");
    await expect(overlay.locator('.reward-slot[data-slot="0"] .slot-player')).toHaveText("Platz 1");
    expect(await overlay.title()).toBe("Relikt-Overlay");

    await page.locator("#sidebar").getByText("Einstellungen", { exact: true }).click();
    await page
      .locator("label.settings-control-row", { hasText: "Anzeigesprache" })
      .locator("select")
      .selectOption("en");

    // Same window, no reload: main pushes the new messages to every open overlay.
    await expect(overlay.locator("#scanning-text")).toHaveText("Reading reward screen...", {
      timeout: 30_000,
    });
    await expect(overlay.locator("#best-label")).toHaveText("Best:");
    await expect(overlay.locator('.reward-slot[data-slot="0"] .slot-player')).toHaveText("Slot 1");
    expect(await overlay.title()).toBe("Relic Overlay");
  } finally {
    await closeElectronTestHarness(harness);
  }
});
