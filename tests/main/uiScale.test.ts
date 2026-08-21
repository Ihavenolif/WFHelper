import { describe, expect, it } from "vitest";
import {
  baseZoomForDisplay,
  computeUiZoomFactor,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
} from "../../config/runtime/uiScale";

const landscape = (width: number, height: number) => ({ width, height });
const portrait = (width: number, height: number) => ({ width: height, height: width });

describe("baseZoomForDisplay", () => {
  it("scales up on larger displays and down on small ones", () => {
    expect(baseZoomForDisplay(landscape(1280, 720))).toBe(0.8);
    expect(baseZoomForDisplay(landscape(1600, 900))).toBe(0.9);
    expect(baseZoomForDisplay(landscape(1920, 1080))).toBe(1);
    expect(baseZoomForDisplay(landscape(2560, 1440))).toBe(1.15);
    expect(baseZoomForDisplay(landscape(3840, 2160))).toBe(1.3);
  });

  // A rotated panel is the same monitor, so it has to land on the same zoom.
  // Reading height alone called a portrait 1080p screen 4K and zoomed to 1.3.
  it("reads a rotated display the same as its landscape self", () => {
    expect(baseZoomForDisplay(portrait(1920, 1080))).toBe(1);
    expect(baseZoomForDisplay(portrait(2560, 1440))).toBe(1.15);
    expect(baseZoomForDisplay(portrait(3840, 2160))).toBe(1.3);
  });

  it("falls back to 1 when the work area is unusable", () => {
    expect(baseZoomForDisplay({ width: 0, height: 0 })).toBe(1);
    expect(baseZoomForDisplay({ width: Number.NaN, height: Number.NaN })).toBe(1);
    expect(baseZoomForDisplay(undefined)).toBe(1);
  });

  it("uses the one usable edge when the other is missing", () => {
    expect(baseZoomForDisplay({ height: 1080 })).toBe(1);
    expect(baseZoomForDisplay({ width: 1440 })).toBe(1.15);
  });
});

describe("computeUiZoomFactor", () => {
  it("multiplies the display base by the user override", () => {
    expect(computeUiZoomFactor(landscape(1920, 1080), 1)).toBe(1);
    expect(computeUiZoomFactor(landscape(2560, 1440), 1)).toBe(1.15);
    expect(computeUiZoomFactor(landscape(1920, 1080), 1.25)).toBe(1.25);
  });

  it("clamps the override to the supported range", () => {
    expect(computeUiZoomFactor(landscape(1920, 1080), 99)).toBe(UI_SCALE_MAX);
    expect(computeUiZoomFactor(landscape(1920, 1080), 0.1)).toBe(UI_SCALE_MIN);
    expect(computeUiZoomFactor(landscape(1920, 1080), "nonsense")).toBe(1);
  });
});
