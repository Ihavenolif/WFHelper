import { describe, expect, it } from "vitest";

import { isLoginCompleteLine } from "../../services/eeLogMonitor";

describe("EE.log login detection", () => {
  it("matches a completed login", () => {
    expect(
      isLoginCompleteLine(
        "16.880 Script [Info]: ThemedMainMenu.lua: MainMenu::LoginDone result=true",
      ),
    ).toBe(true);
  });

  it("ignores the earlier login attempt and failed completion", () => {
    expect(isLoginCompleteLine("14.092 Sys [Info]: Logging in as ")).toBe(false);
    expect(isLoginCompleteLine("MainMenu::LoginDone result=false")).toBe(false);
  });
});
