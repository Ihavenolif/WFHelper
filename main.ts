import "./config/runtime/appIdentity";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app, BrowserWindow, crashReporter, desktopCapturer, globalShortcut } from "electron";

import * as linuxDisplay from "./services/linuxDisplayBackend";

const DISPLAY_BACKEND = linuxDisplay.initialize(
  app.getPath("userData"),
  process.env,
  process.platform,
  app.getVersion(),
);
if (DISPLAY_BACKEND === "x11") {
  app.commandLine.appendSwitch("ozone-platform", "x11");
}

import { withScope } from "./services/logger";
import { MAIN_WINDOW_CSP, PERMISSIONS_POLICY } from "./config/runtime/security";
import * as windowSecurity from "./services/windowSecurity";

const log = withScope("Main");

const MAIN_WINDOW_ENTRY_FILE = path.join(app.getAppPath(), "renderer", "dist", "index.html");

import * as itemDb from "./services/itemDatabase";
import * as publicExportSource from "./services/publicExportSource";
import * as dropData from "./services/dropData";
import * as wfmCatalog from "./services/wfmCatalog";
import * as wfmSession from "./services/wfmSession";
import * as wfmPresence from "./services/wfmPresence";
import * as relicService from "./services/relicService";
import * as eeLogMonitor from "./services/eeLogMonitor";
import * as rewardScanner from "./services/rewardScanner";
import * as rewardOcrOnnx from "./services/rewardOcrOnnx";
import * as autoUpdater from "./services/autoUpdater";
import * as rivenBestAttributes from "./services/rivenBestAttributes";
import * as warframeStatus from "./services/warframeStatus";

import ctx from "./ipc/context";
import * as inventoryIpc from "./ipc/inventoryIpc";
import * as wfmIpc from "./ipc/wfmIpc";
import * as overlayIpc from "./ipc/overlayIpc";
import * as worldStateIpc from "./ipc/worldStateIpc";
import * as messageNotificationIpc from "./ipc/messageNotificationIpc";
import * as systemIpc from "./ipc/systemIpc";
import * as snapshotCacheIpc from "./ipc/snapshotCacheIpc";
import * as rankedHotsetIpc from "./ipc/rankedHotsetIpc";
import * as statsIpc from "./ipc/statsIpc";
import * as rivensIpc from "./ipc/rivensIpc";
import * as tradeNotificationIpc from "./ipc/tradeNotificationIpc";
import { applyMainWindowZoom } from "./ipc/mainWindowZoom";
import { assertMainRendererSender, handleAuthorized } from "./ipc/ipcSecurity";
import {
  HELPER_GET_STATUS,
  HELPER_RUN_NOW,
  HELPER_DOWNLOAD,
  HELPER_DOWNLOAD_PROGRESS,
  INVENTORY_UPDATED,
  ITEM_DB_UPDATED,
  TRADE_RECORDED,
  ARBI_RUN_SAVED,
} from "./config/shared/ipcChannels";
import * as statsTracker from "./services/statsTracker";
import * as arbiRunTracker from "./services/arbiRunTracker";
import { setOcrDebugDumpsEnabled } from "./services/rewardScanDebug";
import * as arbiIpc from "./ipc/arbiIpc";
import * as arbiScheduleIpc from "./ipc/arbiScheduleIpc";
import * as tradeTracker from "./services/tradeTracker";
import * as tradeWfmMatcher from "./services/tradeWfmMatcher";
import { summarizeMatches, summarizeTrade } from "./config/shared/tradeMatch";
import type { TradeMatchPayload, TradeNotificationStatus } from "./config/shared/tradeMatch";
import * as apiHelperRunner from "./services/apiHelperRunner";
import { disposeLinuxStreamCapture } from "./services/linuxStreamCapture";
import { isTradeNotificationOverlayEnabled } from "./config/runtime/overlaySettings";
import { WIN_APP_USER_MODEL_ID } from "./config/shared/appMeta";

// Keep native crash dumps local under userData\Crashes.
crashReporter.start({ uploadToServer: false });

// Suppress noisy Chromium/DevTools internal logging in terminal.
app.commandLine.appendSwitch("disable-logging");
app.commandLine.appendSwitch("log-level", "3");

// Software compositing avoids idle GPU use; grayscale text avoids LCD color fringes.
app.commandLine.appendSwitch("disable-lcd-text");
app.disableHardwareAcceleration();

// Windows uses the AUMID for notification settings and Focus Assist.
if (process.platform === "win32") {
  app.setAppUserModelId(WIN_APP_USER_MODEL_ID);
}

process.on("uncaughtException", (err: Error) => {
  log.error("[Main] uncaughtException:", err);
});

process.on("unhandledRejection", (reason: unknown) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  log.error("[Main] unhandledRejection:", error);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = ctx.mainWindow;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
}

function createWindow(): void {
  ctx.mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#060a12",
    icon: path.join(app.getAppPath(), "assets", "logo.ico"),
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? { titleBarOverlay: false } : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  windowSecurity.hardenBrowserWindowNavigation(ctx.mainWindow, {
    label: "main renderer",
    allowedFilePaths: [MAIN_WINDOW_ENTRY_FILE],
    log,
  });

  const mainWindow = ctx.mainWindow;
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });
  void mainWindow.loadFile(MAIN_WINDOW_ENTRY_FILE).catch((error: unknown) => {
    log.error("[Main] Failed to load the renderer:", error);
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });

  // Zoom resets on navigation, so re-apply on load; on move, to re-fit per display.
  ctx.mainWindow.webContents.on("did-finish-load", applyMainWindowZoom);
  ctx.mainWindow.on("moved", applyMainWindowZoom);

  // Block page reload shortcuts (Ctrl+R, Ctrl+Shift+R, F5) to prevent breaking app state.
  ctx.mainWindow.webContents.on(
    "before-input-event",
    (
      event: { preventDefault: () => void },
      input: { type?: string; key?: string; control?: boolean; meta?: boolean; shift?: boolean },
    ) => {
      if (input.type !== "keyDown") return;
      const ctrl = input.control || input.meta;
      if ((ctrl && input.key === "r") || (ctrl && input.key === "R") || input.key === "F5") {
        event.preventDefault();
      }
    },
  );

  if (!app.isPackaged) {
    ctx.mainWindow.webContents.on(
      "before-input-event",
      (_event: unknown, input: { type?: string; key?: string }) => {
        if (input.type === "keyDown" && input.key === "F12") {
          if (ctx.mainWindow?.webContents.isDevToolsOpened()) {
            ctx.mainWindow.webContents.closeDevTools();
          } else {
            ctx.mainWindow?.webContents.openDevTools({ mode: "detach" });
          }
        }
      },
    );
  }

  ctx.mainWindow.webContents.session.webRequest.onHeadersReceived(
    (
      details: { responseHeaders?: Record<string, string[]> },
      callback: (arg0: { responseHeaders: Record<string, string[]> }) => void,
    ) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [MAIN_WINDOW_CSP],
          "Permissions-Policy": [PERMISSIONS_POLICY],
        },
      });
    },
  );

  if (process.env.NODE_ENV === "development") {
    ctx.mainWindow.webContents.openDevTools();
  }

  ctx.mainWindow.on("closed", () => {
    ctx.mainWindow = null;
    if (ctx.overlayWindow && !ctx.overlayWindow.isDestroyed()) ctx.overlayWindow.destroy();
    if (ctx.rivenOverlayLeftWindow && !ctx.rivenOverlayLeftWindow.isDestroyed())
      ctx.rivenOverlayLeftWindow.destroy();
    if (ctx.rivenOverlayRightWindow && !ctx.rivenOverlayRightWindow.isDestroyed())
      ctx.rivenOverlayRightWindow.destroy();
    disposeLinuxStreamCapture();
    app.quit();
  });
}

async function isMainWindowPresented(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed()) return false;
  const sourceId = window.getMediaSourceId();
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 64, height: 64 },
    fetchWindowIcons: false,
  });
  const source = sources.find((candidate) => candidate.id === sourceId);
  return Boolean(source && !source.thumbnail.isEmpty());
}

void app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  const startupStartedAt = Date.now();
  const profileStage = (label: string, startedAt: number): void => {
    log.info(`[StartupProfile][main] ${label}: ${Date.now() - startedAt}ms`);
  };

  log.info(
    `[Startup] userData: ${app.getPath("userData")}` +
      (process.env.WFHELPER_USER_DATA ? " (WFHELPER_USER_DATA override)" : ""),
  );
  log.info(`[Startup] crashDumps: ${app.getPath("crashDumps")}`);

  const settingsStart = Date.now();
  overlayIpc.loadOverlaySettings();
  profileStage("overlay-settings:load", settingsStart);

  const statsLoadStart = Date.now();
  statsTracker.loadHistory();
  tradeTracker.loadTradeLog();
  arbiRunTracker.initArbiTracker();
  arbiRunTracker.setArbiTrackingEnabled(ctx.overlaySettings.arbiTrackingEnabled !== false);
  setOcrDebugDumpsEnabled(ctx.overlaySettings.ocrDebugImagesEnabled !== false);
  wfmPresence.setOptions({
    autoIngameEnabled: ctx.overlaySettings.wfmAutoIngameEnabled === true,
    holdMinutes: ctx.overlaySettings.wfmStatusHoldMinutes,
  });
  inventoryIpc.addInventoryListener((data: Record<string, unknown>) => {
    statsTracker.onInventoryData(data);
  });
  profileStage("stats:load-history", statsLoadStart);

  const ipcRegisterStart = Date.now();
  inventoryIpc.register();
  wfmIpc.register();
  overlayIpc.register();
  worldStateIpc.register();
  systemIpc.register();
  snapshotCacheIpc.register();
  rankedHotsetIpc.register();
  statsIpc.register();
  rivensIpc.register();
  tradeNotificationIpc.register();
  arbiIpc.register();
  arbiScheduleIpc.register();

  const attachInventoryAfterHelperRun = (ok: boolean) => {
    if (!ok || ctx.currentInventoryPath) return;
    const discovered = inventoryIpc.findInventoryFile();
    if (!discovered) return;
    ctx.currentInventoryPath = discovered;
    inventoryIpc.watchInventoryFile(discovered);
    log.info("First inventory load detected at:", discovered);
    const data = inventoryIpc.readInventory(discovered);
    if (data && ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      ctx.mainWindow.webContents.send(INVENTORY_UPDATED, data);
    }
  };

  // Helper runner IPC
  handleAuthorized(HELPER_GET_STATUS, assertMainRendererSender, () => ({
    ...apiHelperRunner.getStatus(),
    inventoryLastModified: inventoryIpc.getLoadedInventoryModifiedAt(),
  }));
  handleAuthorized(HELPER_RUN_NOW, assertMainRendererSender, async () => {
    const ok = await apiHelperRunner.runOnce();
    attachInventoryAfterHelperRun(ok);
    return { ok };
  });
  handleAuthorized(HELPER_DOWNLOAD, assertMainRendererSender, async () => {
    const ok = await apiHelperRunner.downloadHelper((progress) => {
      if (ctx.mainWindow) {
        ctx.mainWindow.webContents.send(HELPER_DOWNLOAD_PROGRESS, progress);
      }
    });
    if (ok) {
      apiHelperRunner.startPolling(undefined, attachInventoryAfterHelperRun);
    }
    return { ok };
  });

  profileStage("ipc:register", ipcRegisterStart);

  const itemDbStart = Date.now();
  publicExportSource.loadOverlayFromDisk();
  itemDb.buildDatabase();
  profileStage("item-db:build", itemDbStart);

  // Refresh from DE in the background; rebuild if it added anything.
  void publicExportSource
    .refreshOverlayFromDE()
    .then(({ changed }) => {
      if (changed) {
        itemDb.buildDatabase();
        if (ctx.mainWindow) ctx.mainWindow.webContents.send(ITEM_DB_UPDATED);
        log.info("[ItemDB] Rebuilt with refreshed DE public export");
      }
    })
    .catch((err: Error) => log.error("[ItemDB] DE public export refresh failed:", err));

  // Drop tables for the wiki tab: disk cache first, then refresh in background.
  dropData.loadFromDisk();
  void dropData
    .refreshFromUpstream()
    .catch((err: Error) => log.error("[Drops] refresh failed:", err));

  const catalogStart = Date.now();
  wfmCatalog
    .ensureLoaded()
    .catch((err: Error) => log.error("[WFMarket] startup fetch failed:", err));
  profileStage("wfm-catalog:ensureLoaded-dispatch", catalogStart);

  const rivenGoodRollsStart = Date.now();
  void rivenBestAttributes
    .ensureRivenGoodRollsLoaded(true)
    .catch((err: Error) => log.error("[Rivens] startup good-roll fetch failed:", err));
  profileStage("riven-good-rolls:ensureLoaded-dispatch", rivenGoodRollsStart);

  const windowStart = Date.now();
  createWindow();
  profileStage("window:create", windowStart);

  if (DISPLAY_BACKEND === "x11") {
    const mainWindow = ctx.mainWindow!;
    log.info("[Display] joined XWayland - waiting for a capturable window");
    linuxDisplay.armWindowPresentationWatchdog(
      () => isMainWindowPresented(mainWindow),
      () => {
        log.error("[Display] XWayland window was not presented - relaunching on native Wayland");
        app.relaunch();
        app.exit(0);
      },
    );
  } else if (linuxDisplay.info().fallbackActive) {
    log.warn(
      "[Display] native Wayland fallback active - overlays may misbehave; pin XWayland in Settings to retry",
    );
  }

  const sessionRestoreStart = Date.now();
  void wfmSession
    .restoreSession()
    .then(() => {
      wfmIpc.startListenerIfLoggedIn();
    })
    .catch((err: Error) => {
      log.warn("[WFMSession] restore failed:", err.message);
    });
  profileStage("wfm-session:restore-dispatch", sessionRestoreStart);

  const updaterStart = Date.now();
  autoUpdater.initialize(ctx.mainWindow!);
  profileStage("auto-updater:init", updaterStart);

  const hotkeyStart = Date.now();
  startOverlayHotkeyGate();
  profileStage("overlay-hotkey:register", hotkeyStart);

  // Keep prewarming off the first-paint path.
  setTimeout(() => {
    try {
      overlayIpc.warmPlannerOverlayWindow();
    } catch (err) {
      log.warn("[Overlay] planner pre-warm failed:", err);
    }
  }, 4000).unref();

  // Load Paddle before the first reward scan needs it.
  setTimeout(() => {
    void rewardOcrOnnx.warmupRewardStripOnnx();
  }, 6000).unref();

  const inventoryDetectStart = Date.now();
  apiHelperRunner.init();
  const loadedInventory = inventoryIpc.loadInitialInventory();
  if (loadedInventory) {
    log.info("Loaded inventory at:", loadedInventory.path);

    // The renderer may finish loading before inventory discovery completes.
    // (local file loads can complete in <100 ms).
    const data = loadedInventory.data;
    if (data && ctx.mainWindow) {
      const wc = ctx.mainWindow.webContents;
      const sendInventory = () => {
        if (ctx.mainWindow) {
          ctx.mainWindow.webContents.send(INVENTORY_UPDATED, data);
        }
      };
      if (wc.isLoading()) {
        wc.once("did-finish-load", sendInventory);
      } else {
        sendInventory();
      }
    }
  }

  // The first helper run can create inventory.json after initial discovery.
  // Re-run discovery after polling so the watcher attaches.
  apiHelperRunner.startPolling(undefined, attachInventoryAfterHelperRun);

  profileStage("inventory:auto-detect", inventoryDetectStart);

  const eeLogStart = Date.now();
  const eeLogPath = eeLogMonitor.startWatching({
    onLoginComplete: () => apiHelperRunner.runAfterGameLogin(),
    onRewardTrigger: (stalenessMs) => overlayIpc.onRelicRewardTrigger("eelog", stalenessMs),
    onRewardUiReady: () => overlayIpc.notifyRewardUiReady(),
    onRewardScreenClose: (stalenessMs) => overlayIpc.notifyRewardScreenClosed(stalenessMs),
    onRelicSelectionOpen: () => overlayIpc.onRelicSelectionTrigger("eelog"),
    onRelicSelectionClose: () => overlayIpc.onRelicSelectionClose(),
    onActiveMissionTag: (tag) => overlayIpc.setActiveMissionTag(tag),
    onInGameMessage: (playerName) => void messageNotificationIpc.notifyInGameMessage(playerName),
    onTradeConfirmed: (trade) => {
      const event = tradeTracker.recordTradeFromLog(trade);
      if (!event) return;

      // Push trade to renderer in real-time
      const win = ctx.mainWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send(TRADE_RECORDED, { trade: event, wfmMatches: [] });
      }

      // Always report the auto-close outcome.
      void (async () => {
        const notify = (status: TradeNotificationStatus, match?: TradeMatchPayload | null) => {
          if (!isTradeNotificationOverlayEnabled(ctx.overlaySettings)) return;
          tradeNotificationIpc.showTradeNotification(match ?? summarizeTrade(event), status);
        };

        if (!ctx.overlaySettings.autoCloseWfmOrders || !wfmSession.getToken()) {
          notify("detected");
          return;
        }

        try {
          const matches = await tradeWfmMatcher.matchTradeToOrders(trade);
          if (matches.length === 0) {
            notify("no-match");
            return;
          }

          const closed: TradeMatchPayload[] = [];
          for (const match of matches) {
            if (await tradeWfmMatcher.closeMatchedOrder(match)) closed.push(match);
          }
          if (closed.length === 0) {
            notify("close-failed", matches[0]);
            return;
          }

          tradeTracker.markTradeWfmClosed(event.id);

          if (win && !win.isDestroyed()) {
            win.webContents.send(TRADE_RECORDED, {
              trade: { ...event, wfmClosed: true },
              wfmMatches: closed,
            });
          }

          notify("closed", summarizeMatches(closed, event.platChange));
        } catch (err) {
          log.warn("[Trade] Auto-close error:", String(err));
          notify("no-match");
        }
      })();
    },
    onRivenSessionOpen: () => overlayIpc.onRivenSessionOpen(),
    onRivenSessionClose: () => overlayIpc.onRivenSessionClose(),
    onRivenRollPending: (weapon: string, cost: number) =>
      overlayIpc.onRivenRollPending(weapon, cost),
    onRivenRollConfirmed: () => overlayIpc.onRivenRollConfirmed(),
    onRivenDioramaSetup: () => overlayIpc.onRivenDioramaSetup(),
    onRivenChoiceConfirmed: () => overlayIpc.onRivenChoiceConfirmed(),
    onRivenChatView: () => overlayIpc.onRivenChatView(),
    onRivenWeaponPath: (weaponPath: string) => overlayIpc.onRivenWeaponPath(weaponPath),
    onArbiRunSaved: (run) => {
      const win = ctx.mainWindow;
      if (win && !win.isDestroyed()) win.webContents.send(ARBI_RUN_SAVED, run);
      overlayIpc.maybeShowArbiSummary(run);
    },
  });
  if (eeLogPath) log.info("[EELog] Monitoring:", eeLogPath);
  else log.info("[EELog] EE.log not found - relic overlay trigger disabled");
  profileStage("ee-log:watch-start", eeLogStart);

  const rewardItemsStart = Date.now();
  try {
    rewardScanner.setRelicItems(relicService.getRelicRewardItems());
  } catch (err) {
    log.error("[RewardScanner] Failed to load relic items:", (err as Error).message);
  }
  profileStage("relic-reward-items:prepare", rewardItemsStart);

  profileStage("total-main-startup-sequence", startupStartedAt);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

// Release global shortcuts when Warframe exits so they do not affect other apps.
let _hotkeyGateTimer: ReturnType<typeof setInterval> | null = null;
let _hotkeyGameActive = false;

async function syncOverlayHotkeyGate(): Promise<void> {
  try {
    const { isOpen } = await warframeStatus.getStatus();
    if (isOpen === _hotkeyGameActive) return;
    _hotkeyGameActive = isOpen;
    overlayIpc.setOverlayHotkeysActive(isOpen);
    void wfmPresence.syncGameRunning(isOpen);
  } catch {
    // best effort; keep the gate in its current state
  }
}

function startOverlayHotkeyGate(): void {
  void syncOverlayHotkeyGate();
  _hotkeyGateTimer = setInterval(() => void syncOverlayHotkeyGate(), 3000);
}

function stopOverlayHotkeyGate(): void {
  if (_hotkeyGateTimer) clearInterval(_hotkeyGateTimer);
  _hotkeyGateTimer = null;
}

app.on("before-quit", () => {
  linuxDisplay.disposeWindowPresentationWatchdog();
  inventoryIpc.stopInventoryWatcher();
  apiHelperRunner.stopPolling();
  eeLogMonitor.stopWatching();
  stopOverlayHotkeyGate();
  overlayIpc.unregisterOverlayHotkey();
  overlayIpc.disposeOverlayHotkeys();
  arbiScheduleIpc.shutdown();
  disposeLinuxStreamCapture();
});

app.on("will-quit", () => {
  try {
    globalShortcut.unregisterAll();
  } catch {
    // ignore
  }

  const tempOcrPath = path.join(os.tmpdir(), "wf-companion-reward-ocr.png");
  try {
    fs.unlinkSync(tempOcrPath);
  } catch {
    // ignore missing temp file
  }
});
