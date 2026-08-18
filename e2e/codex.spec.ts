import fs from "node:fs";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

test.describe("Mastery codex tab", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-codex-e2e-");
    page = harness.page;
    // A fresh scans cache keeps getCodexScans off the network entirely.
    fs.writeFileSync(
      path.join(harness.sandboxDir, "user-data", "codex-scans.json"),
      JSON.stringify({
        fetchedAt: Date.now(),
        scans: [
          { type: "/Lotus/Types/Enemies/Grineer/AIWeek/BladeSawmanAvatar", count: 20 },
          { type: "/Lotus/Types/Enemies/FakeE2E/ShinyTestEnemyAvatar", count: 2 },
          {
            type: "/Lotus/Types/NeutralCreatures/Conservation/BirdOfPrey/CommonBirdOfPreyAvatar",
            count: 20,
          },
          {
            type: "/Lotus/Types/Lore/Fragments/AlbrectFragments/AlbrectLoreFragmentA",
            count: 6,
          },
        ],
      }),
    );
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("renders cached scan progress joined with requirements", async () => {
    await page.locator("#sidebar").getByText("Mastery", { exact: true }).click();
    await page
      .locator("#content .view.active")
      .getByRole("button", { name: "Codex", exact: true })
      .click();

    const list = page.locator('[data-tour="mastery-codex-list"]');
    await expect(list).toBeVisible({ timeout: 30_000 });

    // Butcher is BladeSawman: the avatar-path scan must land on the wiki row.
    const butcher = list.locator("div", { has: page.getByText("Butcher", { exact: true }) });
    await expect(butcher.first()).toContainText("20 / 20");

    // Unknown types still show, prettified, without a requirement.
    await expect(list.getByText("Shiny Test Enemy", { exact: true })).toBeVisible();

    // Profile-only types resolve through the DE export extras: conservation
    // animals get their species name and a Wildlife faction chip.
    await expect(list.getByText("Common Condroc", { exact: true })).toBeVisible();
    const factionChips = page.locator('[data-tour="mastery-codex-factions"]');
    await expect(factionChips.getByRole("button", { name: "Wildlife", exact: true })).toBeVisible();
    await expect(
      factionChips.getByRole("button", { name: "Fragments", exact: true }),
    ).toBeVisible();

    await expect(page.getByText(/of \d+ enemies fully scanned/)).toBeVisible();

    // Faction chips: Corpus hides the Grineer Butcher, Grineer restores it.
    const factions = page.locator('[data-tour="mastery-codex-factions"]');
    await factions.getByRole("button", { name: "Corpus", exact: true }).click();
    await expect(list.getByText("Butcher", { exact: true })).toHaveCount(0);
    await factions.getByRole("button", { name: "Grineer", exact: true }).click();
    await expect(list.getByText("Butcher", { exact: true })).toBeVisible();
    await factions.getByRole("button", { name: "All", exact: true }).click();

    await page.screenshot({ path: path.join("test-results", "codex-tab.png") });

    // Incomplete-only drops the finished and the unknown rows.
    await page.getByText("Incomplete only").click();
    await expect(list.getByText("Butcher", { exact: true })).toHaveCount(0);
    await expect(list.getByText("Shiny Test Enemy", { exact: true })).toHaveCount(0);
  });
});
