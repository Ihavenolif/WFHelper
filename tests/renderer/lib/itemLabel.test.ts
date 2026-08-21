import { describe, expect, it } from "vitest";

import { itemLabel } from "../../../src/lib/itemLabel";

describe("itemLabel", () => {
  it("prefers the localized name and falls back to English", () => {
    expect(itemLabel({ name: "Serration", displayName: "Einkerbung" })).toBe("Einkerbung");
    expect(itemLabel({ name: "Serration" })).toBe("Serration");
  });

  it("never renders undefined at a caller that has no item yet", () => {
    expect(itemLabel(null)).toBe("");
    expect(itemLabel(undefined)).toBe("");
    expect(itemLabel({})).toBe("");
    expect(itemLabel({ name: "", displayName: "" })).toBe("");
  });
});
