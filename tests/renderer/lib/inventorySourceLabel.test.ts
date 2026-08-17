import { describe, expect, it } from "vitest";

import { describeInventorySource } from "../../../src/lib/inventorySourceLabel.js";

describe("describeInventorySource", () => {
  it("names each source in plain language", () => {
    expect(describeInventorySource("helper", null).label).toBe("Built-in helper");
    expect(describeInventorySource("manual", null).label).toBe("Custom JSON file");
    expect(describeInventorySource("aleca", null).label).toBe("AlecaFrame");
  });

  it("shows the file name for a manual pick and keeps the full path as a tooltip", () => {
    const described = describeInventorySource("manual", "D:\\exports\\inventory_manual.json");

    expect(described.detail).toBe("inventory_manual.json");
    expect(described.title).toBe("D:\\exports\\inventory_manual.json");
  });

  it("splits posix paths too", () => {
    expect(describeInventorySource("manual", "/home/tenno/inventory.json").detail).toBe(
      "inventory.json",
    );
  });

  // The helper discovers its own file, so naming it says nothing the label does not.
  it("adds no file detail for the helper, which the user never points at a file", () => {
    const helper = describeInventorySource("helper", "/var/api-helper/inventory.json");

    expect(helper).toEqual({ label: "Built-in helper", detail: "", title: "Built-in helper" });
  });

  it("names the AlecaFrame file too - the user picked that one", () => {
    const aleca = describeInventorySource("aleca", "C:\\AlecaFrame\\lastData.dat");

    expect(aleca).toEqual({
      label: "AlecaFrame",
      detail: "lastData.dat",
      title: "C:\\AlecaFrame\\lastData.dat",
    });
  });

  it("falls back to the helper label for a legacy or unknown source", () => {
    expect(describeInventorySource("json", null).label).toBe("Built-in helper");
    expect(describeInventorySource(undefined, null).label).toBe("Built-in helper");
  });
});
