import { beforeAll, describe, expect, it } from "vitest";

import * as itemDatabase from "../../services/itemDatabase";
import { buildFullSetItems } from "../../src/lib/inventory/fullSets.js";
import { FULL_SET_OVERRIDES } from "../../src/lib/inventory/fullSetOverrides.js";
import type { ItemDbEntry } from "../../src/types/inventory.js";

function rendererItemDb(): Record<string, ItemDbEntry> {
  return itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
}

describe("full-set overrides", () => {
  beforeAll(() => {
    itemDatabase.buildDatabase();
  });

  it("resolves every curated root and exact component identity", () => {
    const db = rendererItemDb();
    const owned = new Map<string, number>();
    for (const override of FULL_SET_OVERRIDES) {
      owned.set(override.rootUniqueName, 1);
      for (const component of override.components) owned.set(component.uniqueName, 99);
      if (!override.rootName) expect(db[override.rootUniqueName]?.name).toBeTruthy();
    }

    const generated = buildFullSetItems(db, owned, owned);
    const bySlug = new Map(
      generated
        .filter((item) => typeof item.marketSlug === "string")
        .map((item) => [item.marketSlug, item] as const),
    );

    for (const override of FULL_SET_OVERRIDES) {
      const item = bySlug.get(override.slug);
      expect(item?.inventoryGroup, override.slug).toBe("full_sets");
      expect(
        item?.components.map((component) => component.uniqueName),
        override.slug,
      ).toEqual(override.components.map((component) => component.uniqueName));
    }
  });

  it("drops finished weapons and unlisted materials from generated components", () => {
    const db = rendererItemDb();
    const owned = new Map(Object.keys(db).map((uniqueName) => [uniqueName, 99]));
    const generated = buildFullSetItems(db, owned, owned);
    const aklex = generated.find((item) => item.name === "Aklex Prime Set");
    const perigale = generated.find((item) => item.name === "Perigale Set");
    const shedu = generated.find((item) => item.name === "Shedu Set");
    const ghoulsaw = generated.find((item) => item.name === "Ghoulsaw Set");

    expect(aklex?.components.map((component) => component.name)).toEqual(["Blueprint", "Link"]);
    expect(perigale?.components.map((component) => component.name)).toEqual([
      "Barrel",
      "Receiver",
      "Stock",
    ]);
    expect(shedu?.components.map((component) => component.name)).toEqual([
      "Barrel",
      "Chassis",
      "Handle",
      "Receiver",
    ]);
    expect(ghoulsaw?.components.map((component) => component.name)).toEqual([
      "Blade",
      "Blueprint",
      "Chassis",
      "Engine",
      "Grip",
    ]);
  });
});
