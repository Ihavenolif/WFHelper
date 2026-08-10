// Compatibility scan for PCs where Sainan's helper rejects a valid singleton.
import { scanBufferForAuthz, bestAuthz } from "./gameMemoryAuthz";
import { withScope } from "./logger";

const log = withScope("gameMemoryWin");

// Keep the fallback optional on unsupported systems.
let _koffi: typeof import("koffi") | null = null;
function koffi(): typeof import("koffi") {
  if (!_koffi) _koffi = require("koffi") as typeof import("koffi");
  return _koffi;
}

let _api: Win32 | null = null;
let _apiFailed = false;

// koffi's KoffiFunction type is not exported; a callable with `.async` is all
// we need. `.async` appends a Node-style callback and runs off the main thread.
type NativeFn = ((...args: unknown[]) => unknown) & {
  async: (...args: unknown[]) => void;
};

interface Win32 {
  OpenProcess: NativeFn;
  CloseHandle: NativeFn;
  GetLastError: NativeFn;
  VirtualQueryEx: NativeFn;
  ReadProcessMemory: NativeFn;
  EnumProcesses: NativeFn;
  QueryFullProcessImageNameW: NativeFn;
}

function loadApi(): Win32 | null {
  if (_api) return _api;
  if (_apiFailed) return null;
  try {
    const k = koffi();
    const kernel32 = k.load("kernel32.dll");
    const psapi = k.load("psapi.dll");
    _api = {
      // Win32 BOOL is a 4-byte int; koffi's "bool" is 1 byte and leaves garbage
      // in the upper bytes, so always declare BOOL params/returns as int32.
      OpenProcess: kernel32.func("OpenProcess", "void *", [
        "uint32",
        "int32",
        "uint32",
      ]) as NativeFn,
      CloseHandle: kernel32.func("CloseHandle", "int32", ["void *"]) as NativeFn,
      GetLastError: kernel32.func("GetLastError", "uint32", []) as NativeFn,
      // lpAddress/lpBaseAddress declared as uint64 so we can pass raw BigInt
      // addresses (same 8-byte ABI as a pointer) instead of pointer objects.
      VirtualQueryEx: kernel32.func("VirtualQueryEx", "size_t", [
        "void *",
        "uint64",
        "void *",
        "size_t",
      ]) as NativeFn,
      ReadProcessMemory: kernel32.func("ReadProcessMemory", "int32", [
        "void *",
        "uint64",
        "void *",
        "size_t",
        "void *",
      ]) as NativeFn,
      EnumProcesses: psapi.func("EnumProcesses", "int32", [
        "void *",
        "uint32",
        "void *",
      ]) as NativeFn,
      QueryFullProcessImageNameW: kernel32.func("QueryFullProcessImageNameW", "int32", [
        "void *",
        "uint32",
        "void *",
        "void *",
      ]) as NativeFn,
    };
    return _api;
  } catch (err) {
    _apiFailed = true;
    log.warn("koffi load failed - native memory scan unavailable:", errMsg(err));
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_VM_READ = 0x0010;
const MEM_COMMIT = 0x1000;
const PAGE_NOACCESS = 0x01;
const PAGE_EXECUTE = 0x10;
const PAGE_GUARD = 0x100;
const MAX_PATH = 260;
// x64 MEMORY_BASIC_INFORMATION is 48 bytes; fields we read: BaseAddress@0,
// RegionSize@24, State@32, Protect@36 (all little-endian).
const MBI_SIZE = 48;
const USER_ADDRESS_CEILING = 0x7fffffff0000n;
const CHUNK = 4 * 1024 * 1024;
// Keep auth strings intact across chunk boundaries.
const OVERLAP = 256;
// Bound a corrupted or unexpected address-space walk.
const MAX_SCAN_BYTES = 8n * 1024n * 1024n * 1024n;

interface AuthzResult {
  authz: string | null;
  reason: string;
}

const _pidsBuf = Buffer.alloc(4096); // up to 1024 DWORD pids
const _pidsUsedBuf = Buffer.alloc(4);
const _exeNameBuf = Buffer.alloc(MAX_PATH * 2);
const _exeNameSizeBuf = Buffer.alloc(4);

function exePathOfPid(api: Win32, pid: number): string | null {
  const hProc = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!hProc) return null;
  _exeNameSizeBuf.writeUInt32LE(MAX_PATH, 0);
  const ok =
    (api.QueryFullProcessImageNameW(hProc, 0, _exeNameBuf, _exeNameSizeBuf) as number) !== 0;
  api.CloseHandle(hProc);
  if (!ok) return null;
  const chars = _exeNameSizeBuf.readUInt32LE(0);
  return _exeNameBuf.subarray(0, chars * 2).toString("utf16le");
}

function findWarframePid(api: Win32): number | null {
  _pidsUsedBuf.fill(0);
  if ((api.EnumProcesses(_pidsBuf, _pidsBuf.length, _pidsUsedBuf) as number) === 0) return null;
  const count = _pidsUsedBuf.readUInt32LE(0) >>> 2;
  for (let i = 0; i < count; i++) {
    const pid = _pidsBuf.readUInt32LE(i * 4);
    if (pid === 0) continue;
    const p = exePathOfPid(api, pid);
    if (p && p.toLowerCase().endsWith("\\warframe.x64.exe")) return pid;
  }
  return null;
}

function isReadableRegion(state: number, protect: number): boolean {
  if (state !== MEM_COMMIT) return false;
  if (protect & PAGE_GUARD) return false;
  if (protect === PAGE_NOACCESS || protect === PAGE_EXECUTE) return false;
  return true;
}

// Avoid blocking Electron while scanning large readable regions.
function readMemory(
  api: Win32,
  hProc: unknown,
  addr: bigint,
  out: Buffer,
  len: number,
  bytesReadBuf: Buffer,
): Promise<number> {
  return new Promise((resolve) => {
    bytesReadBuf.fill(0);
    api.ReadProcessMemory.async(
      hProc,
      addr,
      out,
      len,
      bytesReadBuf,
      (err: Error | null, ok: number) => {
        if (err || ok === 0) return resolve(0);
        resolve(Number(bytesReadBuf.readBigUInt64LE(0)));
      },
    );
  });
}

export async function readGameAuthzWin(): Promise<AuthzResult> {
  const api = loadApi();
  if (!api) return { authz: null, reason: "mem-open-noapi" };

  const pid = findWarframePid(api);
  if (!pid) return { authz: null, reason: "process-not-found" };

  const hProc = api.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid) as unknown;
  if (!hProc) {
    const gle = api.GetLastError() as number;
    return { authz: null, reason: `mem-open-${gle}` };
  }

  const counts = new Map<string, number>();
  const mbi = Buffer.alloc(MBI_SIZE);
  const chunk = Buffer.allocUnsafe(CHUNK);
  const bytesReadBuf = Buffer.alloc(8);
  let scanned = 0n;
  let iterations = 0;

  try {
    let addr = 0n;
    while (addr < USER_ADDRESS_CEILING && scanned < MAX_SCAN_BYTES) {
      const written = api.VirtualQueryEx(hProc, addr, mbi, MBI_SIZE) as number;
      if (written === 0) break; // end of address space or query failed

      const base = mbi.readBigUInt64LE(0);
      const regionSize = mbi.readBigUInt64LE(24);
      const state = mbi.readUInt32LE(32);
      const protect = mbi.readUInt32LE(36);
      const nextAddr = base + regionSize;
      if (regionSize === 0n || nextAddr <= addr) break; // no forward progress

      if (isReadableRegion(state, protect)) {
        let off = 0n;
        while (off < regionSize && scanned < MAX_SCAN_BYTES) {
          const remaining = regionSize - off;
          const len = remaining < BigInt(CHUNK) ? Number(remaining) : CHUNK;
          const n = await readMemory(api, hProc, base + off, chunk, len, bytesReadBuf);
          if (n > 0) {
            scanBufferForAuthz(chunk.subarray(0, n), counts);
            scanned += BigInt(n);
          }
          if (len <= OVERLAP) break;
          off += BigInt(len - OVERLAP);
          // Yield to the event loop periodically so the UI stays responsive.
          if (++iterations % 16 === 0) await new Promise((r) => setImmediate(r));
        }
      }
      addr = nextAddr;
    }
  } finally {
    api.CloseHandle(hProc);
  }

  if (counts.size === 0) return { authz: null, reason: "crumbs-not-found" };
  const { authz, hits } = bestAuthz(counts);
  if (counts.size > 1) {
    log.warn(`Multiple distinct auth matches (${counts.size}) - using the most frequent`);
  }
  return { authz, reason: `ok-${hits}x` };
}
