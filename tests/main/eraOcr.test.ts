import { describe, expect, it, vi } from "vitest";

import { createEraOcr } from "../../services/rewardScannerOcr";

const PNG = Buffer.from("png");

function deps(overrides: Partial<Parameters<typeof createEraOcr>[0]> = {}) {
  return {
    runOCR: vi.fn(async () => "windows file text"),
    runOCRBuffer: vi.fn(async () => "windows buffer text"),
    recognizeStrip: vi.fn(async () => ({ text: "paddle text" })),
    stripAvailable: () => true,
    readFile: vi.fn(() => PNG),
    ...overrides,
  };
}

describe("createEraOcr", () => {
  it("uses Windows OCR when it works", async () => {
    const d = deps();
    const ocr = createEraOcr({ ...d, isWindows: true });
    await expect(ocr.runOCRBuffer(PNG, 1000)).resolves.toBe("windows buffer text");
    expect(d.recognizeStrip).not.toHaveBeenCalled();
  });

  it("falls back to paddle when Windows OCR throws", async () => {
    const d = deps({ runOCRBuffer: vi.fn(async () => Promise.reject(new Error("no pack"))) });
    const ocr = createEraOcr({ ...d, isWindows: true });
    await expect(ocr.runOCRBuffer(PNG, 1000)).resolves.toBe("paddle text");
  });

  it("rethrows the Windows error when paddle is unavailable", async () => {
    const d = deps({
      runOCRBuffer: vi.fn(async () => Promise.reject(new Error("no pack"))),
      stripAvailable: () => false,
    });
    const ocr = createEraOcr({ ...d, isWindows: true });
    await expect(ocr.runOCRBuffer(PNG, 1000)).rejects.toThrow("no pack");
  });

  it("goes straight to paddle off-Windows", async () => {
    const d = deps();
    const ocr = createEraOcr({ ...d, isWindows: false });
    await expect(ocr.runOCRBuffer(PNG, 1000)).resolves.toBe("paddle text");
    expect(d.runOCRBuffer).not.toHaveBeenCalled();
  });

  it("throws off-Windows when paddle is unavailable", async () => {
    const d = deps({ stripAvailable: () => false });
    const ocr = createEraOcr({ ...d, isWindows: false });
    await expect(ocr.runOCRBuffer(PNG, 1000)).rejects.toThrow(/No OCR engine/);
  });

  it("resolves empty when paddle exceeds the timeout", async () => {
    const d = deps({
      recognizeStrip: vi.fn(() => new Promise<{ text: string } | null>(() => {})),
    });
    const ocr = createEraOcr({ ...d, isWindows: false });
    await expect(ocr.runOCRBuffer(PNG, 25)).resolves.toBe("");
  });

  it("file variant reads the image for the paddle path", async () => {
    const d = deps();
    const ocr = createEraOcr({ ...d, isWindows: false });
    await expect(ocr.runOCR("C:/tmp/era.png", 1000)).resolves.toBe("paddle text");
    expect(d.readFile).toHaveBeenCalledWith("C:/tmp/era.png");
    expect(d.recognizeStrip).toHaveBeenCalledWith(PNG);
  });

  it("treats a null paddle read as empty text", async () => {
    const d = deps({ recognizeStrip: vi.fn(async () => null) });
    const ocr = createEraOcr({ ...d, isWindows: false });
    await expect(ocr.runOCRBuffer(PNG, 1000)).resolves.toBe("");
  });
});
