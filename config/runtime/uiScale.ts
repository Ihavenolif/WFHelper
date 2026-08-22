import { clampNumber } from "../shared/numeric";

/** Bounds for the user's UI scale override, matching the overlay scale range. */
export const UI_SCALE_MIN = 0.75;
export const UI_SCALE_MAX = 1.5;
export const UI_SCALE_STEP = 0.05;

interface DisplayWorkArea {
  width?: unknown;
  height?: unknown;
}

// workArea sizes are device-independent px, so this composes with Windows DPI
// scaling. The shorter edge stands in for display size because it is the same
// number whichever way the panel is rotated; height alone reads a portrait
// 1080p monitor as a 4K one and zooms the whole UI a third too large.
export function baseZoomForDisplay(workArea: DisplayWorkArea | null | undefined): number {
  const width = Number(workArea?.width);
  const height = Number(workArea?.height);
  const edges = [width, height].filter((edge) => Number.isFinite(edge) && edge > 0);
  if (edges.length === 0) return 1;
  const shortest = Math.min(...edges);
  if (shortest <= 720) return 0.8;
  if (shortest <= 900) return 0.9;
  if (shortest <= 1200) return 1;
  if (shortest <= 1600) return 1.15;
  return 1.3;
}

/** Display-derived base zoom times the user's override, clamped and rounded. */
export function computeUiZoomFactor(
  workArea: DisplayWorkArea | null | undefined,
  userScale: unknown,
): number {
  const scale = clampNumber(userScale, UI_SCALE_MIN, UI_SCALE_MAX, 1);
  return Number((baseZoomForDisplay(workArea) * scale).toFixed(3));
}
