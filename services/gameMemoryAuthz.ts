// Proton often keeps fewer than Sainan's three copies, so accept a unique leading match.
import fs from "node:fs";

import { withScope } from "./logger";

const log = withScope("gameMemory");

const ACCOUNT_ID_MARKERS = [Buffer.from("?accountId="), Buffer.from("&accountId=")] as const;
const CHUNK = 16 * 1024 * 1024;
// An auth string is <70 bytes; overlap chunks so a match can't split across them.
const OVERLAP = 256;
const ACCOUNT_ID_LEN = 24; // DE account ids are 24-hex Mongo ObjectIds
const NONCE_SEP = "&nonce=";
const MAX_NONCE_DIGITS = 24;

interface AuthzScanDiagnostics {
  truncated: number;
  invalidAccountId: number;
  missingNonce: number;
  emptyNonce: number;
  nonceTooLong: number;
}

type AuthzParseResult =
  | { authz: string; rejection: null }
  | { authz: null; rejection: keyof AuthzScanDiagnostics };

export function createAuthzScanDiagnostics(): AuthzScanDiagnostics {
  return {
    truncated: 0,
    invalidAccountId: 0,
    missingNonce: 0,
    emptyNonce: 0,
    nonceTooLong: 0,
  };
}

function parseAuthzCandidate(view: Buffer, at: number, markerLength: number): AuthzParseResult {
  const idStart = at + markerLength;
  const idEnd = idStart + ACCOUNT_ID_LEN;
  if (idEnd > view.length) return { authz: null, rejection: "truncated" };
  const accountId = view.toString("latin1", idStart, idEnd);
  if (!/^[0-9a-f]{24}$/i.test(accountId)) {
    return { authz: null, rejection: "invalidAccountId" };
  }
  if (idEnd + NONCE_SEP.length > view.length) {
    return { authz: null, rejection: "truncated" };
  }
  if (view.toString("latin1", idEnd, idEnd + NONCE_SEP.length) !== NONCE_SEP) {
    return { authz: null, rejection: "missingNonce" };
  }
  let p = idEnd + NONCE_SEP.length;
  let nonce = "";
  while (p < view.length && nonce.length < MAX_NONCE_DIGITS) {
    const c = view[p];
    if (c < 0x30 || c > 0x39) break; // not a digit
    nonce += String.fromCharCode(c);
    p++;
  }
  if (nonce.length === 0) {
    return { authz: null, rejection: p === view.length ? "truncated" : "emptyNonce" };
  }
  if (p < view.length && view[p] >= 0x30 && view[p] <= 0x39) {
    return { authz: null, rejection: "nonceTooLong" };
  }
  return { authz: `?accountId=${accountId.toLowerCase()}&nonce=${nonce}`, rejection: null };
}

export function parseAuthzAt(
  view: Buffer,
  at: number,
  diagnostics?: AuthzScanDiagnostics,
): string | null {
  const marker = ACCOUNT_ID_MARKERS.find((candidate) =>
    view.subarray(at, at + candidate.length).equals(candidate),
  );
  if (!marker) return null;
  const result = parseAuthzCandidate(view, at, marker.length);
  if (result.rejection && diagnostics) diagnostics[result.rejection] += 1;
  return result.authz;
}

export function scanBufferForAuthz(
  view: Buffer,
  counts: Map<string, number>,
  diagnostics?: AuthzScanDiagnostics,
): number {
  let markerHits = 0;
  for (const marker of ACCOUNT_ID_MARKERS) {
    let idx = 0;
    while ((idx = view.indexOf(marker, idx)) !== -1) {
      markerHits += 1;
      const authz = parseAuthzAt(view, idx, diagnostics);
      if (authz !== null) counts.set(authz, (counts.get(authz) ?? 0) + 1);
      idx += marker.length;
    }
  }
  return markerHits;
}

// Pick a unique most-frequent match; equal leaders are not safe to use.
export function bestAuthz(counts: Map<string, number>): {
  authz: string | null;
  hits: number;
  ambiguous: boolean;
} {
  let authz: string | null = null;
  let hits = 0;
  let ambiguous = false;
  for (const [k, v] of counts) {
    if (v > hits) {
      authz = k;
      hits = v;
      ambiguous = false;
    } else if (v === hits && v > 0) {
      ambiguous = true;
    }
  }
  return { authz: ambiguous ? null : authz, hits, ambiguous };
}

function findWarframePid(): number | null {
  let entries: string[];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    try {
      // comm truncates to 15 chars, but still contains "warframe".
      if (fs.readFileSync(`/proc/${e}/comm`, "utf8").toLowerCase().includes("warframe")) {
        return Number(e);
      }
    } catch {
      // process exited between readdir and read
    }
  }
  return null;
}

interface AuthzResult {
  authz: string | null;
  // "ok-Nx", "process-not-found", "mem-open-EACCES", "crumbs-not-found"
  reason: string;
}

// Scan the running game's memory and return its ?accountId=...&nonce=... query.
// Async + chunked so the ~GBs of committed memory never block the main thread.
export async function readGameAuthz(): Promise<AuthzResult> {
  const pid = findWarframePid();
  if (!pid) return { authz: null, reason: "process-not-found" };

  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(`/proc/${pid}/mem`, "r");
  } catch (e) {
    return { authz: null, reason: `mem-open-${(e as NodeJS.ErrnoException).code}` };
  }

  const counts = new Map<string, number>();
  const buf = Buffer.allocUnsafe(CHUNK);
  let chunkNo = 0;
  try {
    const maps = await fs.promises.readFile(`/proc/${pid}/maps`, "utf8");
    for (const line of maps.split("\n")) {
      const m = line.match(/^([0-9a-f]+)-([0-9a-f]+) (\S{4})/);
      if (!m || m[3][0] !== "r") continue; // readable regions only
      const start = parseInt(m[1], 16);
      const end = parseInt(m[2], 16);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
      for (let addr = start; addr < end; addr += CHUNK - OVERLAP) {
        const len = Math.min(CHUNK, end - addr);
        let n = 0;
        try {
          ({ bytesRead: n } = await fh.read(buf, 0, len, addr));
        } catch {
          continue; // uncommitted / guard page
        }
        if (!n) continue;
        scanBufferForAuthz(buf.subarray(0, n), counts);
        if (++chunkNo % 8 === 0) await new Promise((r) => setImmediate(r));
      }
    }
  } finally {
    await fh.close();
  }

  if (counts.size === 0) return { authz: null, reason: "crumbs-not-found" };
  const { authz, hits, ambiguous } = bestAuthz(counts);
  if (ambiguous) {
    log.warn(`Multiple auth matches share the highest frequency (${hits}) - refusing all`);
    return { authz: null, reason: "crumbs-ambiguous" };
  }
  if (counts.size > 1)
    log.warn(`Multiple distinct auth matches (${counts.size}) - using the most frequent`);
  return { authz, reason: `ok-${hits}x` };
}
