import fs from "node:fs";

import { screen, type BrowserWindow } from "electron";

import { withScope } from "./logger";
import { writeFileAtomicSync } from "./atomicFile";
import { userDataPath } from "./userDataPath";

const log = withScope("mainWindowState");

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MainWindowState extends WindowBounds {
  maximized: boolean;
}

interface MinWindowSize {
  width: number;
  height: number;
}

const stateFile = (): string => userDataPath("main-window-state.json");

function overlapArea(bounds: WindowBounds, area: WindowBounds): number {
  const x = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const y = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return x > 0 && y > 0 ? x * y : 0;
}

// Clamp onto the work area the bounds overlap most; null when no display holds
// any of them, so a detached monitor cannot strand the window offscreen.
export function fitBoundsToDisplays(
  bounds: WindowBounds,
  workAreas: ReadonlyArray<WindowBounds>,
  min: MinWindowSize,
): WindowBounds | null {
  let best: WindowBounds | null = null;
  let bestOverlap = 0;
  for (const area of workAreas) {
    const overlap = overlapArea(bounds, area);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = area;
    }
  }
  if (!best) return null;

  const width = Math.max(min.width, Math.min(bounds.width, best.width));
  const height = Math.max(min.height, Math.min(bounds.height, best.height));
  return {
    width,
    height,
    x: Math.round(Math.min(Math.max(bounds.x, best.x), best.x + best.width - width)),
    y: Math.round(Math.min(Math.max(bounds.y, best.y), best.y + best.height - height)),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Reopen on the last monitor, clamped so a resized display cannot hide it. */
export function loadMainWindowState(min: MinWindowSize): MainWindowState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as Record<string, unknown>;
    const { x, y, width, height } = raw;
    if (
      !isFiniteNumber(x) ||
      !isFiniteNumber(y) ||
      !isFiniteNumber(width) ||
      !isFiniteNumber(height)
    ) {
      return null;
    }
    const workAreas = screen.getAllDisplays().map((display) => display.workArea);
    const fitted = fitBoundsToDisplays({ x, y, width, height }, workAreas, min);
    if (!fitted) return null;
    return { ...fitted, maximized: raw.maximized === true };
  } catch {
    return null;
  }
}

export function saveMainWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  try {
    const state: MainWindowState = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    writeFileAtomicSync(stateFile(), JSON.stringify(state));
  } catch (err) {
    log.warn("[Main] window state save failed:", err);
  }
}
