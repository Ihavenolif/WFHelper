import { describe, expect, it } from "vitest";

import { buildCodexRows } from "../../../src/lib/codexScans";
import { CODEX_SCAN_REQUIREMENTS } from "../../../src/data/codexScanRequirements";

const BUTCHER = "/Lotus/Types/Enemies/Grineer/AIWeek/BladeSawman";

describe("buildCodexRows", () => {
  it("ships a populated requirements table", () => {
    expect(Object.keys(CODEX_SCAN_REQUIREMENTS).length).toBeGreaterThan(500);
    expect(CODEX_SCAN_REQUIREMENTS[BUTCHER]).toEqual({ name: "Butcher", scans: 20 });
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
