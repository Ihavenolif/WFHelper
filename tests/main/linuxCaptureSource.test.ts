import { describe, expect, it } from "vitest";
import { __test__ } from "../../services/linuxStreamCapture";

const { pickCaptureSource, isUsableFrame, isBlankFrame, shouldDropBlankStream } = __test__;

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

  it("flags uniform frames as blank, keeps frames with contrast", () => {
    const black = rawFrame(320, 180);
    expect(isBlankFrame(black)).toBe(true);

    const gray = rawFrame(320, 180);
    gray.pixels.fill(120);
    expect(isBlankFrame(gray)).toBe(true);

    const contentful = rawFrame(320, 180);
    contentful.pixels.fill(230, contentful.pixels.length / 2);
    expect(isBlankFrame(contentful)).toBe(false);
  });

  it("drops a stream blank from its first frame but never one that showed content", () => {
    expect(shouldDropBlankStream(1, false)).toBe(false);
    expect(shouldDropBlankStream(3, false)).toBe(true);

    // A loading screen after real frames must not cost a portal re-prompt.
    expect(shouldDropBlankStream(3, true)).toBe(false);
    expect(shouldDropBlankStream(999, true)).toBe(false);
  });
});
