/** Trade result toast window. */

import ctx from "./context";
import { assertTradeNotificationSender, onAuthorized } from "./ipcSecurity";
import { withScope } from "../services/logger";
import { hardenBrowserWindowNavigation } from "../services/windowSecurity";
import { TRADE_NOTIFICATION_SHOW, TRADE_NOTIFICATION_DISMISS } from "../config/shared/ipcChannels";
import type { TradeMatchPayload, TradeNotificationStatus } from "../config/shared/tradeMatch";

const log = withScope("tradeNotificationIpc");

import path from "node:path";
import { app, BrowserWindow, screen } from "electron";

// Must match the body zoom in trade-notification.css.
const SCALE = 1.5;
const WIN_W = 370 * SCALE;
const WIN_H = 80 * SCALE;
const MARGIN = 16;
const NOTIFICATION_FILE = path.join(app.getAppPath(), "renderer", "trade-notification.html");

// Hide after the renderer fade completes.
const RENDERER_VISIBLE_MS = 5_000;
const RENDERER_FADE_MS = 400;
const MAIN_HIDE_BUFFER_MS = 600;
const AUTO_HIDE_MS = RENDERER_VISIBLE_MS + RENDERER_FADE_MS + MAIN_HIDE_BUFFER_MS;

/** Payload for the vanilla notification renderer. */
export interface TradeNotificationShowPayload {
  match: TradeMatchPayload;
  status: TradeNotificationStatus;
  timing: {
    visibleMs: number;
    fadeMs: number;
  };
}

let _hideTimer: ReturnType<typeof setTimeout> | null = null;
let _rendererReady = false;
let _pendingPayload: TradeNotificationShowPayload | null = null;

function _displayNotification(
  win: InstanceType<typeof BrowserWindow>,
  payload: TradeNotificationShowPayload,
): void {
  win.webContents.send(TRADE_NOTIFICATION_SHOW, payload);
  win.showInactive();
  win.moveTop();

  if (_hideTimer) clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => {
    if (!win.isDestroyed()) win.hide();
    _hideTimer = null;
  }, AUTO_HIDE_MS);
}

function _getOrCreateWindow(): InstanceType<typeof BrowserWindow> {
  const existing = ctx.tradeNotificationWindow;
  if (existing && !existing.isDestroyed()) return existing;

  const preloadPath = path.join(
    app.getAppPath(),
    ".electron-build",
    "preload-trade-notification.js",
  );

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: dX, y: dY, width: dW } = primaryDisplay.workArea;

  const win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: dX + dW - WIN_W - MARGIN,
    y: dY + MARGIN,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  hardenBrowserWindowNavigation(win, {
    label: "trade notification window",
    allowedFilePaths: [NOTIFICATION_FILE],
    log,
  });

  _rendererReady = false;
  void win.loadFile(NOTIFICATION_FILE).catch((error: unknown) => {
    log.warn("[TradeNotification] Failed to load renderer:", error);
  });
  win.webContents.once("did-finish-load", () => {
    _rendererReady = true;
    if (_pendingPayload) {
      const payload = _pendingPayload;
      _pendingPayload = null;
      _displayNotification(win, payload);
    }
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.on("closed", () => {
    ctx.tradeNotificationWindow = null;
    _rendererReady = false;
    _pendingPayload = null;
    if (_hideTimer) {
      clearTimeout(_hideTimer);
      _hideTimer = null;
    }
  });

  ctx.tradeNotificationWindow = win;
  return win;
}

/** Shows the result of a completed trade. */
export function showTradeNotification(
  match: TradeNotificationShowPayload["match"],
  status: TradeNotificationStatus,
): void {
  const win = _getOrCreateWindow();
  const payload: TradeNotificationShowPayload = {
    match,
    status,
    timing: { visibleMs: RENDERER_VISIBLE_MS, fadeMs: RENDERER_FADE_MS },
  };
  if (_rendererReady) _displayNotification(win, payload);
  else _pendingPayload = payload;

  log.info(
    `[TradeNotification] Showing (${status}): ${match.type} ${match.itemName} ${match.platinum}p with ${match.partner}`,
  );
}

/** Registers notification overlay IPC. */
export function register(): void {
  onAuthorized(TRADE_NOTIFICATION_DISMISS, assertTradeNotificationSender, () => {
    const win = ctx.tradeNotificationWindow;
    if (win && !win.isDestroyed()) win.hide();
    if (_hideTimer) {
      clearTimeout(_hideTimer);
      _hideTimer = null;
    }
  });
}
