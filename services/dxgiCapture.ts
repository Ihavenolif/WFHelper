/** BitBlt captures final display output after MPO and DWM composition. */

import { withScope } from "./logger";

const log = withScope("gdiCapture");

// koffi imports - resolved lazily so module loads even if koffi is missing
let _koffi: typeof import("koffi") | null = null;

function koffi(): typeof import("koffi") {
  if (!_koffi) _koffi = require("koffi") as typeof import("koffi");
  return _koffi;
}

interface GdiCaptureResult {
  /** BGRA pixel buffer (compatible with Electron nativeImage.createFromBitmap) */
  buffer: Buffer;
  width: number;
  height: number;
  /** Electron display.id for the captured output, or "" if unknown */
  displayId: string;
  /** Virtual-screen coords of the captured area's top-left (for mapping window rects). */
  originX: number;
  originY: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- native FFI bindings, return types unknown at compile time */
let _gdiFns: {
  GetDC: (...args: any[]) => any;
  ReleaseDC: (...args: any[]) => any;
  GetSystemMetrics: (...args: any[]) => any;
  FindWindowW: (...args: any[]) => any;
  IsIconic: (...args: any[]) => any;
  GetClientRect: (...args: any[]) => any;
  ClientToScreen: (...args: any[]) => any;
  CreateCompatibleDC: (...args: any[]) => any;
  CreateCompatibleBitmap: (...args: any[]) => any;
  SelectObject: (...args: any[]) => any;
  BitBlt: (...args: any[]) => any;
  GetDIBits: (...args: any[]) => any;
  DeleteObject: (...args: any[]) => any;
  DeleteDC: (...args: any[]) => any;
} | null = null;
/* eslint-enable @typescript-eslint/no-explicit-any */
let _gdiInitFailed = false;

function ensureGdi(): boolean {
  if (_gdiFns) return true;
  if (_gdiInitFailed) return false;
  try {
    const k = koffi();
    const u32 = k.load("user32.dll");
    const g32 = k.load("gdi32.dll");
    _gdiFns = {
      GetDC: u32.func("__stdcall", "GetDC", "void*", ["void*"]),
      ReleaseDC: u32.func("__stdcall", "ReleaseDC", "int32", ["void*", "void*"]),
      GetSystemMetrics: u32.func("__stdcall", "GetSystemMetrics", "int32", ["int32"]),
      FindWindowW: u32.func("__stdcall", "FindWindowW", "void*", ["str16", "str16"]),
      IsIconic: u32.func("__stdcall", "IsIconic", "int32", ["void*"]),
      GetClientRect: u32.func("__stdcall", "GetClientRect", "int32", ["void*", "void*"]),
      ClientToScreen: u32.func("__stdcall", "ClientToScreen", "int32", ["void*", "void*"]),
      CreateCompatibleDC: g32.func("__stdcall", "CreateCompatibleDC", "void*", ["void*"]),
      CreateCompatibleBitmap: g32.func("__stdcall", "CreateCompatibleBitmap", "void*", [
        "void*",
        "int32",
        "int32",
      ]),
      SelectObject: g32.func("__stdcall", "SelectObject", "void*", ["void*", "void*"]),
      BitBlt: g32.func("__stdcall", "BitBlt", "int32", [
        "void*",
        "int32",
        "int32",
        "int32",
        "int32",
        "void*",
        "int32",
        "int32",
        "uint32",
      ]),
      GetDIBits: g32.func("__stdcall", "GetDIBits", "int32", [
        "void*",
        "void*",
        "uint32",
        "uint32",
        "void*",
        "void*",
        "uint32",
      ]),
      DeleteObject: g32.func("__stdcall", "DeleteObject", "int32", ["void*"]),
      DeleteDC: g32.func("__stdcall", "DeleteDC", "int32", ["void*"]),
    };
    return true;
  } catch (err) {
    log.warn("[gdiCapture] GDI init failed:", String(err));
    _gdiInitFailed = true;
    return false;
  }
}

/** Virtual-screen pixel bounds of the monitor to capture, with the Electron
 * display id the caller wants carried through to the result. */
export interface GdiCaptureTarget {
  displayId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GameWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Return the usable Warframe client rect in virtual-screen coordinates.
 * Fullscreen matches the monitor; windowed mode excludes window chrome. */
export function getGameWindowClientRect(): GameWindowRect | null {
  if (process.platform !== "win32") return null;
  if (!ensureGdi()) return null;
  const g = _gdiFns!;
  try {
    const hwnd = g.FindWindowW(null, "Warframe");
    if (!hwnd) return null;
    if (g.IsIconic(hwnd)) return null;
    const rc = Buffer.alloc(16); // RECT
    if (!g.GetClientRect(hwnd, rc)) return null;
    const width = rc.readInt32LE(8);
    const height = rc.readInt32LE(12);
    if (width < 320 || height < 240) return null;
    const pt = Buffer.alloc(8); // POINT {0,0} -> screen coords of client origin
    if (!g.ClientToScreen(hwnd, pt)) return null;
    return { x: pt.readInt32LE(0), y: pt.readInt32LE(4), width, height };
  } catch (err) {
    log.warn("[gdiCapture] game window rect lookup failed:", String(err));
    return null;
  }
}

export function captureGdi(target?: GdiCaptureTarget | null): GdiCaptureResult | null {
  if (process.platform !== "win32") return null;
  if (!ensureGdi()) return null;
  const g = _gdiFns!;

  let cx = target?.x ?? 0;
  let cy = target?.y ?? 0;
  let cw = target?.width ?? 0;
  let ch = target?.height ?? 0;
  let resolvedDisplayId = cw > 0 && ch > 0 ? target!.displayId : "";

  // Fallback to primary screen metrics
  if (cw <= 0 || ch <= 0) {
    cw = g.GetSystemMetrics(0); // SM_CXSCREEN
    ch = g.GetSystemMetrics(1); // SM_CYSCREEN
    cx = 0;
    cy = 0;
  }
  if (cw <= 0 || ch <= 0) return null;

  const hdcScreen = g.GetDC(null);
  if (!hdcScreen) return null;

  let hdcMem: unknown = null;
  let hBitmap: unknown = null;
  let hOld: unknown = null;

  try {
    hdcMem = g.CreateCompatibleDC(hdcScreen);
    if (!hdcMem) return null;

    hBitmap = g.CreateCompatibleBitmap(hdcScreen, cw, ch);
    if (!hBitmap) return null;

    hOld = g.SelectObject(hdcMem, hBitmap);

    // SRCCOPY = 0x00CC0020
    if (!g.BitBlt(hdcMem, 0, 0, cw, ch, hdcScreen, cx, cy, 0x00cc0020)) return null;

    g.SelectObject(hdcMem, hOld);
    hOld = null;

    // BITMAPINFOHEADER (40 bytes): top-down 32-bit BGRA
    const bmi = Buffer.alloc(40);
    bmi.writeUInt32LE(40, 0); // biSize
    bmi.writeInt32LE(cw, 4); // biWidth
    bmi.writeInt32LE(-ch, 8); // biHeight (negative -> top-down)
    bmi.writeUInt16LE(1, 12); // biPlanes
    bmi.writeUInt16LE(32, 14); // biBitCount
    // biCompression = BI_RGB (0), rest zero

    const pixels = Buffer.alloc(cw * ch * 4);
    const lines = g.GetDIBits(hdcScreen, hBitmap, 0, ch, pixels, bmi, 0);
    if (lines <= 0) return null;

    return {
      buffer: pixels,
      width: cw,
      height: ch,
      displayId: resolvedDisplayId,
      originX: cx,
      originY: cy,
    };
  } finally {
    if (hOld && hdcMem) g.SelectObject(hdcMem, hOld);
    if (hBitmap) g.DeleteObject(hBitmap);
    if (hdcMem) g.DeleteDC(hdcMem);
    g.ReleaseDC(null, hdcScreen);
  }
}
