import { describe, expect, it } from "vitest";

import { WIKI_MOD_ART, WIKI_MOD_ART_BY_NAME } from "../../config/shared/wikiModArt";

// The stem is interpolated into a mirror URL and used as a filename, and the wiki
// decides what it says. Apostrophes survive encoding; separators must never appear.
function unsafeStems(record: Readonly<Record<string, string>>): string[] {
  return Object.entries(record)
    .filter(
      ([, stem]) =>
        !stem ||
        stem.length > 120 ||
        stem.includes("/") ||
        stem.includes("\\") ||
        stem.includes("..") ||
        [...stem].some((char) => char.charCodeAt(0) <= 31),
    )
    .map(([key, stem]) => `${key} -> ${stem}`);
}

describe("wiki mod art map", () => {
  it("covers the mods and arcanes it was generated from", () => {
    expect(Object.keys(WIKI_MOD_ART).length).toBeGreaterThan(1_600);
    expect(Object.keys(WIKI_MOD_ART_BY_NAME).length).toBeGreaterThan(1_600);
  });

  it("is keyed by game internal names", () => {
    const foreign = Object.keys(WIKI_MOD_ART).filter((key) => !key.startsWith("/Lotus/"));

    expect(foreign).toEqual([]);
  });

  it("names files that cannot escape the mirror directory", () => {
    expect(unsafeStems(WIKI_MOD_ART)).toEqual([]);
    expect(unsafeStems(WIKI_MOD_ART_BY_NAME)).toEqual([]);
  });

  it("carries no file extension, because the mirror stores webp", () => {
    const extensions = Object.values(WIKI_MOD_ART).filter((stem) =>
      /\.(png|jpe?g|gif)$/i.test(stem),
    );

    expect(extensions).toEqual([]);
  });

  it("resolves the pages the mapping was checked against", () => {
    expect(WIKI_MOD_ART["/Lotus/Upgrades/Mods/Pistol/DualStat/RadiationFireratePistolMod"]).toBe(
      "AcceleratedIsotopeMod",
    );
    expect(
      WIKI_MOD_ART["/Lotus/Upgrades/CosmeticEnhancers/Offensive/AbilityStrengthForMaxHealth"],
    ).toBe("ArcaneBellicose");
  });

  it("resolves the one-word staples the bare-key Lua entries hid", () => {
    // Vitality, Redirection and Flow are written as `Vitality = {`, not ["Vitality"].
    expect(WIKI_MOD_ART["/Lotus/Upgrades/Mods/Warframe/AvatarHealthMaxMod"]).toBe("VitalityMod");
    expect(WIKI_MOD_ART_BY_NAME.Redirection).toBeTruthy();
    expect(WIKI_MOD_ART_BY_NAME.Flow).toBeTruthy();
  });
});
