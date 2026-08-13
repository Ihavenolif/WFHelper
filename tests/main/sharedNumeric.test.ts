import { describe, it, expect } from "vitest";

import { toFiniteNumber, normalizeDucats } from "../../config/shared/numeric";

// Warframe inventory numbers may use nested BSON wrappers.
describe("toFiniteNumber boxed-number handling", () => {
  it("unwraps BSON-style boxed numbers, including nested", () => {
    expect(toFiniteNumber({ $numberLong: "1000" })).toBe(1000);
    expect(toFiniteNumber({ $numberDouble: "2.5" })).toBe(2.5);
    expect(toFiniteNumber({ $numberInt: { $numberLong: "42" } })).toBe(42);
  });

  it("still handles plain numbers/strings and rejects junk", () => {
    expect(toFiniteNumber("  3.14  ")).toBe(3.14);
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber("abc")).toBeNull();
  });

  it("normalizeDucats parses boxed values", () => {
    expect(normalizeDucats({ $numberLong: "45" })).toBe(45);
  });
});
