// Wayland cannot stack overlays over the game, so we join Warframe on XWayland.
// Compositors without a real one never expose our window to desktop capture.

import fs from "node:fs";
import path from "node:path";

import type { DisplayPreference, LinuxDisplayInfo } from "../config/shared/linuxDisplay";
import { isDisplayPreference } from "../config/shared/linuxDisplay";

type BackendChoice = LinuxDisplayInfo["active"];

const STATE_FILE = "linux-display.json";
// Generous: cold start plus a full item-db build is ~4s on the slowest report.
const WINDOW_PRESENTATION_TIMEOUT_MS = 20_000;
const WINDOW_PRESENTATION_POLL_MS = 250;

interface DisplayState {
  xwaylandFailed?: boolean;
  preference?: DisplayPreference;
}

let _userDataDir = "";
let _active: BackendChoice = "auto";
let _pinned = false;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
let _watchdogGeneration = 0;

function statePath(): string {
  return path.join(_userDataDir, STATE_FILE);
}

function readState(): DisplayState {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8")) as DisplayState;
  } catch {
    return {};
  }
}

function writeState(state: DisplayState): void {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state));
  } catch {
    // worst case the next start retries x11
  }
}

/** X11 unless the user opted out, or it already failed to show a window here. */
export function initialize(
  userDataDir: string,
  env: Record<string, string | undefined>,
  platform: string,
): BackendChoice {
  disposeWindowPresentationWatchdog();
  _userDataDir = userDataDir;
  _pinned = false;
  _active = "auto";
  if (platform !== "linux") return _active;
  if (!env.WAYLAND_DISPLAY && env.XDG_SESSION_TYPE !== "wayland") return _active;

  const state = readState();
  if (env.WFHELPER_FORCE_XWAYLAND === "1") {
    _pinned = true;
    _active = "x11";
  } else if (env.WFHELPER_NATIVE_WAYLAND === "1") {
    _pinned = true;
  } else if (state.preference === "x11") {
    _pinned = true;
    _active = "x11";
  } else if (state.preference === "wayland") {
    _pinned = true;
  } else if (!state.xwaylandFailed && env.DISPLAY) {
    _active = "x11";
  }
  return _active;
}

export function info(): LinuxDisplayInfo {
  return { preference: readState().preference ?? "auto", active: _active };
}

/** A hand-picked backend also clears the remembered failure, so x11 gets retried. */
export function applyPreference(value: unknown): LinuxDisplayInfo {
  if (!isDisplayPreference(value)) throw new Error("Unknown display preference");
  writeState({ preference: value });
  return { preference: value, active: _active };
}

function clearWatchdogTimers(): void {
  if (_pollTimer) clearInterval(_pollTimer);
  if (_timeoutTimer) clearTimeout(_timeoutTimer);
  _pollTimer = null;
  _timeoutTimer = null;
}

export function disposeWindowPresentationWatchdog(): void {
  _watchdogGeneration++;
  clearWatchdogTimers();
}

/** Fall back unless the X11 window manager exposes a capturable app window. */
export function armWindowPresentationWatchdog(
  isWindowPresented: () => boolean | Promise<boolean>,
  onGiveUp: () => void,
): void {
  disposeWindowPresentationWatchdog();
  if (_pinned || _active !== "x11") return;

  const generation = _watchdogGeneration;
  let probeInFlight = false;

  const probe = async (): Promise<void> => {
    if (probeInFlight || generation !== _watchdogGeneration) return;
    probeInFlight = true;
    let presented = false;
    try {
      presented = await isWindowPresented();
    } catch {
      // A transient capture error gets another poll before the deadline.
    } finally {
      probeInFlight = false;
    }
    if (!presented || generation !== _watchdogGeneration) return;

    disposeWindowPresentationWatchdog();
    const state = readState();
    if (state.xwaylandFailed) writeState({ ...state, xwaylandFailed: false });
  };

  _pollTimer = setInterval(() => void probe(), WINDOW_PRESENTATION_POLL_MS);
  _timeoutTimer = setTimeout(() => {
    if (generation !== _watchdogGeneration) return;
    disposeWindowPresentationWatchdog();
    writeState({ ...readState(), xwaylandFailed: true });
    onGiveUp();
  }, WINDOW_PRESENTATION_TIMEOUT_MS);
  void probe();
}
