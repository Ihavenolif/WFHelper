import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name !== "userData") throw new Error(`unexpected getPath(${name})`);
      return tmpDir;
    },
  },
}));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stats-tracker-test-"));
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("statsTracker relic totals", () => {
  it("counts one consumed relic once when collections duplicate it", async () => {
    const tracker = await import("../../services/statsTracker");
    const relic = "/Lotus/Relics/LithA1Intact";

    tracker.onInventoryData({
      LevelKeys: [{ ItemType: relic, ItemCount: 5 }],
      MiscItems: [{ ItemType: relic, ItemCount: 5 }],
    });
    tracker.onInventoryData({
      LevelKeys: [{ ItemType: relic, ItemCount: 4 }],
      MiscItems: [{ ItemType: relic, ItemCount: 4 }],
    });

    expect(tracker.getHistory().at(-1)?.relicsOpened).toBe(1);
  });
});
