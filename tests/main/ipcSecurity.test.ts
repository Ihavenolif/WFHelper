import { afterEach, describe, expect, it } from "vitest";

import ctx from "../../ipc/context";
import * as ipcSecurity from "../../ipc/ipcSecurity";
import { makeEvent, makeWindowStub } from "./senderGuardHelpers";

describe("ipc sender guards", () => {
  const originalMainWindow = ctx.mainWindow;
  const originalOverlayWindow = ctx.overlayWindow;
  const originalRivenOverlayLeftWindow = ctx.rivenOverlayLeftWindow;
  const originalRivenOverlayRightWindow = ctx.rivenOverlayRightWindow;
  const originalTradeNotificationWindow = ctx.tradeNotificationWindow;

  afterEach(() => {
    ctx.mainWindow = originalMainWindow;
    ctx.overlayWindow = originalOverlayWindow;
    ctx.rivenOverlayLeftWindow = originalRivenOverlayLeftWindow;
    ctx.rivenOverlayRightWindow = originalRivenOverlayRightWindow;
    ctx.tradeNotificationWindow = originalTradeNotificationWindow;
  });

  it("accepts the expected main renderer sender", () => {
    ctx.mainWindow = makeWindowStub(11);

    const event = makeEvent(11, "file:///D:/app/renderer/dist/index.html");

    expect(() => ipcSecurity.assertMainRendererSender(event, "get-inventory")).not.toThrow();
    expect(
      ipcSecurity.isAuthorizedSender(ipcSecurity.assertMainRendererSender, event, "get-inventory"),
    ).toBe(true);
  });

  it("rejects sender id mismatch", () => {
    ctx.mainWindow = makeWindowStub(22);

    const event = makeEvent(19, "file:///D:/app/renderer/dist/index.html");

    expect(() => ipcSecurity.assertMainRendererSender(event, "get-inventory")).toThrow();
    expect(
      ipcSecurity.isAuthorizedSender(ipcSecurity.assertMainRendererSender, event, "get-inventory"),
    ).toBe(false);
  });

  it("rejects wrong renderer URL even when sender id matches", () => {
    ctx.overlayWindow = makeWindowStub(33);

    const event = makeEvent(33, "file:///D:/app/renderer/dist/index.html");

    expect(() =>
      ipcSecurity.assertOverlayRendererSender(event, "overlay-get-relic-items"),
    ).toThrow();
  });

  it("accepts either riven overlay sender", () => {
    ctx.rivenOverlayLeftWindow = makeWindowStub(41);
    ctx.rivenOverlayRightWindow = makeWindowStub(42);

    const leftEvent = makeEvent(41, "file:///D:/app/renderer/riven-overlay.html");
    const rightEvent = makeEvent(42, "file:///D:/app/renderer/riven-overlay.html");

    expect(() =>
      ipcSecurity.assertRivenOverlayRendererSender(leftEvent, "riven-ready"),
    ).not.toThrow();
    expect(() =>
      ipcSecurity.assertRivenOverlayRendererSender(rightEvent, "riven-ready"),
    ).not.toThrow();
    for (const event of [leftEvent, rightEvent]) {
      expect(
        ipcSecurity.isAuthorizedSender(
          ipcSecurity.assertRivenOverlayRendererSender,
          event,
          "riven-ready",
        ),
      ).toBe(true);
    }
  });

  it("lets the trade toast read messages but nothing else", () => {
    ctx.tradeNotificationWindow = makeWindowStub(51);

    const event = makeEvent(51, "file:///D:/app/renderer/trade-notification.html");

    expect(() =>
      ipcSecurity.assertLocalizedOverlaySender(event, "overlay:get-messages"),
    ).not.toThrow();
    expect(() =>
      ipcSecurity.assertOverlayRendererSender(event, "overlay:get-theme-vars"),
    ).toThrow();
  });

  it("rejects an unknown window on the message channel", () => {
    const event = makeEvent(99, "file:///D:/app/renderer/overlay.html");

    expect(() => ipcSecurity.assertLocalizedOverlaySender(event, "overlay:get-messages")).toThrow();
  });
});
