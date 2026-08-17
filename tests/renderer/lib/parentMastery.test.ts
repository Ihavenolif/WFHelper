import { describe, expect, it } from "vitest";

import { attachParentMastered, buildParentMasteredResolver } from "../../../src/lib/parentMastery";
import type { ItemDbEntry, MasteryData } from "../../../src/types/inventory";

const itemDb = {
  "/W/BratonPrime": { name: "Braton Prime" },
  "/W/BratonPrimeBarrel": {
    name: "Braton Prime Barrel",
    isBuildComponent: true,
    componentOf: "/W/BratonPrime",
  },
  "/W/SomaPrime": { name: "Soma Prime" },
  "/W/SomaPrimeStock": {
    name: "Soma Prime Stock",
    isBuildComponent: true,
    componentOf: "/W/SomaPrime",
  },
} as unknown as Record<string, ItemDbEntry>;

const mastery = {
  items: [
    { name: "Braton Prime", uniqueName: "/W/BratonPrime", status: "mastered" },
    { name: "Soma Prime", uniqueName: "/W/SomaPrime", status: "progress" },
  ],
} as unknown as MasteryData;

const resolve = buildParentMasteredResolver(itemDb, mastery);

describe("buildParentMasteredResolver", () => {
  it("marks a part of a mastered item yes and of an unmastered item no", () => {
    expect(resolve({ name: "Braton Prime Barrel", internalName: "/W/BratonPrimeBarrel" })).toBe(
      true,
    );
    expect(resolve({ name: "Soma Prime Stock", internalName: "/W/SomaPrimeStock" })).toBe(false);
  });

  it("resolves blueprint-suffixed inventory keys through the alias", () => {
    expect(resolve({ name: "Soma Prime Stock", internalName: "/W/SomaPrimeStockBlueprint" })).toBe(
      false,
    );
  });

  it("falls back to the display name when the key is unknown", () => {
    expect(resolve({ name: "Braton Prime Barrel", internalName: "/Unknown/Key" })).toBe(true);
  });

  it("resolves set rows through the base item", () => {
    expect(resolve({ name: "Braton Prime Set" })).toBe(true);
    expect(resolve({ name: "Soma Prime Set" })).toBe(false);
  });

  it("resolves a masterable row through itself", () => {
    expect(resolve({ name: "Soma Prime", internalName: "/W/SomaPrime" })).toBe(false);
  });

  it("returns undefined for rows nothing masterable needs", () => {
    expect(resolve({ name: "Forma" })).toBeUndefined();
  });

  it("returns undefined for everything without mastery data", () => {
    const cold = buildParentMasteredResolver(itemDb, null);
    expect(cold({ name: "Braton Prime Barrel", internalName: "/W/BratonPrimeBarrel" })).toBe(
      undefined,
    );
  });
});

describe("attachParentMastered", () => {
  it("stamps resolvable rows and leaves the rest untouched", () => {
    const rows: Array<{ name: string; internalName?: string; parentMastered?: boolean }> = [
      { name: "Braton Prime Barrel", internalName: "/W/BratonPrimeBarrel" },
      { name: "Forma" },
    ];
    const [barrel, forma] = attachParentMastered(rows, itemDb, mastery);
    expect(barrel.parentMastered).toBe(true);
    expect(forma).toBe(rows[1]);
  });
});
