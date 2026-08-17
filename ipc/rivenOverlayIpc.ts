import path from "node:path";
import { BrowserWindow, app, screen, shell } from "electron";
import ctx from "./context";
import { assertRivenOverlayRendererSender, onAuthorized } from "./ipcSecurity";
import {
  createOverlayWindowBoundsChangeHandler,
  createOverlayWindowsController,
} from "./overlay/windows";
import { applyOverlayZOrder, registerZOrderSubscriber } from "./overlay/zOrder";
import * as rivenSession from "./overlay/rivenSession";
import * as rivenScan from "./overlay/rivenScan";
import { looksLikeStaleCardRead } from "./overlay/rivenScanText";
import { sleep } from "../services/rewardScannerUtils";
import * as rivenGrading from "../services/rivenGrading";
import * as rivenDataSvc from "../services/rivenData";
import * as rivenBestAttributes from "../services/rivenBestAttributes";
import * as wfmRivenSearch from "../services/wfmRivenSearch";
import { withScope } from "../services/logger";
import { hardenBrowserWindowNavigation } from "../services/windowSecurity";
import { isRivenOverlayEnabled as isRivenOverlaySettingEnabled } from "../config/runtime/overlaySettings";

import { forceEndRivenSession } from "../services/eeLogMonitor";
import { isAllowedExternalHost } from "../config/runtime/security";
import {
  OVERLAY_INTERACTION_MODE,
  OVERLAY_THEME_VARS,
  RIVEN_OVERLAY_CLOSE,
  RIVEN_OPEN_AUCTION,
  RIVEN_GRADING_INITIAL,
  RIVEN_GRADING_ROLL,
  RIVEN_BEST_ATTRIBUTES,
  RIVEN_SIMILAR_LISTINGS,
  RIVEN_WEAPON_UPDATE,
} from "../config/shared/ipcChannels";

const log = withScope("rivenOverlayIpc");

const APP_ROOT = app.getAppPath();
const RIVEN_WINDOW_FILE = path.join(APP_ROOT, "renderer", "riven-overlay.html");

let _rivenInteractive = false;
let persistOverlaySettings: (() => void) | null = null;
const rememberOverlayWindowBounds = createOverlayWindowBoundsChangeHandler({
  ctx,
  save: () => {
    persistOverlaySettings?.();
  },
});

const RIVEN_WIN_W = 420;
const RIVEN_WIN_H = 640;
const RIVEN_TOP_OFFSET = 80;

const rivenWindowBaseOptions = {
  app,
  BrowserWindow,
  screen,
  ctx,
  log,
  hardenBrowserWindowNavigation,
  overlayWindowFile: RIVEN_WINDOW_FILE,
  displayMode: "primary" as const,
  windowWidth: RIVEN_WIN_W,
  windowHeight: RIVEN_WIN_H,
  minWindowWidth: RIVEN_WIN_W,
  minWindowHeight: RIVEN_WIN_H,
  topOffset: RIVEN_TOP_OFFSET,
  transparent: false,
  backgroundColor: "#060a12",
  preloadFileName: "preload-riven.js",
  hasShadow: false,
  onWindowRebuilt: (window: InstanceType<typeof BrowserWindow>) => replayRivenEvents(window),
};

const rivenLeftWindowsController = createOverlayWindowsController({
  ...rivenWindowBaseOptions,
  getOverlayWindow: () => ctx.rivenOverlayLeftWindow,
  setOverlayWindow: (window) => {
    ctx.rivenOverlayLeftWindow = window;
  },
  getOverlayInteractiveMode: () => _rivenInteractive,
  setOverlayInteractiveModeState: (enabled) => {
    _rivenInteractive = !!enabled;
  },
  windowLabel: "riven overlay left window",
  fileSearch: "side=left",
  placement: "top-left",
  windowStateKey: "rivenLeft",
  onWindowBoundsChanged: rememberOverlayWindowBounds,
});

const rivenRightWindowsController = createOverlayWindowsController({
  ...rivenWindowBaseOptions,
  getOverlayWindow: () => ctx.rivenOverlayRightWindow,
  setOverlayWindow: (window) => {
    ctx.rivenOverlayRightWindow = window;
  },
  getOverlayInteractiveMode: () => _rivenInteractive,
  setOverlayInteractiveModeState: (enabled) => {
    _rivenInteractive = !!enabled;
  },
  windowLabel: "riven overlay right window",
  fileSearch: "side=right",
  placement: "top-right",
  windowStateKey: "rivenRight",
  onWindowBoundsChanged: rememberOverlayWindowBounds,
});

// Riven panels are painted from live events, so a window rebuilt mid-session
// starts blank; every event is remembered and replayed into the new window.
const rivenLastEvents = new Map<string, unknown[]>();

function recordRivenEvent(channel: string, args: unknown[]): void {
  rivenLastEvents.delete(channel);
  rivenLastEvents.set(channel, args);
}

rivenSession.setEventRecorder(recordRivenEvent);

function sendToRivenWindows(channel: string, ...args: unknown[]): void {
  recordRivenEvent(channel, args);
  forEachRivenWindow((win) => win.webContents.send(channel, ...args));
}

function replayRivenEvents(window: InstanceType<typeof BrowserWindow>): void {
  // Read the map at load time, not now, so events recorded during the rebuild
  // (the interaction mode push) are included instead of lost on a raw send.
  window.webContents.once("did-finish-load", () => {
    if (window.isDestroyed()) return;
    for (const [channel, args] of rivenLastEvents) window.webContents.send(channel, ...args);
  });
}

function rivenWindowEntries() {
  return [
    { win: ctx.rivenOverlayLeftWindow, controller: rivenLeftWindowsController },
    { win: ctx.rivenOverlayRightWindow, controller: rivenRightWindowsController },
  ];
}

function getRivenWindows(): (InstanceType<typeof BrowserWindow> | null)[] {
  return rivenWindowEntries().map(({ win }) => win);
}

export function isAnyRivenWindowVisible(): boolean {
  return rivenWindowEntries().some(({ controller }) => controller.isOverlayWindowVisible());
}

let _rivenHiddenByUnfocus = false;
let _rivenUnfocusHidden: ReturnType<typeof createOverlayWindowsController>[] = [];

function hideRivenWindows(): void {
  // A real close also cancels a pending unfocus restore.
  _rivenHiddenByUnfocus = false;
  _rivenUnfocusHidden = [];
  for (const { controller } of rivenWindowEntries()) controller.hideOverlayWindow();
}

function forEachRivenWindow(fn: (win: InstanceType<typeof BrowserWindow>) => void): void {
  for (const win of getRivenWindows()) {
    if (win && !win.isDestroyed()) fn(win);
  }
}

// Alt-tab hides the panels until the game refocuses. Windows only: the linux
// focus poll treats a running game as focused, so a hide would never release.
// Focus on one of our own windows (F7 drag, main app) does not count as away.
function syncRivenWindowZOrder(warframeFocused: boolean): void {
  if (process.platform === "win32") {
    if (_rivenHiddenByUnfocus) {
      if (!warframeFocused) return;
      const restore = _rivenUnfocusHidden;
      _rivenHiddenByUnfocus = false;
      _rivenUnfocusHidden = [];
      log.info("[ZOrder] riven panels restored - Warframe refocused");
      for (const controller of restore) controller.showOverlayWindowInactive();
    } else if (!warframeFocused && !_rivenInteractive && !BrowserWindow.getFocusedWindow()) {
      const visible = rivenWindowEntries()
        .filter(({ controller }) => controller.isOverlayWindowVisible())
        .map(({ controller }) => controller);
      if (visible.length > 0) {
        _rivenHiddenByUnfocus = true;
        _rivenUnfocusHidden = visible;
        log.info("[ZOrder] riven panels hidden - Warframe unfocused");
        for (const controller of visible) controller.hideOverlayWindow();
        return;
      }
    }
  }
  for (const { win, controller } of rivenWindowEntries()) {
    if (!win || win.isDestroyed()) continue;
    if (!controller.isOverlayWindowVisible()) continue;
    applyOverlayZOrder(win, warframeFocused);
  }
}

function toggleRivenInteractiveMode(): void {
  _rivenInteractive = !_rivenInteractive;
  rivenLeftWindowsController.setOverlayInteractiveMode(_rivenInteractive);
  rivenRightWindowsController.setOverlayInteractiveMode(_rivenInteractive);
  sendToRivenWindows(OVERLAY_INTERACTION_MODE, { interactive: _rivenInteractive });
}

export function isRivenInteractiveMode(): boolean {
  return _rivenInteractive;
}

/** Setup placement step: where both panels would appear right now (saved or default). */
export function getRivenPlacementRects() {
  return {
    left: rivenLeftWindowsController.getOverlayBoundsForActiveDisplay(),
    right: rivenRightWindowsController.getOverlayBoundsForActiveDisplay(),
  };
}

function createRivenWindow(side: "left" | "right", options: { show?: boolean }): void {
  const controller = side === "left" ? rivenLeftWindowsController : rivenRightWindowsController;
  controller.createOverlayWindow(options);
  controller.setOverlayInteractiveMode(_rivenInteractive);
}

export function positionRivenOverlayWindows(): void {
  rivenLeftWindowsController.positionOverlayWindow(rivenLeftWindowsController.getAnchorMeta());
  rivenRightWindowsController.positionOverlayWindow(rivenRightWindowsController.getAnchorMeta());
}

function createRivenOverlayWindows(options: { show?: boolean } = {}): void {
  // If both already exist, just bring them to front
  const existLeft = ctx.rivenOverlayLeftWindow;
  const existRight = ctx.rivenOverlayRightWindow;
  if (existLeft && !existLeft.isDestroyed() && existRight && !existRight.isDestroyed()) {
    if (
      options.show !== false &&
      (!rivenLeftWindowsController.isOverlayWindowVisible() ||
        !rivenRightWindowsController.isOverlayWindowVisible())
    ) {
      existLeft.destroy();
      existRight.destroy();
    } else {
      for (const { win, controller } of rivenWindowEntries()) {
        if (!win || win.isDestroyed()) continue;
        applyOverlayZOrder(win, true);
        if (options.show !== false) controller.showOverlayWindowInactive();
      }
      rivenLeftWindowsController.setOverlayInteractiveMode(_rivenInteractive);
      rivenRightWindowsController.setOverlayInteractiveMode(_rivenInteractive);
      return;
    }
  }

  // Destroy stale windows
  if (existLeft && !existLeft.isDestroyed()) existLeft.destroy();
  if (existRight && !existRight.isDestroyed()) existRight.destroy();

  _rivenInteractive = false;
  _rivenHiddenByUnfocus = false;
  _rivenUnfocusHidden = [];
  rivenLastEvents.clear();

  createRivenWindow("left", options);
  createRivenWindow("right", options);
}

registerZOrderSubscriber({
  // Stays active while hidden by unfocus, or the restore poll would never run.
  isActive: () => isAnyRivenWindowVisible() || _rivenHiddenByUnfocus,
  sync: syncRivenWindowZOrder,
});

// Tracks whether the current session has produced at least one roll result.
let _rivenHasRollResult = false;

const rollScanGeneration = rivenSession.createScanGeneration();

// OCR scan timers - scans run after a short delay to let the UI animate.
let _rivenInitialScanTimer: ReturnType<typeof setTimeout> | null = null;
let _rivenRollScanTimer: ReturnType<typeof setTimeout> | null = null;

// Riven OCR delays in ms; roll and choice waits allow animation text to settle.
const INITIAL_SCAN_DELAY_MS = 200;
const ROLL_SCAN_DELAY_MS = 2850;
const CHOICE_RESCAN_DELAY_MS = 1200;

// The reveal animation scrambles the CURRENT card's text into the new stats and
// can outlast ROLL_SCAN_DELAY_MS on slow machines; rescan while it matches.
const ROLL_STALE_RESCAN_DELAY_MS = 1100;
const MAX_ROLL_STALE_RESCANS = 2;

// Last known stats for choice detection (old vs new)
let _rivenInitialStats: rivenScan.RivenStat[] = [];
let _rivenNewRollStats: rivenScan.RivenStat[] = [];

// Weapon name - starts as "Riven" placeholder, updated when cycle dialog reveals it
let _rivenWeaponName = "";

function isRivenOverlayEnabled(): boolean {
  return isRivenOverlaySettingEnabled(ctx.overlaySettings);
}

function tryGradeStats(stats: rivenScan.RivenStat[]): rivenGrading.RivenGradeResult | null {
  if (!_rivenWeaponName || _rivenWeaponName === "Riven" || stats.length === 0) return null;
  // Value-plausibility gate: rename garbled stat names whose value only fits a
  // sibling stat before grading, so the overlay re-renders the corrected name.
  const { stats: corrected } = rivenGrading.correctScannedStats(_rivenWeaponName, stats);
  return rivenGrading.gradeRiven(_rivenWeaponName, corrected);
}

function scoreRivenStatSimilarity(
  left: rivenScan.RivenStat[],
  right: rivenScan.RivenStat[],
): number {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightByName = new Map(right.map((stat) => [stat.name.toLowerCase(), stat] as const));

  let score = 0;
  for (const stat of left) {
    const match = rightByName.get(stat.name.toLowerCase());
    if (!match) {
      score -= 4;
      continue;
    }

    score += stat.positive === match.positive ? 12 : 2;
    if (stat.value != null && match.value != null) {
      const base = Math.max(5, Math.abs(stat.value), Math.abs(match.value));
      const diffRatio = Math.abs(stat.value - match.value) / base;
      score += Math.max(0, 8 - diffRatio * 24);
    } else if (stat.value === match.value) {
      score += 2;
    }
  }

  const unmatchedRight = Math.max(0, right.length - left.length);
  score -= unmatchedRight * 3;
  return score;
}

function sendGradedInitialStats(): void {
  const graded = tryGradeStats(_rivenInitialStats);
  if (graded) sendToRivenWindows(RIVEN_GRADING_INITIAL, graded);
}

function sendWeaponEnrichment(): void {
  if (!_rivenWeaponName || _rivenWeaponName === "Riven") return;

  // Send best attributes to both panels
  void rivenBestAttributes.ensureRivenGoodRollsLoaded().then(() => {
    if (!_rivenWeaponName || _rivenWeaponName === "Riven") return;
    const isMelee = rivenDataSvc.isMeleeWeapon(_rivenWeaponName);
    const weaponInfo = rivenBestAttributes.getBestAttributes(_rivenWeaponName, isMelee);
    if (weaponInfo) sendToRivenWindows(RIVEN_BEST_ATTRIBUTES, weaponInfo);
  });

  // WFM cannot apply the overlay's local similarity ranking.
  const slug = rivenDataSvc.getRivenFamilySlug(_rivenWeaponName);
  wfmRivenSearch
    .searchSimilarRivens(slug, { limit: 30 })
    .then((listings) => {
      if (listings.length > 0) sendToRivenWindows(RIVEN_SIMILAR_LISTINGS, listings);
    })
    .catch((err) => {
      log.warn("[WfmRivenSearch] search failed:", String(err));
    });
}

function clearRivenScanTimers(): void {
  if (_rivenInitialScanTimer) {
    clearTimeout(_rivenInitialScanTimer);
    _rivenInitialScanTimer = null;
  }
  if (_rivenRollScanTimer) {
    clearTimeout(_rivenRollScanTimer);
    _rivenRollScanTimer = null;
  }
}

// A detected weapon unblocks labels, grading, attributes, and market enrichment.
function applyDetectedWeapon(detected: string, source: string): void {
  log.info(`[RivenScan] weapon detected from ${source}: "${detected}"`);
  _rivenWeaponName = detected;
  sendToRivenWindows(RIVEN_WEAPON_UPDATE, detected);
  sendWeaponEnrichment();
  // Grading for the already-displayed initial stats was skipped while the
  // weapon was unknown - deliver it now.
  if (_rivenInitialStats.length > 0) sendGradedInitialStats();
}

function maybeDetectWeaponFromText(ocrText: string): void {
  if (!ocrText || (_rivenWeaponName && _rivenWeaponName !== "Riven")) return;
  const detected = rivenDataSvc.findWeaponInText(ocrText);
  if (!detected) return;
  applyDetectedWeapon(detected, "OCR");
}

// The diorama resource path identifies the weapon without localized text.
export function onRivenWeaponPath(weaponPath: string): void {
  const name = rivenDataSvc.getWeaponNameByUniqueName(weaponPath);
  if (!name) {
    log.info(`[OverlayRoute] diorama weapon path has no indexed weapon: ${weaponPath}`);
    return;
  }
  if (_rivenWeaponName && _rivenWeaponName !== "Riven") {
    if (_rivenWeaponName === name) return;
    // Within one family, the exact diorama variant controls disposition and grading.
    if (
      rivenDataSvc.getRivenFamilySlug(name) === rivenDataSvc.getRivenFamilySlug(_rivenWeaponName)
    ) {
      applyDetectedWeapon(name, "diorama load (refines OCR)");
      return;
    }
    log.warn(
      `[OverlayRoute] diorama weapon "${name}" differs from detected "${_rivenWeaponName}" - keeping the first`,
    );
    return;
  }
  applyDetectedWeapon(name, "diorama load");
}

function triggerInitialScan(layout: rivenScan.InitialCardLayout = "reroll"): void {
  if (_rivenInitialScanTimer) clearTimeout(_rivenInitialScanTimer);
  _rivenInitialScanTimer = setTimeout(async () => {
    _rivenInitialScanTimer = null;
    try {
      const { stats, rawText, titleText } = await rivenScan.scanInitialCard(layout);
      _rivenInitialStats = stats;

      // Try to extract weapon name from OCR text if not already known
      maybeDetectWeaponFromText(titleText || rawText);

      // Always settle the spinner; empty stats leave the waiting placeholder.
      rivenSession.onInitialStats(getRivenWindows(), stats);
      if (stats.length > 0) {
        // If weapon name is already known, send grading immediately
        sendGradedInitialStats();
      }
    } catch (err) {
      log.warn("[RivenScan] initial scan failed:", String(err));
      // Surface the failure in the overlay instead of leaving the spinner up.
      rivenSession.onInitialStats(getRivenWindows(), []);
    }
  }, INITIAL_SCAN_DELAY_MS);
}

function triggerRollScan(delayMs = ROLL_SCAN_DELAY_MS): void {
  if (_rivenRollScanTimer) clearTimeout(_rivenRollScanTimer);
  const mySerial = rollScanGeneration.begin();
  log.info(`[RivenScan] triggerRollScan: serial=${mySerial}, delay=${delayMs}ms`);
  _rivenRollScanTimer = setTimeout(async () => {
    _rivenRollScanTimer = null;
    log.info(
      `[RivenScan] roll timer fired: serial=${mySerial}, current=${rollScanGeneration.current()}, weapon="${_rivenWeaponName}"`,
    );
    if (!rollScanGeneration.isCurrent(mySerial)) return;
    // Clear any abort flag left by the previous scan before starting fresh.
    rivenScan.resetRivenScanAbort();
    // Snapshot at fire time: cards the reveal animation could still be showing.
    const knownCards = [_rivenInitialStats.slice(), _rivenNewRollStats.slice()];
    try {
      let panels = await rivenScan.scanNewRoll();
      if (!rollScanGeneration.isCurrent(mySerial)) return;
      for (
        let rescan = 0;
        rescan < MAX_ROLL_STALE_RESCANS && looksLikeStaleCardRead(panels.right, knownCards);
        rescan++
      ) {
        log.warn(
          `[RivenScan] roll result matches a pre-roll card (rescan ${rescan + 1}/${MAX_ROLL_STALE_RESCANS}) - waiting ${ROLL_STALE_RESCAN_DELAY_MS}ms`,
        );
        await sleep(ROLL_STALE_RESCAN_DELAY_MS);
        if (!rollScanGeneration.isCurrent(mySerial)) return;
        panels = await rivenScan.scanNewRoll();
        if (!rollScanGeneration.isCurrent(mySerial)) return;
      }
      if (looksLikeStaleCardRead(panels.right, knownCards)) {
        log.warn("[RivenScan] roll result still matches a pre-roll card");
        _rivenNewRollStats = [];
        rivenSession.onRollFailed(getRivenWindows(), _rivenInitialStats);
        return;
      }
      // The roll card's title line carries the weapon name - use it when the
      // cycle dialog gave us none (it logs a language key these days).
      maybeDetectWeaponFromText(panels.rawText ?? "");
      // If the OCR produced per-panel results, use them directly.  Otherwise
      // fall back to the initial stats we already have for the left panel.
      const leftStats = panels.left.length > 0 ? panels.left : _rivenInitialStats;
      const rightStats = panels.right;
      _rivenNewRollStats = rightStats;
      if (rightStats.length === 0) {
        rivenSession.onRollFailed(getRivenWindows(), leftStats);
        return;
      }

      _rivenHasRollResult = true;
      rivenSession.onRollResult(getRivenWindows(), {
        left: leftStats,
        right: rightStats,
      });
      const leftGraded = tryGradeStats(leftStats);
      const rightGraded = tryGradeStats(rightStats);
      if (leftGraded || rightGraded) {
        sendToRivenWindows(RIVEN_GRADING_ROLL, { left: leftGraded, right: rightGraded });
      }
    } catch (err) {
      log.warn("[RivenScan] roll scan failed:", String(err));
      if (rollScanGeneration.isCurrent(mySerial)) {
        _rivenNewRollStats = [];
        rivenSession.onRollFailed(getRivenWindows(), _rivenInitialStats);
      }
    }
  }, delayMs);
}

export function onRivenSessionClose(): void {
  log.info("[OverlayRoute] trigger=riven-session-close");
  rollScanGeneration.invalidate();
  rivenScan.abortRivenScans();
  // Prevent delayed EE.log choice events from reopening a closed overlay.
  forceEndRivenSession();
  clearRivenScanTimers();
  _rivenHasRollResult = false;
  _rivenInitialStats = [];
  _rivenNewRollStats = [];
  _rivenWeaponName = "";
  _rivenInteractive = false;
  rivenSession.endSession(getRivenWindows());
  hideRivenWindows();
  rivenLastEvents.clear();
}

export function onRivenChatView(): void {
  if (!isRivenOverlayEnabled()) return;
  log.info("[OverlayRoute] trigger=riven-chat-view (left panel only)");
  // Don't interrupt an active rolling session
  if (_rivenHasRollResult) return;

  _rivenHasRollResult = false;
  _rivenInitialStats = [];
  _rivenNewRollStats = [];
  _rivenWeaponName = "";
  rivenScan.resetRivenScanAbort();

  // Create only the left window (or reuse if already exists)
  const existLeft = ctx.rivenOverlayLeftWindow;
  if (!existLeft || existLeft.isDestroyed()) {
    _rivenInteractive = false;
    createRivenWindow("left", { show: true });
  } else {
    applyOverlayZOrder(existLeft, true);
    rivenLeftWindowsController.showOverlayWindowInactive();
    rivenLeftWindowsController.setOverlayInteractiveMode(_rivenInteractive);
  }

  // Hide right window if it exists (chat view = left only)
  rivenRightWindowsController.hideOverlayWindow();

  // Start session with "Riven" placeholder, no kuva cost
  const wins = [ctx.rivenOverlayLeftWindow];
  rivenSession.startSession(wins, "Riven", 0);
  if (ctx.overlayThemeVars && Object.keys(ctx.overlayThemeVars).length > 0) {
    const vars = { ...ctx.overlayThemeVars };
    const lw = ctx.rivenOverlayLeftWindow;
    if (lw && !lw.isDestroyed()) lw.webContents.send(OVERLAY_THEME_VARS, vars);
  }
  triggerInitialScan("chat");
}

export function onRivenSessionOpen(): void {
  if (!isRivenOverlayEnabled()) return;
  log.info("[OverlayRoute] trigger=riven-session");
  _rivenHasRollResult = false;
  rollScanGeneration.invalidate();
  _rivenInitialStats = [];
  _rivenNewRollStats = [];
  _rivenWeaponName = "";
  rivenScan.resetRivenScanAbort();
  createRivenOverlayWindows({ show: true });
  // Start (or restart) the session - resets roll count, clears panels.
  // Weapon name is "Riven" placeholder until the first cycle dialog reveals it.
  rivenSession.startSession(getRivenWindows(), "Riven", 0);
  if (ctx.overlayThemeVars && Object.keys(ctx.overlayThemeVars).length > 0) {
    const vars = { ...ctx.overlayThemeVars };
    forEachRivenWindow((win) => win.webContents.send(OVERLAY_THEME_VARS, vars));
  }
  triggerInitialScan();
}

export function onRivenRollPending(weapon: string, kuvaPerRoll: number): void {
  if (!isRivenOverlayEnabled()) return;
  _rivenHasRollResult = false;
  log.info(
    `[OverlayRoute] onRivenRollPending: weapon="${weapon}", kuva=${kuvaPerRoll}, current="${_rivenWeaponName}"`,
  );
  // Do not restart the session here; that would wipe the scanned stats and roll count.
  const isFirstReveal = _rivenWeaponName === "" || _rivenWeaponName === "Riven";
  if (weapon) {
    _rivenWeaponName = weapon;
    forEachRivenWindow((win) => {
      if (!win.isDestroyed()) win.webContents.send(RIVEN_WEAPON_UPDATE, weapon);
    });

    // First time weapon name is revealed -> grade existing stats + send enrichment
    if (isFirstReveal) {
      sendGradedInitialStats();
      sendWeaponEnrichment();
    }
  }
}

export function onRivenRollConfirmed(): void {
  if (!isRivenOverlayEnabled()) return;
  log.info("[OverlayRoute] onRivenRollConfirmed -> scheduling roll scan");
  rivenSession.onRollConfirmed(getRivenWindows());
  triggerRollScan();
}

// Fired when the two-card diorama finishes loading. Roll scans are scheduled from
// the roll-confirm event instead, so this remains a no-op to prevent duplicate scans.
export function onRivenDioramaSetup(): void {
  if (!isRivenOverlayEnabled()) return;
  log.info("[OverlayRoute] diorama setup event (no-op, roll uses fixed delay)");
}

export function onRivenChoiceConfirmed(): void {
  if (!isRivenOverlayEnabled()) return;
  // A delayed file echo may arrive after ESC; never scan a hidden desktop.
  if (!isAnyRivenWindowVisible()) {
    log.info("[RivenScan] choice confirmed but overlay is not visible - skipping");
    return;
  }

  rollScanGeneration.invalidate();
  rivenScan.abortRivenScans();
  clearRivenScanTimers();
  _rivenHasRollResult = false;

  // SendResult(4) fires for BOTH "accept new roll" and "keep current" confirms;
  // EE.log alone can't tell which side - always rescan.

  // Snapshot both stat sets NOW under local names - _rivenNewRollStats / _rivenInitialStats
  // may be overwritten if the user immediately starts another roll before the timer fires.
  const preChoiceStats = _rivenInitialStats.slice();
  const newRollStats = _rivenNewRollStats.slice();
  _rivenNewRollStats = [];

  // Tell the renderer: choice made, side unknown until rescan completes.
  rivenSession.onChoiceMade(getRivenWindows(), "unknown");

  // Rescan the single card shown after the choice once the post-choice animation settles.
  if (_rivenInitialScanTimer) clearTimeout(_rivenInitialScanTimer);
  _rivenInitialScanTimer = setTimeout(async () => {
    _rivenInitialScanTimer = null;
    rivenScan.resetRivenScanAbort();
    try {
      const stats = await rivenScan.scanChoiceRescan();

      // Determine which side was chosen by comparing OCR result to both known stat sets.
      let chosenSide: "left" | "right" | "unknown" = "unknown";
      if (stats.length > 0 && preChoiceStats.length > 0 && newRollStats.length > 0) {
        const leftScore = scoreRivenStatSimilarity(stats, preChoiceStats);
        const rightScore = scoreRivenStatSimilarity(stats, newRollStats);
        log.info(
          `[RivenScan] choice similarity: left=${leftScore.toFixed(2)} right=${rightScore.toFixed(2)}`,
        );
        const best = Math.max(leftScore, rightScore);
        const delta = Math.abs(leftScore - rightScore);
        if (best >= 12 && delta >= 6) {
          chosenSide = rightScore > leftScore ? "right" : "left";
        }
      }

      // Update _rivenInitialStats to whichever side was confirmed.
      if (chosenSide === "right" && newRollStats.length > 0) {
        _rivenInitialStats = newRollStats;
      } else if (chosenSide === "left" && preChoiceStats.length > 0) {
        _rivenInitialStats = preChoiceStats;
      } else if (stats.length > 0) {
        _rivenInitialStats = stats; // fallback: use OCR text directly
      }

      if (_rivenInitialStats.length > 0) {
        rivenSession.onChoiceMade(getRivenWindows(), chosenSide);
        rivenSession.onInitialStats(getRivenWindows(), _rivenInitialStats);
        sendGradedInitialStats();
      }
    } catch (err) {
      log.warn("[RivenScan] choice rescan failed:", String(err));
    }
  }, CHOICE_RESCAN_DELAY_MS);
}

export { toggleRivenInteractiveMode, forEachRivenWindow };

export function configureOverlaySettingsPersistence(persist: () => void): void {
  persistOverlaySettings = persist;
}

export function register(): void {
  onAuthorized(RIVEN_OVERLAY_CLOSE, assertRivenOverlayRendererSender, () => {
    rollScanGeneration.invalidate();
    rivenScan.abortRivenScans();
    clearRivenScanTimers();
    _rivenInteractive = false;
    _rivenHasRollResult = false;
    _rivenInitialStats = [];
    _rivenNewRollStats = [];
    rivenSession.endSession(getRivenWindows());
    hideRivenWindows();
    rivenLastEvents.clear();
  });

  onAuthorized(
    RIVEN_OPEN_AUCTION,
    assertRivenOverlayRendererSender,
    (_event, auctionId: unknown) => {
      const id = String(auctionId || "").replace(/[^a-zA-Z0-9]/g, "");
      if (id) {
        const url = new URL(`https://warframe.market/auction/${id}`);
        if (url.protocol === "https:" && isAllowedExternalHost(url.hostname)) {
          void shell.openExternal(url.toString());
        }
      }
    },
  );
}
