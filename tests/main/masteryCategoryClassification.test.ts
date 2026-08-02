import { beforeAll, describe, expect, it } from "vitest";

import * as itemDb from "../../services/itemDatabase";
import * as masteryHelper from "../../services/masteryHelper";

describe("mastery category overrides", () => {
  let allMasterable: Array<{
    name: string;
    category: string;
    debugReason?: string;
    keywords?: string[];
  }> = [];

  beforeAll(() => {
    itemDb.buildDatabase();
    allMasterable = masteryHelper.getAllMasterableItems();
  });

  it("places hound companions under Companions instead of Secondary", () => {
    const bhaira = allMasterable.find((item) => item.name === "Bhaira Hound");

    expect(bhaira).toBeTruthy();
    expect(bhaira?.category).toBe("Companions");
    expect(bhaira?.debugReason).toContain("cat:override:pets");
  });

  it("places K-Drive boards under Misc instead of Secondary", () => {
    const badBaby = allMasterable.find((item) => item.name === "Bad Baby");

    expect(badBaby).toBeTruthy();
    expect(badBaby?.category).toBe("Misc");
    expect(badBaby?.debugReason).toContain("cat:override:k-drive");
  });

  it("tags K-Drive boards with searchable k-drive keywords", () => {
    const badBaby = allMasterable.find((item) => item.name === "Bad Baby");

    expect(badBaby).toBeTruthy();
    expect(badBaby?.keywords).toEqual(expect.arrayContaining(["k-drive", "kdrive"]));
  });

  it("places every Zaw strike under Melee instead of Secondary", () => {
    const zawNames = [
      "Balla",
      "Cyath",
      "Dehtat",
      "Dokrahm",
      "Kronsh",
      "Mewan",
      "Ooltha",
      "Plague Keewar",
      "Plague Kripath",
      "Rabvee",
      "Sepfahn",
    ];

    for (const name of zawNames) {
      const item = allMasterable.find((entry) => entry.name === name);
      expect(item?.category).toBe("Melee");
      expect(item?.debugReason).toContain("cat:override:zaw-strike");
    }
  });
});
