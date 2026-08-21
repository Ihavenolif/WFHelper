/** One home for the OpenProcess -> QueryFullProcessImageNameW dance. It was
 * hand-copied into four modules, and a wrong koffi signature kills Electron
 * silently instead of throwing. */

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const MAX_PATH = 260;
const PROCESS_SCAN_BUFFER_BYTES = 16_384;

const WARFRAME_EXE_SUFFIX = "\\warframe.x64.exe";

// Lazy so the module still loads where koffi is missing or irrelevant.
let _koffi: typeof import("koffi") | null = null;
function koffi(): typeof import("koffi") {
  if (!_koffi) _koffi = require("koffi") as typeof import("koffi");
  return _koffi;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- native FFI bindings */
type NativeFn = (...args: any[]) => any;
/* eslint-enable @typescript-eslint/no-explicit-any */

let _api: {
  OpenProcess: NativeFn;
  CloseHandle: NativeFn;
  QueryFullProcessImageNameW: NativeFn;
  EnumProcesses: NativeFn;
} | null = null;
let _apiFailed = false;

function api(): typeof _api {
  if (_api) return _api;
  // Guard before koffi: the callers this replaced all checked the platform
  // first, so nothing off Windows ever tried to load kernel32.
  if (_apiFailed || process.platform !== "win32") return null;
  try {
    const k = koffi();
    const kernel32 = k.load("kernel32.dll");
    const psapi = k.load("psapi.dll");
    _api = {
      OpenProcess: kernel32.func("OpenProcess", "void *", ["uint32", "int32", "uint32"]),
      CloseHandle: kernel32.func("CloseHandle", "int32", ["void *"]),
      QueryFullProcessImageNameW: kernel32.func("QueryFullProcessImageNameW", "int32", [
        "void *",
        "uint32",
        "void *",
        "void *",
      ]),
      EnumProcesses: psapi.func("EnumProcesses", "int32", ["void *", "uint32", "void *"]),
    };
    return _api;
  } catch {
    _apiFailed = true;
    return null;
  }
}

const _exeNameBuf = Buffer.alloc(MAX_PATH * 2);
const _exeNameSizeBuf = Buffer.alloc(4);
const _pidsBuf = Buffer.alloc(PROCESS_SCAN_BUFFER_BYTES);
const _pidsUsedBuf = Buffer.alloc(4);

/** Callers cache these differently, so the two failures stay distinguishable:
 * a process that is gone may be Warframe next time, one that refuses to
 * answer will refuse again. */
type ExePathResult =
  | { status: "ok"; path: string }
  | { status: "unreachable" }
  | { status: "unknown" };

export function queryExePath(pid: number): ExePathResult {
  const win32 = api();
  if (!win32 || pid <= 0) return { status: "unreachable" };

  const handle = win32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!handle) return { status: "unreachable" };

  try {
    _exeNameSizeBuf.writeUInt32LE(MAX_PATH, 0);
    const ok =
      (win32.QueryFullProcessImageNameW(handle, 0, _exeNameBuf, _exeNameSizeBuf) as number) !== 0;
    if (!ok) return { status: "unknown" };
    const charCount = _exeNameSizeBuf.readUInt32LE(0);
    return { status: "ok", path: _exeNameBuf.subarray(0, charCount * 2).toString("utf16le") };
  } finally {
    win32.CloseHandle(handle);
  }
}

export function exePathOfPid(pid: number): string | null {
  const result = queryExePath(pid);
  return result.status === "ok" ? result.path : null;
}

export function isWarframeExePath(exePath: string | null | undefined): boolean {
  return typeof exePath === "string" && exePath.toLowerCase().endsWith(WARFRAME_EXE_SUFFIX);
}

export function enumProcessIds(): number[] {
  const win32 = api();
  if (!win32) return [];
  if ((win32.EnumProcesses(_pidsBuf, _pidsBuf.length, _pidsUsedBuf) as number) === 0) return [];
  const count = _pidsUsedBuf.readUInt32LE(0) >>> 2;
  const pids: number[] = [];
  for (let i = 0; i < count; i++) {
    const pid = _pidsBuf.readUInt32LE(i * 4);
    if (pid > 0) pids.push(pid);
  }
  return pids;
}
