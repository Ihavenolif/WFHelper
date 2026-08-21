import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  overlayWindow,
  type ElectronTestHarness,
} from "./electronTestHarness";

// Only the real window catches this: resizable:false pins the minimum size to the
// constructed size, and Windows then trims the frame insets on every setBounds.
async function rivenBounds(harness: ElectronTestHarness): Promise<{ size: string; pos: string }[]> {
  return harness.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((win) => win.webContents.getURL().includes("riven-overlay"))
      .sort((a, b) => a.getBounds().x - b.getBounds().x)
      .map((win) => {
        const bounds = win.getBounds();
        return { size: `${bounds.width}x${bounds.height}`, pos: `${bounds.x},${bounds.y}` };
      }),
  );
}

test("dragging the riven overlay never changes its size", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-drag-size-");
    await harness.app.evaluate(({ app }) => {
      const main = process.mainModule as unknown as {
        require: (id: string) => Record<string, () => void>;
      };
      main.require(`${app.getAppPath()}/.electron-build/ipc/rivenOverlayIpc`).onRivenSessionOpen();
    });
    const overlay = await overlayWindow(harness, "riven-overlay");
    await overlay.waitForTimeout(1_000);

    // Main drops drag deltas unless the overlay is interactive, so without this
    // the window never moves and the assertion below passes for the wrong reason.
    await harness.app.evaluate(({ app }) => {
      const main = process.mainModule as unknown as {
        require: (id: string) => { setRivenInteractiveMode: (next: boolean) => void };
      };
      main
        .require(`${app.getAppPath()}/.electron-build/ipc/rivenOverlayIpc`)
        .setRivenInteractiveMode(true);
    });

    const before = await rivenBounds(harness);
    expect(before.length).toBeGreaterThan(0);

    for (let tick = 0; tick < 40; tick += 1) {
      await overlay.evaluate(() =>
        (
          window as unknown as { rivenOverlay: { moveBy: (dx: number, dy: number) => void } }
        ).rivenOverlay.moveBy(2, 1),
      );
    }
    await overlay.waitForTimeout(500);

    const after = await rivenBounds(harness);

    expect(after.map((entry) => entry.size)).toEqual(before.map((entry) => entry.size));
    // Proves the drag actually landed, so the size check above means something.
    expect(after.map((entry) => entry.pos)).not.toEqual(before.map((entry) => entry.pos));
  } finally {
    await closeElectronTestHarness(harness);
  }
});

async function leftRivenSize(
  harness: ElectronTestHarness,
): Promise<{ w: number; h: number; zoom: number }> {
  return harness.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes("side=left"),
    );
    const bounds = win ? win.getBounds() : { width: 0, height: 0 };
    return { w: bounds.width, h: bounds.height, zoom: win ? win.webContents.getZoomFactor() : 0 };
  });
}

test("a resized riven overlay reopens at the size it was left at", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-resize-scale-");
    await harness.app.evaluate(({ app }) => {
      const main = process.mainModule as unknown as {
        require: (id: string) => Record<string, () => void>;
      };
      main.require(`${app.getAppPath()}/.electron-build/ipc/rivenOverlayIpc`).onRivenSessionOpen();
    });
    const overlay = await overlayWindow(harness, "riven-overlay");
    await overlay.waitForTimeout(1_000);

    await harness.app.evaluate(({ app }) => {
      const main = process.mainModule as unknown as {
        require: (id: string) => { setRivenInteractiveMode: (next: boolean) => void };
      };
      main
        .require(`${app.getAppPath()}/.electron-build/ipc/rivenOverlayIpc`)
        .setRivenInteractiveMode(true);
    });

    const before = await leftRivenSize(harness);
    expect(before.w).toBeGreaterThan(0);

    // What a drag on the window edge does, minus the mouse.
    const target = { w: Math.round(before.w * 1.2), h: Math.round(before.h * 1.2) };
    await harness.app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes("side=left"),
      );
      const bounds = win?.getBounds();
      if (win && bounds) win.setBounds({ ...bounds, width: size.w, height: size.h });
    }, target);
    await overlay.waitForTimeout(600);

    const scale = await harness.app.evaluate(({ app }) => {
      const main = process.mainModule as unknown as {
        require: (id: string) => { default: { overlaySettings: Record<string, unknown> } };
      };
      const settings = main.require(`${app.getAppPath()}/.electron-build/ipc/context`).default
        .overlaySettings;
      return (settings.overlayWindowScales as Record<string, number>)?.rivenLeft;
    });
    expect(scale).toBeGreaterThan(1);

    // Reopening recomputes the bounds from the saved settings, which is exactly
    // where the resized size used to be thrown away.
    await harness.app.evaluate(({ app }) => {
      const main = process.mainModule as unknown as {
        require: (id: string) => Record<string, () => void>;
      };
      const riven = main.require(`${app.getAppPath()}/.electron-build/ipc/rivenOverlayIpc`);
      riven.onRivenSessionClose();
      riven.onRivenSessionOpen();
    });
    const reopenedHarness = harness;
    await expect
      .poll(async () => (await leftRivenSize(reopenedHarness)).w, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const after = await leftRivenSize(harness);
    expect(Math.abs(after.w - target.w)).toBeLessThanOrEqual(3);

    // A display too small to hold the bigger overlay clamps it back, and the
    // zoom follows the size it actually got. Only assert growth where it fits.
    const workArea = await harness.app.evaluate(
      ({ screen }) => screen.getPrimaryDisplay().workArea,
    );
    if (target.w <= workArea.width && target.h <= workArea.height) {
      // The frame alone proves nothing: the content has to have grown with it.
      expect(after.zoom).toBeGreaterThan(before.zoom);
    }
  } finally {
    await closeElectronTestHarness(harness);
  }
});
