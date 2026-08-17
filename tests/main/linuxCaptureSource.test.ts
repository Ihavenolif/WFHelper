import { describe, expect, it } from "vitest";
import { __test__ } from "../../services/linuxStreamCapture";

const { pickCaptureSource, isUsableFrame } = __test__;

function rawFrame(width: number, height: number, byteLength = width * height * 4) {
  return { width, height, pixels: new Uint8ClampedArray(byteLength) };
}

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

describe("raw stream frames", () => {
  it("accepts a frame whose pixels match its dimensions", () => {
    expect(isUsableFrame(rawFrame(1920, 1080))).toBe(true);
  });

  it("rejects a short buffer instead of handing garbage to the scanner", () => {
    expect(isUsableFrame(rawFrame(1920, 1080, 1920 * 1080 * 4 - 4))).toBe(false);
  });

  it("rejects empty, malformed and missing frames", () => {
    expect(isUsableFrame(null)).toBe(false);
    expect(isUsableFrame(rawFrame(0, 0, 0))).toBe(false);
    expect(isUsableFrame({ width: 8, height: 4 } as never)).toBe(false);
  });
});
