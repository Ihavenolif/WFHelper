import { afterEach, describe, expect, it, vi } from "vitest";

import { OVERLAY_CONTENT_VISIBLE } from "../../config/shared/ipcChannels";

import {
  createOverlayWindowBoundsChangeHandler,
  createOverlayWindowsController,
} from "../../ipc/overlay/windows";
import type { OverlaySettings } from "../../config/runtime/overlaySettings";

function createController(overlaySettings: Record<string, unknown> = {}) {
  const display = {
    id: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  };

  return createOverlayWindowsController({
    app: { getAppPath: () => "D:\\app" } as unknown as typeof import("electron").app,
    BrowserWindow: class {} as unknown as typeof import("electron").BrowserWindow,
    screen: {
      getPrimaryDisplay: () => display,
      getAllDisplays: () => [display],
      getCursorScreenPoint: () => ({ x: 960, y: 540 }),
      getDisplayNearestPoint: () => display,
    } as unknown as typeof import("electron").screen,
    ctx: {
      overlayWindow: null,
      overlaySettings: overlaySettings as OverlaySettings,
      overlayInteractiveMode: false,
    },
    log: { warn: () => {} },
    hardenBrowserWindowNavigation: () => {},
    overlayWindowFile: "D:\\app\\renderer\\overlay.html",
    windowStateKey: "reward",
  });
}

describe("createOverlayWindowsController", () => {
  it("anchors reward overlays below the detected reward band", () => {
    const controller = createController();

    const bounds = controller.getOverlayBoundsForActiveDisplay({
      sourceDisplayId: "1",
      bandTopRatio: 0.38,
      bandBottomRatio: 0.74,
    });

    expect(bounds.y).toBe(842);
  });

  it("treats null band ratios as missing anchor metadata", () => {
    const controller = createController();

    const bounds = controller.getOverlayBoundsForActiveDisplay({
      sourceDisplayId: "1",
      bandTopRatio: null,
      bandBottomRatio: null,
    });

    expect(bounds.y).toBe(605);
  });

  it("applies the user overlay scale to window dimensions", () => {
    const controller = createController({ overlayScale: 1.25 });

    const bounds = controller.getOverlayBoundsForActiveDisplay();

    expect(bounds.width).toBe(1225);
    expect(bounds.height).toBe(175);
  });

  it("uses saved manual positions when present", () => {
    const controller = createController({
      overlayWindowBounds: {
        reward: { x: 250, y: 160, displayId: "1" },
      },
    });

    const bounds = controller.getOverlayBoundsForActiveDisplay({
      sourceDisplayId: "1",
      bandTopRatio: 0.38,
    });

    expect(bounds.x).toBe(250);
    expect(bounds.y).toBe(160);
  });
});

function createWindowTypeProbe(platform: typeof process.platform) {
  const captured: Array<Record<string, unknown>> = [];
  const display = {
    id: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  };

  class FakeBrowserWindow {
    webContents = {
      id: 1,
      on: vi.fn(),
      once: vi.fn(),
      send: vi.fn(),
      setZoomFactor: vi.fn(),
      isLoadingMainFrame: () => false,
      isCrashed: () => false,
    };

    constructor(options: Record<string, unknown>) {
      captured.push(options);
    }

    loadFile() {
      return Promise.resolve();
    }
    on() {}
    setBounds() {}
    getBounds() {
      return { x: 0, y: 0, width: 100, height: 100 };
    }
    isDestroyed() {
      return false;
    }
    isVisible() {
      return false;
    }
  }

  const controller = createOverlayWindowsController({
    app: { getAppPath: () => "D:\\app" } as unknown as typeof import("electron").app,
    BrowserWindow: FakeBrowserWindow as unknown as typeof import("electron").BrowserWindow,
    screen: {
      getPrimaryDisplay: () => display,
      getAllDisplays: () => [display],
      getCursorScreenPoint: () => ({ x: 960, y: 540 }),
      getDisplayNearestPoint: () => display,
    } as unknown as typeof import("electron").screen,
    ctx: {
      overlayWindow: null,
      overlaySettings: {} as OverlaySettings,
      overlayInteractiveMode: false,
    },
    log: { warn: () => {} },
    hardenBrowserWindowNavigation: () => {},
    overlayWindowFile: "D:\\app\\renderer\\overlay.html",
    platform,
  });

  return { controller, captured };
}

describe("overlay window type", () => {
  it("maps overlays as toolbar windows on linux so the game keeps focus", () => {
    const { controller, captured } = createWindowTypeProbe("linux");

    controller.createOverlayWindow({ show: false });

    expect(captured).toHaveLength(1);
    expect(captured[0].type).toBe("toolbar");
    expect(captured[0].focusable).toBe(false);
  });

  it("keeps the default window type off linux", () => {
    const { controller, captured } = createWindowTypeProbe("win32");

    controller.createOverlayWindow({ show: false });

    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toHaveProperty("type");
  });
});

function createPresentationProbe(options: {
  platform: typeof process.platform;
  nativeWayland: boolean;
  transparent?: boolean;
  neverClickThrough?: boolean;
}) {
  const display = {
    id: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  };
  const windows: FakePresentationWindow[] = [];

  class FakePresentationWindow {
    webContents = {
      id: 1,
      on: vi.fn(),
      once: vi.fn(),
      send: vi.fn(),
      setZoomFactor: vi.fn(),
      isLoadingMainFrame: () => false,
      isCrashed: () => false,
    };

    visible = false;
    destroyed = false;

    constructor() {
      windows.push(this);
    }

    showInactive = vi.fn(() => {
      this.visible = true;
    });
    show = vi.fn(() => {
      this.visible = true;
    });
    hide = vi.fn(() => {
      this.visible = false;
    });
    destroy = vi.fn(() => {
      this.destroyed = true;
    });
    isVisible = vi.fn(() => this.visible);
    isDestroyed = vi.fn(() => this.destroyed);
    moveTop = vi.fn();
    focus = vi.fn();
    blur = vi.fn();
    setFocusable = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    setSkipTaskbar = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setAlwaysOnTop = vi.fn();
    setBounds = vi.fn();
    getBounds = vi.fn(() => ({ x: 0, y: 0, width: 100, height: 100 }));
    on = vi.fn();
    loadFile = vi.fn(() => Promise.resolve());
  }

  const ctx = {
    overlayWindow: null,
    overlaySettings: {} as OverlaySettings,
    overlayInteractiveMode: false,
  };

  const controller = createOverlayWindowsController({
    app: { getAppPath: () => "D:\\app" } as unknown as typeof import("electron").app,
    BrowserWindow: FakePresentationWindow as unknown as typeof import("electron").BrowserWindow,
    screen: {
      getPrimaryDisplay: () => display,
      getAllDisplays: () => [display],
      getCursorScreenPoint: () => ({ x: 960, y: 540 }),
      getDisplayNearestPoint: () => display,
    } as unknown as typeof import("electron").screen,
    ctx,
    log: { warn: () => {}, info: () => {} },
    hardenBrowserWindowNavigation: () => {},
    overlayWindowFile: "D:\\app\\renderer\\overlay.html",
    transparent: options.transparent !== false,
    neverClickThrough: options.neverClickThrough === true,
    platform: options.platform,
    isNativeWayland: () => options.nativeWayland,
  });

  const contentEvents = (win: FakePresentationWindow) =>
    win.webContents.send.mock.calls.filter(([channel]) => channel === OVERLAY_CONTENT_VISIBLE);

  return { controller, windows, ctx, contentEvents };
}

describe("keep-mapped presentation mode (native Wayland)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("activates only on linux native wayland with a transparent window", () => {
    const cases = [
      { platform: "win32" as const, nativeWayland: false, keepMapped: false },
      { platform: "linux" as const, nativeWayland: false, keepMapped: false },
      { platform: "linux" as const, nativeWayland: true, transparent: false, keepMapped: false },
      { platform: "linux" as const, nativeWayland: true, keepMapped: true },
    ];
    for (const testCase of cases) {
      const probe = createPresentationProbe(testCase);
      probe.controller.createOverlayWindow();
      probe.controller.markRendererReady(1);
      probe.controller.hideOverlayWindow();
      const win = probe.windows[0];
      expect(win.hide).toHaveBeenCalledTimes(testCase.keepMapped ? 0 : 1);
      expect(probe.contentEvents(win).length > 0).toBe(testCase.keepMapped);
    }
  });

  it("never unmaps or re-maps after the first show", () => {
    const { controller, windows } = createPresentationProbe({
      platform: "linux",
      nativeWayland: true,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    const win = windows[0];
    expect(win.showInactive).toHaveBeenCalledTimes(1);

    controller.hideOverlayWindow();
    controller.createOverlayWindow();
    controller.hideOverlayWindow();
    controller.showOverlayWindowInactive();

    expect(windows).toHaveLength(1);
    expect(win.hide).not.toHaveBeenCalled();
    expect(win.show).not.toHaveBeenCalled();
    expect(win.showInactive).toHaveBeenCalledTimes(1);
    expect(win.moveTop.mock.calls.length).toBeGreaterThan(1);
  });

  it("hides by blanking content and going click-through", () => {
    const { controller, windows, contentEvents } = createPresentationProbe({
      platform: "linux",
      nativeWayland: true,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    const win = windows[0];
    win.setIgnoreMouseEvents.mockClear();

    controller.hideOverlayWindow();

    expect(contentEvents(win).at(-1)).toEqual([OVERLAY_CONTENT_VISIBLE, false]);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    expect(win.isVisible()).toBe(true);

    controller.showOverlayWindowInactive();
    expect(contentEvents(win).at(-1)).toEqual([OVERLAY_CONTENT_VISIBLE, true]);
  });

  it("tracks logical visibility instead of the OS-visible state", () => {
    const { controller, windows } = createPresentationProbe({
      platform: "linux",
      nativeWayland: true,
    });

    expect(controller.isOverlayWindowVisible()).toBe(false);
    controller.createOverlayWindow();
    controller.markRendererReady(1);
    expect(controller.isOverlayWindowVisible()).toBe(true);

    controller.hideOverlayWindow();
    expect(windows[0].isVisible()).toBe(true);
    expect(controller.isOverlayWindowVisible()).toBe(false);

    controller.createOverlayWindow();
    expect(controller.isOverlayWindowVisible()).toBe(true);
  });

  it("auto-hide uses the logical hide path", () => {
    vi.useFakeTimers();
    const { controller, windows, contentEvents } = createPresentationProbe({
      platform: "linux",
      nativeWayland: true,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    controller.scheduleOverlayAutoHide(500);
    vi.advanceTimersByTime(600);

    const win = windows[0];
    expect(win.hide).not.toHaveBeenCalled();
    expect(contentEvents(win).at(-1)).toEqual([OVERLAY_CONTENT_VISIBLE, false]);
    expect(controller.isOverlayWindowVisible()).toBe(false);
  });

  it("interactive mode focuses in and returns to click-through without re-mapping", () => {
    const { controller, windows } = createPresentationProbe({
      platform: "linux",
      nativeWayland: true,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    const win = windows[0];

    controller.setOverlayInteractiveMode(true);
    expect(win.setFocusable).toHaveBeenCalledWith(true);
    expect(win.focus).toHaveBeenCalledTimes(1);

    win.setIgnoreMouseEvents.mockClear();
    controller.setOverlayInteractiveMode(false);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    expect(win.setFocusable).toHaveBeenLastCalledWith(false);
    expect(win.showInactive).toHaveBeenCalledTimes(1);
  });

  it("applies the input flags while hidden so the mode cannot desync", () => {
    const { controller, windows } = createPresentationProbe({
      platform: "win32",
      nativeWayland: false,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    const win = windows[0];
    controller.hideOverlayWindow();
    win.setIgnoreMouseEvents.mockClear();
    win.focus.mockClear();

    controller.setOverlayInteractiveMode(true);

    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(false);
    expect(win.setFocusable).toHaveBeenLastCalledWith(true);
    // Nothing on screen yet, so stacking and focus stay untouched.
    expect(win.focus).not.toHaveBeenCalled();
  });

  it("re-asserts the interactive mode when a hidden window is shown again", () => {
    const { controller, windows } = createPresentationProbe({
      platform: "win32",
      nativeWayland: false,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    const win = windows[0];
    controller.hideOverlayWindow();
    controller.setOverlayInteractiveMode(true);
    win.focus.mockClear();

    controller.showOverlayWindowInactive();

    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  it("rebuilds a click-through window before it goes interactive on linux", () => {
    const { controller, windows } = createPresentationProbe({
      platform: "linux",
      nativeWayland: false,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    const stale = windows[0];
    controller.sendOverlayEvent("relic-reward-items", [{ name: "Forma Blueprint" }]);
    expect(stale.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });

    controller.setOverlayInteractiveMode(true);

    expect(stale.destroy).toHaveBeenCalledTimes(1);
    expect(windows).toHaveLength(2);
    const fresh = windows[1];
    // The rebuilt window must never have been click-through - X11 cannot undo it.
    expect(fresh.setIgnoreMouseEvents).not.toHaveBeenCalledWith(true, { forward: true });
    expect(fresh.setIgnoreMouseEvents).toHaveBeenCalledWith(false);
    expect(fresh.setBounds).toHaveBeenCalledWith(stale.getBounds(), false);

    controller.markRendererReady(1);
    expect(fresh.webContents.send).toHaveBeenCalledWith("relic-reward-items", [
      { name: "Forma Blueprint" },
    ]);
  });

  it("re-asserts click-through after the window is actually mapped", async () => {
    vi.useFakeTimers();
    const { controller, windows } = createPresentationProbe({
      platform: "linux",
      nativeWayland: false,
    });

    controller.createOverlayWindow();
    const win = windows[0];
    win.setIgnoreMouseEvents.mockClear();

    await vi.advanceTimersByTimeAsync(2_000);

    // X11 loses the empty input region when it is set before the map.
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  });

  it("clears the input shape before re-setting it on linux", () => {
    const { controller, windows } = createPresentationProbe({
      platform: "linux",
      nativeWayland: false,
    });

    controller.createOverlayWindow();
    const win = windows[0];
    win.setIgnoreMouseEvents.mockClear();
    controller.setOverlayInteractiveMode(false);

    // An identical shape is invisible to the compositor; the clear makes it a change.
    expect(win.setIgnoreMouseEvents.mock.calls).toEqual([[false], [true, { forward: true }]]);
  });

  it("does not re-assert click-through while interactive", async () => {
    vi.useFakeTimers();
    const { controller, windows } = createPresentationProbe({
      platform: "linux",
      nativeWayland: false,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    controller.setOverlayInteractiveMode(true);
    const fresh = windows[windows.length - 1];
    fresh.setIgnoreMouseEvents.mockClear();

    await vi.advanceTimersByTimeAsync(2_000);

    expect(fresh.setIgnoreMouseEvents).not.toHaveBeenCalledWith(true, { forward: true });
  });

  it("re-arms a pending auto-hide across the interactive rebuild", async () => {
    vi.useFakeTimers();
    const { controller, windows } = createPresentationProbe({
      platform: "linux",
      nativeWayland: false,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    controller.scheduleOverlayAutoHide(3_000);
    controller.setOverlayInteractiveMode(true);
    const fresh = windows[windows.length - 1];

    await vi.advanceTimersByTimeAsync(3_500);

    expect(fresh.hide).toHaveBeenCalled();
  });

  it("keeps interactive mode on the same window off linux", () => {
    const { controller, windows } = createPresentationProbe({
      platform: "win32",
      nativeWayland: false,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);

    controller.setOverlayInteractiveMode(true);

    expect(windows).toHaveLength(1);
    expect(windows[0].destroy).not.toHaveBeenCalled();
  });

  it("never makes a never-click-through window ignore the mouse", () => {
    const { controller, windows } = createPresentationProbe({
      platform: "linux",
      nativeWayland: false,
      neverClickThrough: true,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    controller.setOverlayInteractiveMode(false);

    expect(windows).toHaveLength(1);
    expect(windows[0].setIgnoreMouseEvents).not.toHaveBeenCalledWith(true, { forward: true });
    expect(windows[0].setIgnoreMouseEvents).not.toHaveBeenCalledWith(true);
  });

  it("keeps the destroy-recreate re-show workaround off the wayland mode", () => {
    for (const probeCase of [
      { platform: "win32" as const, nativeWayland: false },
      { platform: "linux" as const, nativeWayland: false },
    ]) {
      const { controller, windows, contentEvents } = createPresentationProbe(probeCase);

      controller.createOverlayWindow();
      controller.markRendererReady(1);
      const first = windows[0];

      controller.hideOverlayWindow();
      expect(first.hide).toHaveBeenCalledTimes(1);

      controller.createOverlayWindow();
      expect(first.destroy).toHaveBeenCalledTimes(1);
      expect(windows).toHaveLength(2);
      expect(contentEvents(first)).toHaveLength(0);
      expect(contentEvents(windows[1])).toHaveLength(0);

      controller.showOverlayWindowInactive();
      expect(windows[1].showInactive.mock.calls.length).toBeGreaterThan(0);
    }
  });

  it("passive interactive-mode exit still re-shows off the wayland mode", () => {
    const { controller, windows } = createPresentationProbe({
      platform: "win32",
      nativeWayland: false,
    });

    controller.createOverlayWindow();
    controller.markRendererReady(1);
    const win = windows[0];
    const showsBefore = win.showInactive.mock.calls.length;

    controller.setOverlayInteractiveMode(true);
    controller.setOverlayInteractiveMode(false);

    expect(win.showInactive.mock.calls.length).toBe(showsBefore + 1);
  });
});

describe("createOverlayWindowBoundsChangeHandler", () => {
  it("saves bounds and retires the drag hint on live moves, except for the arbi summary", () => {
    const ctx = {
      overlaySettings: { overlayWindowBounds: {} } as unknown as OverlaySettings,
    };
    const save = vi.fn();
    const handler = createOverlayWindowBoundsChangeHandler({ ctx, save });

    handler("arbiSummary", { x: 30, y: 40 });
    expect(ctx.overlaySettings.overlayWindowBounds.arbiSummary).toEqual({ x: 30, y: 40 });
    expect(ctx.overlaySettings.overlayDragHintDismissed).toBeUndefined();

    handler("reward", { x: 10, y: 20, displayId: "1" });
    expect(ctx.overlaySettings.overlayWindowBounds.reward).toEqual({
      x: 10,
      y: 20,
      displayId: "1",
    });
    expect(ctx.overlaySettings.overlayDragHintDismissed).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
