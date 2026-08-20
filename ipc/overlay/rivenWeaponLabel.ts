import type { NativeImage } from "electron";

import { withScope } from "../../services/logger";
import { cropRectContent } from "../../services/rewardScannerImage";
import { recognizeRewardStripOnnx } from "../../services/rewardOcrOnnx";
import { findWeaponByLabelLine, type WeaponLabelMatch } from "../../services/rivenData";
import type { CaptureResult } from "../../services/screenCapture";
import { rivenContentRect } from "./rivenScanImage";

const log = withScope("rivenScan");

// The FITS IN caption (lower-right of the reroll screen) names the variant the
// riven is linked to, i.e. the disposition in use. Generous crop: the panel is
// edge-anchored, so its fractions drift with aspect ratio.
const RIVEN_FITS_IN_CROP = { x: 0.7, y: 0.55, width: 0.3, height: 0.45 };

// Label text is ~20px at 1080p; the strip reader's row-height windows assume
// that scale, so the crop is normalized to it before recognition.
const REFERENCE_CONTENT_HEIGHT = 1080;

export type RivenWeaponSource = "" | "dialog" | "ocr" | "diorama" | "label";

/** Whether a fits-in label read replaces the currently detected weapon. An
 * exact read outranks every other source; a fuzzy one is a guess, and only
 * wins inside the family or over card-title OCR. */
export function shouldApplyLabelWeapon(
  match: WeaponLabelMatch,
  currentName: string,
  currentSource: RivenWeaponSource,
  sameFamily: boolean,
): boolean {
  if (!currentName || currentName === "Riven") return true;
  if (match.name === currentName) return false;
  if (match.exact || sameFamily) return true;
  return currentSource === "ocr";
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
export async function readFitsInWeapon(
  image: NativeImage,
  sourceType?: CaptureResult["sourceType"],
): Promise<WeaponLabelMatch | null> {
  const content = rivenContentRect(image, sourceType);
  const crop = cropRectContent(image, RIVEN_FITS_IN_CROP, content);
  const { width, height } = crop.getSize();
  if (width < 48 || height < 48) return null;
  return readWeaponLabelFromPanelPng(crop.toPNG(), content.height);
}
