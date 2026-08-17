// Wayland cannot stack overlays over the game, so we join Warframe on XWayland.
// The X socket decides reachability; desktop capture false-negatived it.

import fs from "node:fs";
import path from "node:path";

import type { DisplayPreference, LinuxDisplayInfo } from "../config/shared/linuxDisplay";
import { isDisplayPreference } from "../config/shared/linuxDisplay";

type BackendChoice = LinuxDisplayInfo["active"];

const STATE_FILE = "linux-display.json";

interface DisplayState {
  xwaylandFailed?: boolean;
  failedVersion?: string;
  hintShown?: boolean;
  preference?: DisplayPreference;
}

let _userDataDir = "";
let _appVersion = "";
let _active: BackendChoice = "auto";
let _waylandSession = false;
let _pinned = false;
let _fallbackActive = false;
let _fallbackHint = false;

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

// DISPLAY can name a server nobody is serving (niri without xwayland-satellite),
// and its socket only exists while an X server is up.
export function isXServerReachable(display: string | undefined): boolean {
  const match = /^[^:]*:(\d+)/.exec(String(display || ""));
  if (!match) return false;
  // A remote display has no local socket to check, so take it at its word.
  if (!String(display).startsWith(":") && !String(display).startsWith("unix:")) return true;
  try {
    return fs.existsSync(`/tmp/.X11-unix/X${match[1]}`);
  } catch {
    return false;
  }
}

/** X11 unless the user opted out, or it already failed to show a window here. */
export function initialize(
  userDataDir: string,
  env: Record<string, string | undefined>,
  platform: string,
  appVersion = "",
): BackendChoice {
  _userDataDir = userDataDir;
  _appVersion = appVersion;
  _pinned = false;
  _active = "auto";
  _waylandSession = false;
  _fallbackActive = false;
  _fallbackHint = false;
  if (platform !== "linux") return _active;
  if (!env.WAYLAND_DISPLAY && env.XDG_SESSION_TYPE !== "wayland") return _active;
  _waylandSession = true;

  const state = readState();
  // An update earns one fresh x11 attempt; only same-version failures stick.
  const failed = state.xwaylandFailed === true && state.failedVersion === _appVersion;
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
  } else if (!failed && env.DISPLAY && isXServerReachable(env.DISPLAY)) {
    _active = "x11";
  } else if (failed && env.DISPLAY) {
    _fallbackActive = true;
    if (!state.hintShown) {
      _fallbackHint = true;
      writeState({ ...state, hintShown: true });
    }
  }
  return _active;
}

/** Wayland session and the app did not join XWayland - overlays map natively. */
export function isNativeWayland(): boolean {
  return _waylandSession && _active !== "x11";
}

export function info(): LinuxDisplayInfo {
  return {
    preference: readState().preference ?? "auto",
    active: _active,
    fallbackActive: _fallbackActive,
    fallbackHint: _fallbackHint,
  };
}

/** A hand-picked backend also clears the remembered failure, so x11 gets retried. */
export function applyPreference(value: unknown): LinuxDisplayInfo {
  if (!isDisplayPreference(value)) throw new Error("Unknown display preference");
  writeState({ preference: value });
  return {
    preference: value,
    active: _active,
    fallbackActive: _fallbackActive,
    fallbackHint: _fallbackHint,
  };
}

/** Records this version as XWayland-incapable so the next start goes native. */
export function rememberXWaylandFailure(): void {
  const state = readState();
  // Rebuilt, not spread: a fresh failure drops hintShown so the hint re-fires.
  writeState({ preference: state.preference, xwaylandFailed: true, failedVersion: _appVersion });
}

/** Clears a remembered failure once a session proves XWayland works here. */
export function forgetXWaylandFailure(): void {
  const state = readState();
  if (!state.xwaylandFailed) return;
  writeState({ preference: state.preference });
}
