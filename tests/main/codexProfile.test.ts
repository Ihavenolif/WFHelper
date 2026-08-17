import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

import { parseProfileScans } from "../../services/codexProfile";

describe("parseProfileScans", () => {
  const entries = [
    { scans: 752, type: "/Lotus/Types/Enemies/Corpus/CrewmanAvatar" },
    { scans: 3, type: "/Lotus/Types/Enemies/Grineer/LancerAvatar" },
  ];

  it("reads the array from root.Stats", () => {
    const result = parseProfileScans({ Stats: { Scans: entries } });
    expect(result).toEqual([
      { type: "/Lotus/Types/Enemies/Corpus/CrewmanAvatar", count: 752 },
      { type: "/Lotus/Types/Enemies/Grineer/LancerAvatar", count: 3 },
    ]);
  });

  it("falls back to Results[0].Stats", () => {
    const result = parseProfileScans({ Results: [{ Stats: { Scans: entries } }] });
    expect(result?.length).toBe(2);
  });

  it("drops malformed entries and clamps negatives", () => {
    const result = parseProfileScans({
      Stats: { Scans: [{ scans: -2, type: "/L/X" }, { scans: 1 }, { type: "/L/Y" }, null] },
    });
    expect(result).toEqual([{ type: "/L/X", count: 0 }]);
  });

  it("returns null when no scans array exists", () => {
    expect(parseProfileScans({})).toBeNull();
    expect(parseProfileScans(null)).toBeNull();
  });
});
