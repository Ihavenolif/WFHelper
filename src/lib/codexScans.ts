import { CODEX_SCAN_REQUIREMENTS } from "../data/codexScanRequirements.js";
import type { CodexScanEntry } from "../../config/shared/codexTypes.js";

export interface CodexRow {
  type: string;
  name: string;
  scanned: number;
  /** Null when the wiki table does not know this enemy. */
  required: number | null;
  complete: boolean | null;
  faction: string | null;
  image: string | null;
}

export type CodexSortKey = "name" | "scans" | "progress";

/** Wiki partition keys in the order the in-game codex lists factions. */
export const CODEX_FACTIONS: Array<{ key: string; label: string }> = [
  { key: "grineer", label: "Grineer" },
  { key: "corpus", label: "Corpus" },
  { key: "infestation", label: "Infested" },
  { key: "orokin", label: "Orokin" },
  { key: "sentient", label: "Sentient" },
  { key: "narmer", label: "Narmer" },
  { key: "themurmur", label: "The Murmur" },
  { key: "techrot", label: "Techrot" },
  { key: "scaldra", label: "Scaldra" },
  { key: "anarchs", label: "Anarchs" },
  { key: "stalker", label: "Stalker" },
  { key: "unaffiliated", label: "Unaffiliated" },
];

const ENEMY_IMAGE_BASE = "https://assets.wfhelper.com/enemies/";

export function enemyImageUrl(image: string | null): string | null {
  return image ? `${ENEMY_IMAGE_BASE}${encodeURIComponent(image)}` : null;
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
      faction: requirement.faction,
      image: requirement.image ?? null,
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
      faction: null,
      image: null,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Complete entries count as full progress, unknown requirements sort last. */
function progressOf(row: CodexRow): number {
  if (row.required === null) return -1;
  if (row.required <= 0) return 1;
  return Math.min(1, row.scanned / row.required);
}

export function sortCodexRows(rows: CodexRow[], sortBy: CodexSortKey): CodexRow[] {
  const sorted = [...rows];
  if (sortBy === "scans") {
    sorted.sort((a, b) => b.scanned - a.scanned || a.name.localeCompare(b.name));
  } else if (sortBy === "progress") {
    sorted.sort((a, b) => progressOf(b) - progressOf(a) || a.name.localeCompare(b.name));
  }
  return sorted;
}
