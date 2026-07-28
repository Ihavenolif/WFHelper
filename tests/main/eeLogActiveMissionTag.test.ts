import { describe, expect, it } from "vitest";

import { isMissionEndLine, parseActiveMissionTag } from "../../services/eeLogMonitor";

describe("parseActiveMissionTag", () => {
  it("parses the key=value mission-info block form", () => {
    expect(parseActiveMissionTag("    activeMissionTag=VoidT6")).toBe("VoidT6");
    expect(parseActiveMissionTag("activeMissionTag=VoidT1")).toBe("VoidT1");
  });

  it("parses the JSON block form", () => {
    expect(parseActiveMissionTag('    "activeMissionTag" : "VoidT5",')).toBe("VoidT5");
    expect(parseActiveMissionTag('{"activeMissionTag":"VoidT2"}')).toBe("VoidT2");
  });

  it("ignores unrelated and empty lines", () => {
    expect(parseActiveMissionTag("    activeMissionId=SolNode717_6a59dee6")).toBeNull();
    expect(parseActiveMissionTag("activeMissionTag=")).toBeNull();
    expect(parseActiveMissionTag("123.4 Sys [Info]: nothing here")).toBeNull();
  });
});

describe("isMissionEndLine", () => {
  it("matches extraction and abort lines", () => {
    expect(isMissionEndLine("81.780 Sys [Info]: EOM missionLocationUnlocked=1")).toBe(true);
    expect(isMissionEndLine("94.132 Script [Info]: TopMenu.lua: Abort: aborting mission")).toBe(
      true,
    );
  });

  it("ignores regular mission lines", () => {
    expect(isMissionEndLine("50.1 Sys [Info]: MissionLocation loaded")).toBe(false);
    expect(isMissionEndLine("    activeMissionTag=VoidT6")).toBe(false);
  });
});
