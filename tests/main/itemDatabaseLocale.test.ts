import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setGameLocale } from "../../services/gameLocale";
import * as itemDb from "../../services/itemDatabase";

const SERRATION = "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod";
const VITALITY = "/Lotus/Upgrades/Mods/Warframe/AvatarHealthMaxMod";

beforeAll(() => {
  itemDb.buildDatabase();
});

afterAll(() => {
  setGameLocale("en");
});

describe("item database game language", () => {
  it("ships no displayName at all while the game language is English", () => {
    setGameLocale("en");
    const lookup = itemDb.getRendererLookup();

    expect(lookup[SERRATION].name).toBe("Serration");
    expect(lookup[SERRATION].displayName).toBeUndefined();
    expect(Object.values(lookup).some((entry) => entry.displayName)).toBe(false);
  });

  it("adds displayName without ever moving the English join key", () => {
    setGameLocale("de");
    const lookup = itemDb.getRendererLookup();

    expect(lookup[SERRATION].name).toBe("Serration");
    expect(lookup[SERRATION].displayName).toBe("Einkerbung");
    expect(lookup[VITALITY].name).toBe("Vitality");
    expect(lookup[VITALITY].displayName).toBe("Vitalität");
  });

  // Frames and weapons are proper nouns DE leaves alone: dict.de.json really does
  // say "Excalibur Prime". Mods and arcanes are the categories German rewrites.
  it("translates the categories the German client actually translates", () => {
    setGameLocale("de");
    const entries = Object.values(itemDb.getRendererLookup());
    const share = (category: string) => {
      const of = entries.filter((entry) => entry.category === category);
      return of.filter((entry) => entry.displayName).length / of.length;
    };

    expect(share("Mod")).toBeGreaterThan(0.9);
    expect(share("Arcane")).toBeGreaterThan(0.9);
    expect(share("Resource")).toBeGreaterThan(0.85);
  });

  it("switches back cleanly, so a language change cannot leave stale names", () => {
    setGameLocale("zh");
    expect(itemDb.getRendererLookup()[SERRATION].displayName).toBe("膛线");

    setGameLocale("en");
    expect(itemDb.getRendererLookup()[SERRATION].displayName).toBeUndefined();
  });

  // DE gives recipes no name at all, so ours is composed. The pattern it ships
  // moves the word: Korean appends it, Spanish and Russian lead with it.
  it("localizes blueprint names through the pattern DE composes them with", () => {
    const blueprint = "/Lotus/Types/Recipes/Weapons/WeaponParts/DuviriRifleBarrelBlueprint";

    setGameLocale("en");
    expect(itemDb.getRendererLookup()[blueprint].name).toBe("Aeolak Barrel Blueprint");

    setGameLocale("ko");
    expect(itemDb.getRendererLookup()[blueprint].displayName).toBe("아이올락 배럴 설계도");

    setGameLocale("es");
    expect(itemDb.getRendererLookup()[blueprint].displayName).toBe("Plano de Cañón de Aeolak");
  });

  it("keeps the English name as the join key for a localized blueprint", () => {
    setGameLocale("ko");
    const blueprint =
      itemDb.getRendererLookup()[
        "/Lotus/Types/Recipes/Weapons/WeaponParts/DuviriRifleBarrelBlueprint"
      ];

    expect(blueprint.name).toBe("Aeolak Barrel Blueprint");
  });

  it("omits displayName for names a dictionary key never covered", () => {
    setGameLocale("de");
    const lookup = itemDb.getRendererLookup();
    const relic = Object.entries(lookup).find(([key]) => /\/Types\/Keys\/.*Relic/i.test(key));

    // Relic names are composed from English words, so they stay English on purpose.
    if (relic) expect(relic[1].displayName).toBeUndefined();
  });
});
