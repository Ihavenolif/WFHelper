import { describe, expect, it } from "vitest";

import { en } from "../../../src/i18n/en.js";
import { masteryProjectionSubtext, type Translate } from "../../../src/lib/masteryProjection.js";

// Mirrors the app translator so the assertions stay against real English copy.
const t: Translate = (key, params = {}) =>
  (en[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));

describe("masteryProjectionSubtext", () => {
  it("separates banked rank support from ready Foundry XP", () => {
    expect(masteryProjectionSubtext(t, 22, 1_759_845, 36_000, "en")).toBe(
      `Banked XP supports MR 26 · ${Number(36_000).toLocaleString("en")} XP ready in Foundry`,
    );
  });

  it("credits Foundry XP when it crosses the next threshold", () => {
    expect(masteryProjectionSubtext(t, 25, 1_680_000, 20_000, "en")).toBe(
      `Foundry raises potential to MR 26 (+${Number(20_000).toLocaleString("en")} XP)`,
    );
  });

  it("shows both banked support and a further Foundry projection", () => {
    expect(masteryProjectionSubtext(t, 24, 1_680_000, 20_000, "en")).toBe(
      `Banked XP supports MR 25 · Foundry raises potential to MR 26 (+${Number(20_000).toLocaleString("en")} XP)`,
    );
  });

  it("only reports ready XP when no rank threshold changes", () => {
    expect(masteryProjectionSubtext(t, 25, 1_600_000, 20_000, "en")).toBe(
      `${Number(20_000).toLocaleString("en")} XP ready in Foundry`,
    );
  });

  it("formats ready XP for the selected locale", () => {
    expect(masteryProjectionSubtext(t, 25, 1_600_000, 20_000, "de")).toBe(
      `${Number(20_000).toLocaleString("de")} XP ready in Foundry`,
    );
  });

  it("handles legendary-rank thresholds", () => {
    expect(masteryProjectionSubtext(t, 29, 2_300_000, 100_000, "en")).toBe(
      `Banked XP supports MR 30 · Foundry raises potential to MR 31 (+${Number(100_000).toLocaleString("en")} XP)`,
    );
  });

  it("returns no projection without positive ready XP", () => {
    expect(masteryProjectionSubtext(t, 25, 1_600_000, 0, "en")).toBeNull();
  });
});
