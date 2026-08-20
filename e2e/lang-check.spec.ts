import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

test("language dropdown flips the UI to German live", async () => {
  test.setTimeout(120_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-lang-e2e-");
    const { page } = harness;

    await page.locator("#sidebar").getByText("Settings", { exact: true }).click();
    await expect(page.getByText("Display language", { exact: true })).toBeVisible();

    // Scoped to its own row - "first select" silently moves to another control
    // as soon as one is added above it.
    await page
      .locator("label.settings-control-row", { hasText: "Display language" })
      .locator("select")
      .selectOption("de");
    await expect(
      page.locator("#sidebar").getByText("Einstellungen", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Anzeigesprache", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.locator("#sidebar").getByText("Einstellungen", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await page.locator("#sidebar").getByText("Inventar", { exact: true }).click();
    await expect(page.getByText("Keine Items gefunden", { exact: true })).toBeVisible();
  } finally {
    await closeElectronTestHarness(harness);
  }
});

test("unset language falls back to the OS locale", async () => {
  test.setTimeout(120_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-lang-os-e2e-", {
      lang: "de-DE",
      skipLanguageSeed: true,
    });
    const { page } = harness;

    // Guards the premise: a stored choice would short-circuit detectLocale()
    // before it ever reaches navigator.language.
    expect(await page.evaluate(() => localStorage.getItem("app-language"))).toBeNull();
    await expect(page.locator("#sidebar").getByText("Einstellungen", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await closeElectronTestHarness(harness);
  }
});
