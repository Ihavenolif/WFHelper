import { describe, expect, it } from "vitest";

import { resolveCircuitChoices } from "../../../src/lib/world.js";
import type { ItemDbEntry } from "../../../src/types/inventory.js";

const TORID = "/Lotus/Weapons/Tenno/LongGuns/Torid";
const ADAPTER = "/Lotus/Types/Items/MiscItems/IncarnonAdapters/Primary/ToridIncarnonUnlocker";
const EXCALIBUR = "/Lotus/Powersuits/Excalibur/Excalibur";

const DB: Record<string, ItemDbEntry> = {
  [TORID]: { name: "Torid", imageUrl: "torid-base.png", category: "Primary" },
  [ADAPTER]: {
    name: "Torid Incarnon Genesis",
    imageUrl: "torid-incarnon.png",
    category: "Misc",
  },
  [`${ADAPTER}Blueprint`]: {
    name: "Torid Incarnon Genesis Blueprint",
    imageUrl: "torid-incarnon-bp.png",
  },
  [EXCALIBUR]: { name: "Excalibur", imageUrl: "excalibur.png", category: "Warframe" },
};

describe("circuit choice art", () => {
  it("shows the Incarnon Genesis art for a Steel Path weapon", () => {
    const [torid] = resolveCircuitChoices(["Torid"], DB, null);

    expect(torid.imageUrl).toBe("torid-incarnon.png");
    expect(torid.uniqueName).toBe(TORID);
  });

  it("still reads ownership off the base weapon", () => {
    const [torid] = resolveCircuitChoices(["Torid"], DB, { LongGuns: [{ ItemType: TORID }] });

    expect(torid.owned).toBe(true);
  });

  it("leaves warframes on their own portrait", () => {
    const [frame] = resolveCircuitChoices(["Excalibur"], DB, null);

    expect(frame.imageUrl).toBe("excalibur.png");
  });
});
