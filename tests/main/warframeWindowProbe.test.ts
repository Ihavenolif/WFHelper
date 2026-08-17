import { describe, expect, it } from "vitest";

import { parseWarframeWindowBounds } from "../../services/warframeStatus";

const TREE = `xwininfo: Window id: 0x4a1 (the root window) (has no name)

  Root window id: 0x4a1 (the root window) (has no name)
  Parent window id: 0x0 (none)
     42 children:
     0x2400007 "Steam": ("steamwebhelper" "Steam")  1024x768+100+100  +100+100
     0x1400003 "Warframe": ("warframe.x64.exe" "Wine")  1920x1080+0+0  +1920+0
     0x1400009 (has no name): ("warframe.x64.exe" "Wine")  16x16+0+0  +1920+0
     0x3200001 "WFHelper": ("wfhelper" "WFHelper")  1600x900+40+40  +40+40
`;

describe("parseWarframeWindowBounds", () => {
  it("returns the absolute geometry of the game window", () => {
    expect(parseWarframeWindowBounds(TREE)).toEqual({
      x: 1920,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it("ignores wine helper windows and other clients", () => {
    const helpersOnly = TREE.split("\n")
      .filter((line) => !line.includes("1920x1080"))
      .join("\n");
    expect(parseWarframeWindowBounds(helpersOnly)).toBeNull();
  });

  it("matches on the window name when the class does not say warframe", () => {
    const named = `     0x1400003 "Warframe": ("explorer.exe" "Wine")  2560x1440+0+0  +-2560+120`;
    expect(parseWarframeWindowBounds(named)).toEqual({
      x: -2560,
      y: 120,
      width: 2560,
      height: 1440,
    });
  });

  it("survives empty or unrelated output", () => {
    expect(parseWarframeWindowBounds("")).toBeNull();
    expect(parseWarframeWindowBounds("xwininfo: error: unable to open display")).toBeNull();
  });
});
