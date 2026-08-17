import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "main.ts"), "utf8");
const createWindow = source.match(/function createWindow\(\): void \{([\s\S]*?)\n\}/)?.[1] ?? "";

describe("main window startup", () => {
  it("stays hidden on the app background until its first render", () => {
    expect(createWindow).toContain("show: false");
    expect(createWindow).toContain('backgroundColor: "#060a12"');
    expect(createWindow).toMatch(/once\("ready-to-show",[\s\S]*?showMainWindow\("ready-to-show"\)/);
    expect(createWindow).toMatch(/windowShown \|\| mainWindow\.isDestroyed\(\)/);
  });

  it("shows the window anyway when ready-to-show never fires", () => {
    expect(createWindow).toContain('scheduleShow(MAIN_WINDOW_SHOW_DEADLINE_MS, "deadline")');
    expect(createWindow).toMatch(/did-finish-load"[\s\S]*?scheduleShow\(MAIN_WINDOW_SHOW_GRACE_MS/);
    expect(createWindow).toMatch(/catch[\s\S]*?showMainWindow\("load-error"\)/);
  });
});
