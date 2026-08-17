import { CODEX_SCAN_REQUIREMENTS } from "../data/codexScanRequirements.js";
import type { CodexScanEntry } from "../../config/shared/codexTypes.js";

export interface CodexRow {
  type: string;
  name: string;
  scanned: number;
  /** Null when the wiki table does not know this enemy. */
  required: number | null;
  complete: boolean | null;
}

// The profile reports Avatar paths while the wiki mostly stores Agent paths;
// the shared stem identifies the enemy.
const normalizeType = (type: string): string => type.replace(/(Avatar|Agent)$/i, "");

function fallbackName(type: string): string {
  const tail = type.split("/").filter(Boolean).pop() || type;
  return normalizeType(tail).replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Every known enemy joined with the profile's scan counts, unknown scanned
 * types appended - so never-seen enemies still show as 0 of N. */
export function buildCodexRows(scans: CodexScanEntry[]): CodexRow[] {
  const scannedByKey = new Map<string, number>();
  for (const entry of scans) {
    const key = normalizeType(entry.type);
    scannedByKey.set(key, Math.max(scannedByKey.get(key) ?? 0, entry.count));
  }

  const rows: CodexRow[] = [];
  const covered = new Set<string>();
  for (const [type, requirement] of Object.entries(CODEX_SCAN_REQUIREMENTS)) {
    const key = normalizeType(type);
    covered.add(key);
    const scanned = scannedByKey.get(key) ?? 0;
    rows.push({
      type,
      name: requirement.name,
      scanned,
      required: requirement.scans,
      complete: scanned >= requirement.scans,
    });
  }

  for (const entry of scans) {
    const key = normalizeType(entry.type);
    if (covered.has(key)) continue;
    covered.add(key);
    rows.push({
      type: entry.type,
      name: fallbackName(entry.type),
      scanned: entry.count,
      required: null,
      complete: null,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
