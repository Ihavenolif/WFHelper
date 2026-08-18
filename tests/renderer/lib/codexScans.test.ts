import { describe, expect, it } from "vitest";

import { buildCodexRows, sortCodexRows } from "../../../src/lib/codexScans";
import { CODEX_SCAN_REQUIREMENTS } from "../../../src/data/codexScanRequirements";

const BUTCHER = "/Lotus/Types/Enemies/Grineer/AIWeek/BladeSawman";

describe("buildCodexRows", () => {
  it("ships a populated requirements table", () => {
    expect(Object.keys(CODEX_SCAN_REQUIREMENTS).length).toBeGreaterThan(500);
    expect(CODEX_SCAN_REQUIREMENTS[BUTCHER]).toMatchObject({
      name: "Butcher",
      scans: 20,
      faction: "grineer",
    });
  });

  it("matches profile avatar paths against wiki agent paths", () => {
    const rows = buildCodexRows([{ type: `${BUTCHER}Avatar`, count: 20 }]);
    const butcher = rows.find((row) => row.type === BUTCHER);
    expect(butcher).toMatchObject({ name: "Butcher", scanned: 20, required: 20, complete: true });
  });

  it("lists never-scanned enemies at zero", () => {
    const rows = buildCodexRows([]);
    const butcher = rows.find((row) => row.type === BUTCHER);
    expect(butcher).toMatchObject({ scanned: 0, complete: false });
    expect(rows.length).toBeGreaterThan(500);
  });

  it("appends scanned enemies the table does not know with a readable name", () => {
    const rows = buildCodexRows([{ type: "/Lotus/Types/Enemies/New/UnknownBossAvatar", count: 2 }]);
    const unknown = rows.find((row) => row.type === "/Lotus/Types/Enemies/New/UnknownBossAvatar");
    expect(unknown).toMatchObject({
      name: "Unknown Boss",
      scanned: 2,
      required: null,
      complete: null,
    });
  });

  it("sorts rows by display name", () => {
    const rows = buildCodexRows([]);
    const names = rows.map((row) => row.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("sortCodexRows", () => {
  const rows = buildCodexRows([
    { type: `${BUTCHER}Avatar`, count: 15 },
    { type: "/Lotus/Types/Enemies/New/UnknownBossAvatar", count: 99 },
  ]);

  it("scans puts the highest raw counts first", () => {
    const sorted = sortCodexRows(rows, "scans");
    expect(sorted[0].scanned).toBe(99);
    expect(sorted[1].name).toBe("Butcher");
  });

  it("progress ranks partial completion above zero and unknown last", () => {
    const sorted = sortCodexRows(rows, "progress");
    const butcherIdx = sorted.findIndex((row) => row.name === "Butcher");
    const unknownIdx = sorted.findIndex((row) => row.required === null);
    const zeroIdx = sorted.findIndex((row) => row.scanned === 0);
    expect(butcherIdx).toBeLessThan(zeroIdx);
    expect(unknownIdx).toBe(sorted.length - 1);
  });

  it("name keeps the given alphabetical order", () => {
    const sorted = sortCodexRows(rows, "name");
    expect(sorted.map((row) => row.name)).toEqual(rows.map((row) => row.name));
  });
});
