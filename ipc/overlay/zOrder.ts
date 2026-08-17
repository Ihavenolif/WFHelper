import { app, type BrowserWindow } from "electron";
import { withScope } from "../../services/logger";
import * as warframeStatus from "../../services/warframeStatus";

const log = withScope("overlayZOrder");

type OverlayWindow = InstanceType<typeof BrowserWindow>;

interface ZOrderSubscriber {
  isActive: () => boolean;
  sync: (warframeFocused: boolean) => void;
}

const subscribers = new Set<ZOrderSubscriber>();
let interval: ReturnType<typeof setInterval> | null = null;
let polling = false;
let lastFocused: boolean | null = null;

// What each window has already been told. Re-running the Win32 calls on every
// poll is not free: moveTop() can pull the overlay into the foreground, which
// unfocuses the game, which flips the next poll and drops always-on-top - a
// loop that feeds itself every two seconds and needs a click to restart.
const applied = new WeakMap<OverlayWindow, boolean>();

export function applyOverlayZOrder(win: OverlayWindow, warframeFocused: boolean): void {
  if (applied.get(win) === warframeFocused) return;
  applied.set(win, warframeFocused);

  if (warframeFocused) {
    win.setSkipTaskbar(true);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, "screen-saver");
    win.moveTop();
  } else if (win.isAlwaysOnTop()) {
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
  }
}

async function poll(): Promise<void> {
  if (polling) return;
  const active = [...subscribers].filter((subscriber) => subscriber.isActive());
  if (active.length === 0) return;

  polling = true;
  try {
    const status = await warframeStatus.getStatus();
    // Named on change only: if this flips every poll with WFHelper in the
    // foreground, the overlay is stealing focus from the game rather than
    // reacting to the user alt-tabbing away.
    if (lastFocused !== status.isFocused) {
      lastFocused = status.isFocused;
      log.info(
        `[ZOrder] warframe focused=${status.isFocused} foreground="${status.focusedProcessName ?? "?"}"`,
      );
    }
    for (const subscriber of active) subscriber.sync(status.isFocused);
  } catch {
    // status polling is best effort
  } finally {
    polling = false;
  }
}

function ensureInterval(): void {
  if (interval) return;
  interval = setInterval(() => void poll(), 2000);
}

export function registerZOrderSubscriber(subscriber: ZOrderSubscriber): void {
  subscribers.add(subscriber);
  ensureInterval();
}

app.once("before-quit", () => {
  if (interval) clearInterval(interval);
  interval = null;
  subscribers.clear();
  lastFocused = null;
});
