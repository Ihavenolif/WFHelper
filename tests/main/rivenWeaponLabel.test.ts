import { beforeEach, describe, expect, it, vi } from "vitest";

const recognizeMock = vi.fn();
vi.mock("../../services/rewardOcrOnnx", () => ({
  recognizeRewardStripOnnx: (png: Buffer) => recognizeMock(png),
}));

import { findWeaponByLabelLine } from "../../services/rivenData";
import {
  readWeaponLabelFromPanelPng,
  shouldApplyLabelWeapon,
} from "../../ipc/overlay/rivenWeaponLabel";

function rows(...texts: string[]) {
  return {
    text: texts.join(" "),
    rows: texts.map((text) => ({ text, confidence: 0.95 })),
  };
}

describe("findWeaponByLabelLine", () => {
  it("matches the linked variant among the panel captions", () => {
    const match = findWeaponByLabelLine(["FITS IN", "Kuva Sobek", "SHOW RANKED", "CANCEL"]);
    expect(match).toEqual({ name: "Kuva Sobek", exact: true });
  });

  it("is case-insensitive and matches variant families", () => {
    expect(findWeaponByLabelLine(["KUVA SOBEK"])).toEqual({ name: "Kuva Sobek", exact: true });
    expect(findWeaponByLabelLine(["Boar Prime"])).toEqual({ name: "Boar Prime", exact: true });
    expect(findWeaponByLabelLine(["Sobek"])).toEqual({ name: "Sobek", exact: true });
    expect(findWeaponByLabelLine(["MK1-Braton"])).toEqual({ name: "MK1-Braton", exact: true });
  });

  it("tolerates one misread letter on long names only", () => {
    expect(findWeaponByLabelLine(["Kuva Sobck"])).toEqual({ name: "Kuva Sobek", exact: false });
    // Short names must be exact - "Lat0" could be too many things.
    expect(findWeaponByLabelLine(["Lat0"])).toBeNull();
  });

  it("prefers the longest exact hit", () => {
    expect(findWeaponByLabelLine(["Boar", "Boar Prime"])).toEqual({
      name: "Boar Prime",
      exact: true,
    });
  });

  it("never matches the other panel captions or stat lines", () => {
    expect(
      findWeaponByLabelLine(["FITS IN", "SHOW RANKED", "CANCEL", "Remaining Kuva 89528"]),
    ).toBeNull();
    expect(findWeaponByLabelLine(["+72,7% Fire Rate (x2 for Bows)"])).toBeNull();
    expect(findWeaponByLabelLine([])).toBeNull();
  });
});

describe("shouldApplyLabelWeapon", () => {
  const exact = { name: "Kuva Sobek", exact: true };
  const fuzzy = { name: "Kuva Sobek", exact: false };

  it("fills an unknown weapon", () => {
    expect(shouldApplyLabelWeapon(exact, "", "", false)).toBe(true);
    expect(shouldApplyLabelWeapon(fuzzy, "Riven", "", false)).toBe(true);
  });

  it("is a no-op for the same name", () => {
    expect(shouldApplyLabelWeapon(exact, "Kuva Sobek", "diorama", true)).toBe(false);
  });

  it("always wins within the family - the label is the live linked variant", () => {
    expect(
      shouldApplyLabelWeapon({ name: "Boar", exact: true }, "Boar Prime", "diorama", true),
    ).toBe(true);
    expect(
      shouldApplyLabelWeapon({ name: "Boar", exact: false }, "Boar Prime", "label", true),
    ).toBe(true);
  });

  it("across families only an exact read outranks a fuzzy OCR-title guess", () => {
    expect(shouldApplyLabelWeapon(exact, "Hema", "ocr", false)).toBe(true);
    expect(shouldApplyLabelWeapon(fuzzy, "Hema", "ocr", false)).toBe(false);
    expect(shouldApplyLabelWeapon(exact, "Hema", "diorama", false)).toBe(false);
    expect(shouldApplyLabelWeapon(exact, "Hema", "dialog", false)).toBe(false);
  });
});

describe("readWeaponLabelFromPanelPng", () => {
  beforeEach(() => {
    recognizeMock.mockReset();
  });

  async function makePng(width: number, height: number): Promise<Buffer> {
    const sharp = (await import("sharp")).default;
    return sharp({
      create: { width, height, channels: 3, background: { r: 10, g: 10, b: 18 } },
    })
      .png()
      .toBuffer();
  }

  it("passes a 1080p crop through unresized and matches the label", async () => {
    const png = await makePng(576, 486);
    recognizeMock.mockResolvedValue(rows("FITS IN", "Kuva Sobek", "CANCEL"));

    const match = await readWeaponLabelFromPanelPng(png, 1080);
    expect(match).toEqual({ name: "Kuva Sobek", exact: true });
    expect(recognizeMock).toHaveBeenCalledTimes(1);
    expect(recognizeMock.mock.calls[0][0]).toBe(png);
  });

  it("normalizes other resolutions to the 1080p reference scale", async () => {
    const png = await makePng(768, 648);
    recognizeMock.mockResolvedValue(rows("Boar Prime"));

    const match = await readWeaponLabelFromPanelPng(png, 1440);
    expect(match).toEqual({ name: "Boar Prime", exact: true });

    const sharp = (await import("sharp")).default;
    const sent = recognizeMock.mock.calls[0][0] as Buffer;
    const meta = await sharp(sent).metadata();
    expect(meta.height).toBe(486); // 648 * (1080 / 1440)
  });

  it("returns null when nothing legible or no caption is a weapon", async () => {
    const png = await makePng(576, 486);
    recognizeMock.mockResolvedValueOnce(null);
    expect(await readWeaponLabelFromPanelPng(png, 1080)).toBeNull();

    recognizeMock.mockResolvedValueOnce(rows("FITS IN", "SHOW RANKED", "CANCEL"));
    expect(await readWeaponLabelFromPanelPng(png, 1080)).toBeNull();
  });
});
