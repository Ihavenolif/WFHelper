import { describe, expect, it } from "vitest";

import { findMainWindow } from "../../e2e/mainWindow";

const OVERLAY = "file:///D:/app/renderer/overlay.html";
const MAIN = "file:///D:/app/renderer/dist/index.html";

function fakeApp(urls: string[]): { windows: () => Array<{ url: () => string }> } {
  return { windows: () => urls.map((url) => ({ url: () => url })) };
}

describe("findMainWindow", () => {
  it("skips the planner overlay when it attached first", () => {
    expect(findMainWindow(fakeApp([OVERLAY, MAIN]))?.url()).toBe(MAIN);
  });

  it("finds the main window whatever the order", () => {
    expect(findMainWindow(fakeApp([MAIN, OVERLAY]))?.url()).toBe(MAIN);
  });

  it("returns null while only overlays are open", () => {
    expect(findMainWindow(fakeApp([OVERLAY, "about:blank"]))).toBeNull();
  });
});
