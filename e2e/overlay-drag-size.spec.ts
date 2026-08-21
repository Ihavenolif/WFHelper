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
