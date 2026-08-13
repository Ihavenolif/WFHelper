import type { DailyStatEntry } from "./statsTypes";

export const MAX_STATS_IMPORT_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_STATS_IMPORT_ROWS = 10_000;
export const MAX_TRADE_IMPORT_ROWS = 10_000;

const DELTA_KEYS = [
  "platDelta",
  "creditsDelta",
  "endoDelta",
  "ducatsDelta",
  "ayaDelta",
  "vitusDelta",
] as const;
const COUNT_KEYS = ["relicsOpened", "daysPlayed", "dailyTrades"] as const;
const BALANCE_KEYS = [
  "absPlat",
  "absCredits",
  "absEndo",
  "absDucats",
  "absAya",
  "absVitus",
] as const;

export function isValidStatsImportDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function assertStatsImportFileSize(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_STATS_IMPORT_FILE_BYTES) {
    throw new Error("Stats import file exceeds 50 MB.");
  }
}

export function assertStatsImportRowCount(count: number): void {
  if (!Number.isInteger(count) || count < 0 || count > MAX_STATS_IMPORT_ROWS) {
    throw new Error(`Stats import exceeds ${MAX_STATS_IMPORT_ROWS} rows.`);
  }
}

export function isDailyStatEntry(value: unknown): value is DailyStatEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (!isValidStatsImportDate(entry.date)) return false;
  if (DELTA_KEYS.some((key) => !Number.isFinite(entry[key]))) return false;
  if (COUNT_KEYS.some((key) => !Number.isInteger(entry[key]) || (entry[key] as number) < 0)) {
    return false;
  }
  return BALANCE_KEYS.every(
    (key) =>
      entry[key] === undefined ||
      (typeof entry[key] === "number" && Number.isFinite(entry[key]) && entry[key] >= 0),
  );
}

export function isValidStatsImportPayload(value: unknown): value is DailyStatEntry[] {
  return (
    Array.isArray(value) && value.length <= MAX_STATS_IMPORT_ROWS && value.every(isDailyStatEntry)
  );
}
