import { describe, expect, it } from "vitest";

import {
  barsForKey,
  formatAbsolute,
  formatters,
  shortDate,
} from "../../../src/lib/stats/chartData.js";
import type { DailyStatEntry } from "../../../src/types/ipc.js";

function dayStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function entry(date: string, absDucats?: number): DailyStatEntry {
  const base: DailyStatEntry = {
    date,
    platDelta: 0,
    creditsDelta: 0,
    endoDelta: 0,
    ducatsDelta: 0,
    ayaDelta: 0,
    vitusDelta: 0,
    relicsOpened: 0,
    daysPlayed: 1,
    dailyTrades: 0,
  };
  return absDucats === undefined ? base : { ...base, absDucats };
}

describe("barsForKey abs line", () => {
  it("carries the balance line in from an entry older than the window", () => {
    const hist = [entry(dayStr(-10), 10), entry(dayStr(-2), 10)];
    const res = barsForKey("ducatsDelta", hist, 7);

    expect(res.hasAbsData).toBe(true);
    expect(res.absLine).not.toBeNull();
    // Line spans the whole window, not just from the first in-window entry.
    expect(res.absLine![0].idx).toBe(0);
    expect(res.absLine!.length).toBe(res.bars.length);
    expect(res.absValues[0]).toBe(10);
  });

  it("starts the line at the first entry when no older data exists", () => {
    const hist = [entry(dayStr(-2), 10)];
    const res = barsForKey("ducatsDelta", hist, 7);

    expect(res.absLine).not.toBeNull();
    expect(res.absLine![0].idx).toBeGreaterThan(0);
    expect(Number.isNaN(res.absValues[0])).toBe(true);
  });

  it("renders axis and point when only today has a balance (newly tracked stat)", () => {
    const hist = [entry(dayStr(0), 10)];
    const res = barsForKey("ducatsDelta", hist, 7);

    expect(res.hasAbsData).toBe(true);
    expect(res.yTicks.length).toBeGreaterThan(0);
    expect(res.absLine).not.toBeNull();
    expect(res.absLine!.length).toBe(1);
    expect(res.absLine![0].idx).toBe(res.bars.length - 1);
  });
});

describe("stats formatting", () => {
  it("uses the selected locale for values, abbreviations and dates", () => {
    expect(formatAbsolute(1_250_000, "de")).toBe("1,25M");
    expect(formatters.creditsDelta(125_000, "de")).toBe("125,0k");
    expect(shortDate("2026-08-20", "de")).toBe("20.8.");

    expect(formatAbsolute(1_250_000, "en")).toBe("1.25M");
    expect(formatters.creditsDelta(125_000, "en")).toBe("125.0k");
    expect(shortDate("2026-08-20", "en")).toBe("8/20");
  });
});
