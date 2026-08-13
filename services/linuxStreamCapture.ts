// Keep one stream because per-scan capture reopens the Wayland portal picker.

import type { BrowserWindow as BrowserWindowType, NativeImage } from "electron";
import path from "node:path";

import { withScope } from "./logger";
import { hardenBrowserWindowNavigation } from "./windowSecurity";
import { normalizeErrorMessage } from "../config/shared/errors";

const log = withScope("linuxStreamCapture");

// After a decline, don't re-prompt on every scan retry.
const DECLINE_COOLDOWN_MS = 60_000;
// The portal picker is interactive; give the user time to answer.
const STREAM_START_TIMEOUT_MS = 120_000;
const GRAB_TIMEOUT_MS = 5_000;

let _win: BrowserWindowType | null = null;
let _starting: Promise<boolean> | null = null;
let _handlerInstalled = false;
let _declinedAt = 0;

function _now(): number {
  return Date.now();
}

// The reward layout is measured against the game's own frame, so a whole-desktop
// capture breaks every crop while Warframe runs windowed - prefer its window.
function pickCaptureSource<T extends { id: string; name: string }>(
  sources: readonly T[],
): T | null {
  const game = sources.find((source) => /(^|\W)warframe(\W|$)/i.test(source.name || ""));
  if (game) return game;
  return sources.find((source) => source.id.startsWith("screen:")) ?? sources[0] ?? null;
}

async function _installDisplayMediaHandler(win: BrowserWindowType): Promise<void> {
  if (_handlerInstalled) return;
  const { desktopCapturer } = await import("electron");
  // Routes the page's getDisplayMedia; getSources() opens the Wayland picker.
  win.webContents.session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["window", "screen"], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const source = pickCaptureSource(sources);
          if (!source) {
            callback({} as never);
            return;
          }
          log.info("[LinuxCapture] capturing source:", source.name || source.id);
          callback({ video: source });
        })
        .catch((err) => {
          log.warn("[LinuxCapture] getSources failed:", normalizeErrorMessage(err));
          callback({} as never);
        });
    },
    { useSystemPicker: true },
  );
  _handlerInstalled = true;
}

async function _createWindow(): Promise<BrowserWindowType | null> {
  try {
    const { app, BrowserWindow } = await import("electron");
    // getAppPath() is the asar root; __dirname is .electron-build, which has no renderer/.
    const captureWindowFile = path.join(app.getAppPath(), "renderer", "linux-capture.html");
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 180,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false, // keep the <video> element decoding while hidden
      },
    });
    hardenBrowserWindowNavigation(win, {
      label: "linux-capture",
      allowedFilePaths: [captureWindowFile],
      log,
    });
    await _installDisplayMediaHandler(win);
    win.on("closed", () => {
      if (_win === win) _win = null;
    });
    await win.loadFile(captureWindowFile);
    // _exec passes userGesture=true; getDisplayMedia needs a user activation.
    await _exec(win, "window.__startCapture && window.__startCapture()");
    return win;
  } catch (err) {
    log.warn("[LinuxCapture] window creation failed:", normalizeErrorMessage(err));
    return null;
  }
}

async function _exec<T>(win: BrowserWindowType, script: string): Promise<T | null> {
  try {
    return (await win.webContents.executeJavaScript(script, true)) as T;
  } catch (err) {
    log.warn("[LinuxCapture] executeJavaScript failed:", normalizeErrorMessage(err));
    return null;
  }
}

async function _waitForLiveStream(win: BrowserWindowType): Promise<boolean> {
  const deadline = _now() + STREAM_START_TIMEOUT_MS;
  for (;;) {
    const state = await _exec<string>(win, "window.__captureState && window.__captureState()");
    if (state === "live") return true;
    if (state === "dead" || state === null) return false;
    if (_now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Ensure the hidden window exists and its stream is live. One prompt max. */
async function _ensureStream(): Promise<boolean> {
  if (_win && !_win.isDestroyed()) {
    const state = await _exec<string>(_win, "window.__captureState && window.__captureState()");
    if (state === "live") return true;
    if (state === "starting") return _waitForLiveStream(_win);
    // dead: tear down and maybe recreate below
    _win.destroy();
    _win = null;
  }

  if (_now() - _declinedAt < DECLINE_COOLDOWN_MS) return false;

  if (!_starting) {
    _starting = (async () => {
      const win = await _createWindow();
      if (!win) return false;
      _win = win;
      const live = await _waitForLiveStream(win);
      if (!live) {
        _declinedAt = _now();
        log.warn(
          `[LinuxCapture] stream not acquired (portal declined/failed) - cooling down ${Math.round(DECLINE_COOLDOWN_MS / 1000)}s`,
        );
        win.destroy();
        _win = null;
      } else {
        log.info("[LinuxCapture] persistent capture stream acquired");
      }
      return live;
    })().finally(() => {
      _starting = null;
    });
  }
  return _starting;
}

export async function captureLinuxStreamFrame(): Promise<NativeImage | null> {
  const live = await _ensureStream();
  if (!live || !_win || _win.isDestroyed()) return null;

  const grab = _exec<string | null>(_win, "window.__grabFrame && window.__grabFrame()");
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), GRAB_TIMEOUT_MS));
  const dataUrl = await Promise.race([grab, timeout]);
  if (!dataUrl || typeof dataUrl !== "string") return null;

  try {
    const { nativeImage } = await import("electron");
    const img = nativeImage.createFromDataURL(dataUrl);
    if (!img || img.isEmpty()) return null;
    return img;
  } catch (err) {
    log.warn("[LinuxCapture] frame decode failed:", normalizeErrorMessage(err));
    return null;
  }
}

/** Close the hidden capture window (app shutdown). */
export function disposeLinuxStreamCapture(): void {
  if (_win && !_win.isDestroyed()) _win.destroy();
  _win = null;
}

export const __test__ = { pickCaptureSource };
