import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

import { RIVEN_ROLL_RESULT } from "../../config/shared/ipcChannels";
import * as rivenSession from "../../ipc/overlay/rivenSession";

function windowWithSender(send: ReturnType<typeof vi.fn>): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { send },
  } as unknown as BrowserWindow;
}

describe("rivenSession", () => {
  afterEach(() => rivenSession.endSession([]));

  it("settles failed scans and accounts for the completed roll", () => {
    const send = vi.fn();
    const wins = [windowWithSender(send)];
    const left = [{ name: "Damage", positive: true, value: 100 }];
    rivenSession.startSession(wins, "Braton", 900);

    rivenSession.onRollFailed(wins, left);

    expect(send).toHaveBeenLastCalledWith(RIVEN_ROLL_RESULT, {
      rollCount: 1,
      totalKuvaSpent: 900,
      left,
      right: [],
    });
  });

  it("invalidates stale scan completions", () => {
    const generation = rivenSession.createScanGeneration();
    const first = generation.begin();
    expect(generation.isCurrent(first)).toBe(true);

    generation.invalidate();
    expect(generation.isCurrent(first)).toBe(false);

    const second = generation.begin();
    expect(generation.isCurrent(second)).toBe(true);
    expect(generation.isCurrent(first)).toBe(false);
  });
});
