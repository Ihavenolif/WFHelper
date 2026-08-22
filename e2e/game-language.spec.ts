import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

const SERRATION = "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod";
const AEOLAK_BARREL_BLUEPRINT =
  "/Lotus/Types/Recipes/Weapons/WeaponParts/DuviriRifleBarrelBlueprint";

// Mods are a category DE really does translate. Frames and weapons are proper
// nouns that read the same in the German client, so they are not a signal here.
async function entryOf(page: ElectronTestHarness["page"], uniqueName: string) {
  return page.evaluate(async (name) => {
    const db = await window.api.getItemDatabase();
    const entry = db[name];
    return { name: entry?.name, displayName: entry?.displayName };
  }, uniqueName);
}

async function nameOfSerration(page: ElectronTestHarness["page"]) {
  return entryOf(page, SERRATION);
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

test("blueprint names follow the game language, composed the way DE composes them", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-gamelang-blueprint-");
    const { page } = harness;

    await page.locator('#sidebar [data-view="settings"]').click();
    const select = page.locator('[data-setting="game-language"] select');
    await expect(select).toBeVisible();

    expect(await entryOf(page, AEOLAK_BARREL_BLUEPRINT)).toEqual({
      name: "Aeolak Barrel Blueprint",
      displayName: undefined,
    });

    // DE gives recipes no name of their own, so this one is built from the part
    // it crafts plus the pattern. Korean appends the word.
    await select.selectOption("ko");
    await expect
      .poll(async () => (await entryOf(page, AEOLAK_BARREL_BLUEPRINT)).displayName, {
        timeout: 30_000,
      })
      .toBe("아이올락 배럴 설계도");

    // Spanish moves the word to the front, which a hand-written suffix could not.
    await select.selectOption("es");
    await expect
      .poll(async () => (await entryOf(page, AEOLAK_BARREL_BLUEPRINT)).displayName, {
        timeout: 30_000,
      })
      .toBe("Plano de Cañón de Aeolak");

    expect((await entryOf(page, AEOLAK_BARREL_BLUEPRINT)).name).toBe("Aeolak Barrel Blueprint");
  } finally {
    await closeElectronTestHarness(harness);
  }
});
