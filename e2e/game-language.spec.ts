import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

const SERRATION = "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod";

// Mods are a category DE really does translate. Frames and weapons are proper
// nouns that read the same in the German client, so they are not a signal here.
async function nameOfSerration(page: ElectronTestHarness["page"]) {
  return page.evaluate(async (uniqueName) => {
    const db = await window.api.getItemDatabase();
    const entry = db[uniqueName];
    return { name: entry?.name, displayName: entry?.displayName };
  }, SERRATION);
}

test("the game language dropdown relabels the item database live", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-gamelang-e2e-");
    const { page } = harness;

    await page.locator('#sidebar [data-view="settings"]').click();
    const select = page.locator('[data-setting="game-language"] select');
    await expect(select).toBeVisible();

    expect(await nameOfSerration(page)).toEqual({ name: "Serration", displayName: undefined });

    await select.selectOption("de");
    await expect
      .poll(async () => (await nameOfSerration(page)).displayName, { timeout: 30_000 })
      .toBe("Einkerbung");

    // English has to survive the switch: it is the warframe.market join key.
    expect((await nameOfSerration(page)).name).toBe("Serration");

    await select.selectOption("zh");
    await expect
      .poll(async () => (await nameOfSerration(page)).displayName, { timeout: 30_000 })
      .toBe("膛线");

    await select.selectOption("en");
    await expect
      .poll(async () => (await nameOfSerration(page)).displayName, { timeout: 30_000 })
      .toBeUndefined();
  } finally {
    await closeElectronTestHarness(harness);
  }
});

test("the game language choice survives a restart", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-gamelang-persist-");
    const { page } = harness;

    await page.locator('#sidebar [data-view="settings"]').click();
    await page.locator('[data-setting="game-language"] select').selectOption("de");
    await expect
      .poll(async () => (await nameOfSerration(page)).displayName, { timeout: 30_000 })
      .toBe("Einkerbung");

    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });

    await expect
      .poll(async () => (await nameOfSerration(page)).displayName, { timeout: 30_000 })
      .toBe("Einkerbung");
  } finally {
    await closeElectronTestHarness(harness);
  }
});
