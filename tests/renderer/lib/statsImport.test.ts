import { describe, expect, it } from "vitest";

import {
  assertStatsImportFileSize,
  isValidStatsImportPayload,
  MAX_STATS_IMPORT_FILE_BYTES,
  MAX_STATS_IMPORT_ROWS,
  MAX_TRADE_IMPORT_ROWS,
} from "../../../config/shared/statsImport.js";
import {
  normalizeAlecaFrameStats,
  parseAlecaFrameTrades,
} from "../../../src/lib/stats/importAlecaFrame.js";
import type { DailyStatEntry } from "../../../config/shared/statsTypes.js";

const VALID_ROW: DailyStatEntry = {
  date: "2026-01-01",
  platDelta: -10,
  creditsDelta: 200,
  endoDelta: 0,
  ducatsDelta: 0,
  ayaDelta: 0,
  vitusDelta: 0,
  relicsOpened: 2,
  daysPlayed: 1,
  dailyTrades: 3,
};

describe("stats import limits", () => {
  it("accepts 50 MB and rejects one byte more", () => {
    expect(() => assertStatsImportFileSize(MAX_STATS_IMPORT_FILE_BYTES)).not.toThrow();
    expect(() => assertStatsImportFileSize(MAX_STATS_IMPORT_FILE_BYTES + 1)).toThrow("50 MB");
  });

  it("accepts 10,000 daily rows and rejects one more", () => {
    expect(
      normalizeAlecaFrameStats(Array.from({ length: MAX_STATS_IMPORT_ROWS }, () => null)),
    ).toEqual([]);
    expect(() =>
      normalizeAlecaFrameStats(Array.from({ length: MAX_STATS_IMPORT_ROWS + 1 }, () => null)),
    ).toThrow(`${MAX_STATS_IMPORT_ROWS} rows`);
  });

  it("validates the stored daily-row shape", () => {
    expect(isValidStatsImportPayload([VALID_ROW])).toBe(true);
    expect(isValidStatsImportPayload([{ ...VALID_ROW, date: "2026-02-30" }])).toBe(false);
    expect(isValidStatsImportPayload([{ ...VALID_ROW, platDelta: Number.NaN }])).toBe(false);
    expect(isValidStatsImportPayload([{ ...VALID_ROW, relicsOpened: -1 }])).toBe(false);
  });

  it("stops parsing trades at the import limit", () => {
    const trades = Array.from({ length: MAX_TRADE_IMPORT_ROWS + 1 }, (_, index) => ({
      ts: `2026-01-01T00:00:${index}Z`,
      type: 0,
      totalPlat: index,
      user: "Trader",
    }));

    expect(parseAlecaFrameTrades({ trades })).toHaveLength(MAX_TRADE_IMPORT_ROWS);
  });
});
