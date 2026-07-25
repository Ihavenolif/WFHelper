import { describe, expect, it } from "vitest";
import { __test__ } from "../../services/linuxStreamCapture";

const { pickCaptureSource } = __test__;

const SCREEN = { id: "screen:0:0", name: "Screen 1" };
const GAME = { id: "window:12345:0", name: "Warframe" };
const OTHER = { id: "window:999:0", name: "Firefox" };

describe("linux capture source", () => {
  it("prefers the Warframe window over the screen", () => {
    expect(pickCaptureSource([SCREEN, OTHER, GAME])).toBe(GAME);
  });

  it("falls back to a screen when the game window is not listed", () => {
    expect(pickCaptureSource([OTHER, SCREEN])).toBe(SCREEN);
  });

  it("does not match unrelated windows", () => {
    expect(pickCaptureSource([OTHER])).toBe(OTHER);
    expect(pickCaptureSource([])).toBeNull();
  });
});
