import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyPreference,
  armWindowPresentationWatchdog,
  disposeWindowPresentationWatchdog,
  info,
  initialize,
} from "../../services/linuxDisplayBackend";

const WAYLAND = { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0" };

let dir = "";

function start(env: Record<string, string | undefined>, platform = "linux"): string {
  return initialize(dir, env, platform);
}

function remember(state: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, "linux-display.json"), JSON.stringify(state));
}

function recalled(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, "linux-display.json"), "utf8"));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-display-"));
});

afterEach(() => {
  disposeWindowPresentationWatchdog();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("initialize", () => {
  it("leaves other platforms alone", () => {
    expect(start(WAYLAND, "win32")).toBe("auto");
    expect(start(WAYLAND, "darwin")).toBe("auto");
  });

  it("leaves a plain X11 session alone", () => {
    expect(start({ DISPLAY: ":0" })).toBe("auto");
  });

  it("joins XWayland on a wayland session that has a display", () => {
    expect(start(WAYLAND)).toBe("x11");
    expect(start({ XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" })).toBe("x11");
  });

  it("stays native when there is no X display to join", () => {
    expect(start({ XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-1" })).toBe("auto");
  });

  it("stays native after XWayland failed to show a window", () => {
    remember({ xwaylandFailed: true });
    expect(start(WAYLAND)).toBe("auto");
  });

  it("honors the native-wayland opt-out", () => {
    expect(start({ ...WAYLAND, WFHELPER_NATIVE_WAYLAND: "1" })).toBe("auto");
  });

  it("lets a forced retry override a remembered failure", () => {
    remember({ xwaylandFailed: true });
    expect(start({ ...WAYLAND, WFHELPER_FORCE_XWAYLAND: "1" })).toBe("x11");
  });
});

describe("applyPreference", () => {
  it("pins a backend across restarts and clears the remembered failure", () => {
    remember({ xwaylandFailed: true });
    start(WAYLAND);

    applyPreference("x11");

    expect(start(WAYLAND)).toBe("x11");
    expect(info().preference).toBe("x11");
  });

  it("pins native wayland even when XWayland looks available", () => {
    start(WAYLAND);
    applyPreference("wayland");

    expect(start(WAYLAND)).toBe("auto");
  });

  it("rejects anything that is not a known backend", () => {
    start(WAYLAND);
    expect(() => applyPreference("x12")).toThrow(/display preference/i);
  });
});

describe("window-presentation watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up and remembers the failure when no window is presented", async () => {
    start(WAYLAND);
    const onGiveUp = vi.fn();

    armWindowPresentationWatchdog(() => false, onGiveUp);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(recalled().xwaylandFailed).toBe(true);
    expect(start(WAYLAND)).toBe("auto");
  });

  it("stands down once desktop capture sees the window", async () => {
    start(WAYLAND);
    const onGiveUp = vi.fn();

    armWindowPresentationWatchdog(() => true, onGiveUp);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("clears a remembered failure once desktop capture sees the window", async () => {
    start(WAYLAND);
    remember({ xwaylandFailed: true });

    armWindowPresentationWatchdog(() => true, vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    expect(recalled().xwaylandFailed).toBe(false);
    expect(start(WAYLAND)).toBe("x11");
  });

  it("retries transient probe failures before the deadline", async () => {
    start(WAYLAND);
    const onGiveUp = vi.fn();
    const isPresented = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("capture unavailable"))
      .mockResolvedValue(true);

    armWindowPresentationWatchdog(isPresented, onGiveUp);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(isPresented).toHaveBeenCalledTimes(2);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("ignores a stale async probe after disposal", async () => {
    start(WAYLAND);
    const onGiveUp = vi.fn();
    let resolveProbe: ((presented: boolean) => void) | undefined;

    armWindowPresentationWatchdog(
      () =>
        new Promise<boolean>((resolve) => {
          resolveProbe = resolve;
        }),
      onGiveUp,
    );
    disposeWindowPresentationWatchdog();
    resolveProbe?.(true);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("replaces an existing watchdog when armed again", async () => {
    start(WAYLAND);
    const firstGiveUp = vi.fn();
    const secondGiveUp = vi.fn();

    armWindowPresentationWatchdog(() => false, firstGiveUp);
    armWindowPresentationWatchdog(() => true, secondGiveUp);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(firstGiveUp).not.toHaveBeenCalled();
    expect(secondGiveUp).not.toHaveBeenCalled();
  });

  it("does not arm for a hand-picked backend", async () => {
    start({ ...WAYLAND, WFHELPER_FORCE_XWAYLAND: "1" });
    const onGiveUp = vi.fn();
    const isPresented = vi.fn(() => false);

    armWindowPresentationWatchdog(isPresented, onGiveUp);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(isPresented).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });
});
