import { describe, expect, it } from "vitest";
import {
  correctedDropRarity,
  relicRefinementFromLocation,
  relicRewardRarity,
} from "../../services/relicRarity";

describe("relicRewardRarity", () => {
  it("maps every refinement's chances to the real rarity slots", () => {
    expect(relicRewardRarity("Intact", 25.33)).toBe("Common");
    expect(relicRewardRarity("Intact", 11)).toBe("Uncommon");
    expect(relicRewardRarity("Intact", 2)).toBe("Rare");
    expect(relicRewardRarity("Exceptional", 23.33)).toBe("Common");
    expect(relicRewardRarity("Exceptional", 13)).toBe("Uncommon");
    expect(relicRewardRarity("Exceptional", 4)).toBe("Rare");
    expect(relicRewardRarity("Flawless", 20)).toBe("Common");
    expect(relicRewardRarity("Flawless", 17)).toBe("Uncommon");
    expect(relicRewardRarity("Flawless", 6)).toBe("Rare");
    expect(relicRewardRarity("Radiant", 16.67)).toBe("Common");
    expect(relicRewardRarity("Radiant", 20)).toBe("Uncommon");
    expect(relicRewardRarity("Radiant", 10)).toBe("Rare");
  });

  it("disambiguates 20% by refinement (Flawless common vs Radiant uncommon)", () => {
    expect(relicRewardRarity("flawless", 20)).toBe("Common");
    expect(relicRewardRarity("radiant", 20)).toBe("Uncommon");
  });

  it("falls back on unknown refinement or off-table chance", () => {
    expect(relicRewardRarity("requiem?", 25.33, "Uncommon")).toBe("Uncommon");
    expect(relicRewardRarity("intact", 50, "Uncommon")).toBe("Uncommon");
  });
});

describe("relicRefinementFromLocation", () => {
  it("parses the refinement suffix, defaulting to intact", () => {
    expect(relicRefinementFromLocation("Meso L5 Relic (Radiant)")).toBe("radiant");
    expect(relicRefinementFromLocation("Meso L5 Relic (Flawless)")).toBe("flawless");
    expect(relicRefinementFromLocation("Meso L5 Relic")).toBe("intact");
  });
});

describe("correctedDropRarity", () => {
  it("corrects the upstream Uncommon label on relic commons", () => {
    expect(correctedDropRarity("Meso L5 Relic", 25.33, "Uncommon")).toBe("Common");
    expect(correctedDropRarity("Meso L5 Relic (Radiant)", 16.67, "Uncommon")).toBe("Common");
    expect(correctedDropRarity("Meso L5 Relic (Radiant)", 20, "Uncommon")).toBe("Uncommon");
  });

  it("passes non-relic rows through untouched", () => {
    expect(correctedDropRarity("Taranis (Void), Rotation C", 25.33, "Uncommon")).toBe("Uncommon");
  });
});
