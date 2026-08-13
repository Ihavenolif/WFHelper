import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "main.ts"), "utf8");
const createWindow = source.match(/function createWindow\(\): void \{([\s\S]*?)\n\}/)?.[1] ?? "";

describe("main window startup", () => {
  it("stays hidden on the app background until its first render", () => {
    expect(createWindow).toContain("show: false");
    expect(createWindow).toContain('backgroundColor: "#060a12"');
    expect(createWindow).toMatch(/once\("ready-to-show",[\s\S]*?mainWindow\.show\(\)/);
  });
});
