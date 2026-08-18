import type { NativeImage } from "electron";

import { withScope } from "../../services/logger";
import { cropRectContent, detectGameContentRect } from "../../services/rewardScannerImage";
import { recognizeRewardStripOnnx } from "../../services/rewardOcrOnnx";
import { findWeaponByLabelLine, type WeaponLabelMatch } from "../../services/rivenData";

const log = withScope("rivenScan");

// The FITS IN panel (lower-right of the reroll screen) captions the exact
// linked variant, whose disposition the card values are rendered at. Generous
// region: the panel is edge-anchored so its fractions drift with aspect ratio;
// whole-line weapon matching discards every other caption that lands inside.
const RIVEN_FITS_IN_CROP = { x: 0.7, y: 0.55, width: 0.3, height: 0.45 };

// Label text is ~20px at 1080p; the strip reader's row-height windows assume
// that scale, so the crop is normalized to it before recognition.
const REFERENCE_CONTENT_HEIGHT = 1080;

export type RivenWeaponSource = "" | "dialog" | "ocr" | "diorama" | "label";

/** Whether a fits-in label read replaces the currently detected weapon. The
 * label is the live linked variant, so within a family it always wins; across
 * families only an exact read outranks a fuzzy card-title guess. */
export function shouldApplyLabelWeapon(
  match: WeaponLabelMatch,
  currentName: string,
  currentSource: RivenWeaponSource,
  sameFamily: boolean,
): boolean {
  if (!currentName || currentName === "Riven") return true;
  if (match.name === currentName) return false;
  if (sameFamily) return true;
  return match.exact && currentSource === "ocr";
}

export async function readWeaponLabelFromPanelPng(
  png: Buffer,
  contentHeight: number,
): Promise<WeaponLabelMatch | null> {
  let normalized = png;
  const scale = REFERENCE_CONTENT_HEIGHT / Math.max(1, contentHeight);
  if (scale < 0.98 || scale > 1.02) {
    const sharp = require("sharp") as (typeof import("sharp"))["default"];
    const meta = await sharp(png).metadata();
    const height = Math.max(1, Math.round((meta.height ?? 1) * scale));
    normalized = await sharp(png).resize({ height, kernel: "lanczos3" }).png().toBuffer();
  }

  const read = await recognizeRewardStripOnnx(normalized);
  if (!read || read.rows.length === 0) {
    log.info("[RivenScan] fits-in label: no legible rows");
    return null;
  }
  const match = findWeaponByLabelLine(read.rows.map((row) => row.text));
  const rowsLog = read.rows.map((row) => `"${row.text}"`).join(", ");
  log.info(
    `[RivenScan] fits-in label rows: ${rowsLog} -> ` +
      (match ? `${match.name}${match.exact ? "" : " (fuzzy)"}` : "no weapon"),
  );
  return match;
}

/** Reads the linked weapon variant off the FITS IN panel of a full capture. */
export async function readFitsInWeapon(image: NativeImage): Promise<WeaponLabelMatch | null> {
  const content = detectGameContentRect(image);
  const crop = cropRectContent(image, RIVEN_FITS_IN_CROP, content);
  const { width, height } = crop.getSize();
  if (width < 48 || height < 48) return null;
  return readWeaponLabelFromPanelPng(crop.toPNG(), content.height);
}
