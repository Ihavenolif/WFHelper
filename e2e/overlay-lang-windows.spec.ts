import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  overlayWindow,
  setDisplayLanguage,
  type ElectronTestHarness,
} from "./electronTestHarness";

// overlay-lang.spec covers the reward overlay. These are the other three windows,
// and they are driven through main directly because no game is running.
test.describe("Riven, arbitration and trade windows follow the language", () => {
  test.setTimeout(240_000);

  let harness: ElectronTestHarness;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-overlay-windows-e2e-", {
      storage: { "app-language": "de" },
    });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  // Playwright evaluates in the main process but outside module scope, so `require`
  // is undefined there; process.mainModule is the only loader in reach.
  async function callMain(moduleName: string, fn: string, ...args: unknown[]): Promise<void> {
    await harness.app.evaluate(
      ({ app }, { moduleName: name, fn: method, args: payload }) => {
        const main = process.mainModule as unknown as {
          require: (id: string) => Record<string, (...values: unknown[]) => void>;
        };
        main.require(`${app.getAppPath()}/.electron-build/ipc/${name}`)[method](...payload);
      },
      { moduleName, fn, args },
    );
  }

  async function switchTo(code: "de" | "en"): Promise<void> {
    const settings = code === "en" ? "Einstellungen" : "Settings";
    const label = code === "en" ? "Anzeigesprache" : "Display language";
    await setDisplayLanguage(harness.page, settings, label, code);
  }

  test("the riven overlay opens in German and follows a live switch", async () => {
    await callMain("rivenOverlayIpc", "onRivenSessionOpen");
    const left = await overlayWindow(harness, "side=left");
    const right = await overlayWindow(harness, "side=right");

    await expect(left.locator("#panel-label")).toHaveText("Aktuell", { timeout: 30_000 });
    await expect(right.locator("#panel-label")).toHaveText("Neuer Wurf");
    await expect(left.locator("#btn-rescan")).toHaveAttribute(
      "title",
      "Karte und verknüpfte Waffe neu scannen",
    );
    expect(await left.title()).toBe("Riven-Overlay");

    await switchTo("en");

    await expect(left.locator("#panel-label")).toHaveText("Current", { timeout: 30_000 });
    await expect(right.locator("#panel-label")).toHaveText("New roll");
    await expect(left.locator("#btn-rescan")).toHaveAttribute(
      "title",
      "Rescan card and linked weapon",
    );
    expect(await left.title()).toBe("Riven overlay");

    await switchTo("de");
  });

  test("the arbitration summary opens in German and follows a live switch", async () => {
    await callMain("arbiOverlayIpc", "maybeShowArbiSummary", {
      id: "2026-08-20_12-00-00",
      startedAt: 1_760_000_000_000,
      endedAt: 1_760_000_180_000,
      missionName: "Arbitration: Casta Defense (Ceres)",
      node: "Casta (Ceres)",
      missionType: "defense",
      missionTypeRaw: "MT_DEFENSE",
      solNode: "SolNode167",
      durationSec: 1800,
      rotations: 6,
      drones: 12,
      totalEnemies: 900,
      vitusActual: null,
      logFile: null,
      logSizeBytes: 0,
      endReason: "mission-end",
      source: "live",
      stats: {
        killsPerDrone: 75,
        avgDroneIntervalSec: 150,
        expectedVitusMean: 14.2,
        expectedVitusStd: 3.1,
        vitusPerMin: 0.47,
        wavesPerRotation: 5,
        droneTimestamps: [],
        rewardTimestamps: [],
        preciseStartSec: 0,
        lastActivitySec: 1800,
        saturationBuckets: [{ minCount: 15, label: "15+", seconds: 765, pct: 42.5 }],
      },
    });

    const arbi = await overlayWindow(harness, "arbi-overlay.html");

    await expect(arbi.locator('[data-i18n="overlay.arbi.complete"]')).toHaveText(
      "Arbitration abgeschlossen",
      { timeout: 30_000 },
    );
    await expect(arbi.locator('[data-i18n="overlay.arbi.expectedVitus"]')).toHaveText(
      "Erwartetes Vitus",
    );
    await expect(arbi.locator('[data-i18n="overlay.arbi.saturation"]')).toHaveText(
      "Zeit bei 15+ Gegnern",
    );

    await switchTo("en");

    await expect(arbi.locator('[data-i18n="overlay.arbi.complete"]')).toHaveText(
      "Arbitration Complete",
      { timeout: 30_000 },
    );
    await expect(arbi.locator('[data-i18n="overlay.arbi.saturation"]')).toHaveText(
      "Time at 15+ Enemies",
    );

    await switchTo("de");
  });

  test("the trade toast opens in German and follows a live switch", async () => {
    await callMain(
      "tradeNotificationIpc",
      "showTradeNotification",
      {
        kind: "order",
        orderId: "test-order",
        itemName: "Braton Prime Receiver",
        itemUrlName: "braton_prime_receiver",
        itemThumb: null,
        quantity: 1,
        platinum: 42,
        partner: "Tenno",
        type: "sale",
      },
      "closed",
    );

    const toast = await overlayWindow(harness, "trade-notification.html");

    await expect(toast.locator("#trade-label")).toHaveText("Angebot geschlossen", {
      timeout: 30_000,
    });
    await expect(toast.locator("#trade-badge")).toHaveText("Verkauf");
    expect(await toast.title()).toBe("Handelsbenachrichtigung");

    await switchTo("en");
    // The toast redraws from its stored payload, so the live push is enough.
    await expect(toast.locator("#trade-label")).toHaveText("Listing Closed", { timeout: 30_000 });
    await expect(toast.locator("#trade-badge")).toHaveText("Sale");
    expect(await toast.title()).toBe("Trade Notification");
  });
});
