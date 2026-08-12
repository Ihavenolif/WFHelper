import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OVERLAY_SETTINGS_DEFAULTS } from "../../config/runtime/overlaySettings";
import type { TradeMatchPayload } from "../../config/shared/tradeMatch";

interface SentMessage {
  channel: string;
  payload: unknown;
}

interface WindowStub {
  hidden: boolean;
  sent: SentMessage[];
  finishLoad: () => void;
}

const h = vi.hoisted(() => ({
  windows: [] as WindowStub[],
  hotkeys: new Map<string, () => void>(),
  registerHotkey: vi.fn(),
  unregisterHotkey: vi.fn(),
  sendPlusRep: vi.fn(),
}));

vi.mock("electron", () => {
  class BrowserWindow {
    hidden = false;
    sent: SentMessage[] = [];
    private finishLoadHandler: (() => void) | null = null;
    webContents = {
      send: (channel: string, payload: unknown) => this.sent.push({ channel, payload }),
      once: (event: string, handler: () => void) => {
        if (event === "did-finish-load") this.finishLoadHandler = handler;
      },
    };

    constructor(_options: unknown) {
      h.windows.push(this);
    }

    finishLoad() {
      this.finishLoadHandler?.();
    }

    isDestroyed() {
      return false;
    }

    loadFile() {
      return Promise.resolve();
    }

    showInactive() {
      this.hidden = false;
    }

    hide() {
      this.hidden = true;
    }

    moveTop() {}
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    setVisibleOnAllWorkspaces() {}

    on(_event: string, _handler: () => void) {}
  }

  return {
    app: { getAppPath: () => "D:/app" },
    BrowserWindow,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920 } }) },
  };
});

vi.mock("../../ipc/hotkeyRegistry", () => ({
  registerTransientHotkey: h.registerHotkey,
  unregisterTransientHotkey: h.unregisterHotkey,
}));

vi.mock("../../ipc/ipcSecurity", () => ({
  assertTradeNotificationSender: vi.fn(),
  onAuthorized: vi.fn(),
}));

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../services/windowSecurity", () => ({
  hardenBrowserWindowNavigation: vi.fn(),
}));

vi.mock("../../services/wfmReviews", () => ({
  sendPlusRep: h.sendPlusRep,
}));

function sale(partner: string): TradeMatchPayload {
  return {
    kind: "order",
    orderId: `order-${partner}`,
    itemName: "Ash Prime Chassis",
    itemUrlName: "ash_prime_chassis",
    itemThumb: null,
    quantity: 1,
    platinum: 45,
    partner,
    type: "sale",
  };
}

async function setup() {
  vi.resetModules();
  h.windows.length = 0;
  h.hotkeys.clear();
  h.registerHotkey.mockReset();
  h.unregisterHotkey.mockReset();
  h.sendPlusRep.mockReset();
  h.registerHotkey.mockImplementation((accelerator: string, handler: () => void) => {
    h.hotkeys.set(accelerator, handler);
    return true;
  });
  h.unregisterHotkey.mockImplementation((accelerator: string) => {
    h.hotkeys.delete(accelerator);
  });

  const ctx = (await import("../../ipc/context")).default;
  ctx.tradeNotificationWindow = null;
  ctx.overlaySettings = {
    ...OVERLAY_SETTINGS_DEFAULTS,
    tradeRepHotkeyEnabled: true,
    tradeRepHotkey: "F9",
  } as unknown as typeof ctx.overlaySettings;
  const notifications = await import("../../ipc/tradeNotificationIpc");
  return { notifications };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("trade notification reputation lifecycle", () => {
  it("arms only after the renderer is ready", async () => {
    const { notifications } = await setup();

    notifications.showTradeNotification(sale("Buyer"), "closed");
    const win = h.windows[0];
    expect(h.registerHotkey).not.toHaveBeenCalled();

    win.finishLoad();

    expect(h.hotkeys.has("F9")).toBe(true);
    expect(win.sent.at(-1)).toMatchObject({
      channel: "trade-notification-show",
      payload: { rep: { partner: "Buyer", hotkey: "F9" } },
    });
  });

  it("does not offer or publish stale rep while another request is busy", async () => {
    let resolveFirst: (result: "sent") => void = () => {};
    const { notifications } = await setup();
    h.sendPlusRep.mockImplementationOnce(
      () => new Promise<"sent">((resolve) => (resolveFirst = resolve)),
    );
    notifications.showTradeNotification(sale("FirstBuyer"), "closed");
    const win = h.windows[0];
    win.finishLoad();

    h.hotkeys.get("F9")?.();
    await flushPromises();
    notifications.showTradeNotification(sale("SecondBuyer"), "closed");

    expect(win.sent.at(-1)).toMatchObject({
      channel: "trade-notification-show",
      payload: { rep: null },
    });
    expect(h.hotkeys.size).toBe(0);

    resolveFirst("sent");
    await flushPromises();

    expect(win.sent.some((message) => message.channel === "trade-notification-rep-result")).toBe(
      false,
    );
  });

  it("does not let an old result alter a replacement non-offer toast", async () => {
    let resolveFirst: (result: "sent") => void = () => {};
    const { notifications } = await setup();
    h.sendPlusRep.mockImplementationOnce(
      () => new Promise<"sent">((resolve) => (resolveFirst = resolve)),
    );
    notifications.showTradeNotification(sale("FirstBuyer"), "closed");
    const win = h.windows[0];
    win.finishLoad();
    h.hotkeys.get("F9")?.();
    await flushPromises();

    notifications.showTradeNotification(
      { ...sale("Seller"), orderId: "", type: "purchase" },
      "detected",
    );
    resolveFirst("sent");
    await flushPromises();

    expect(win.sent.at(-1)).toMatchObject({
      channel: "trade-notification-show",
      payload: { match: { partner: "Seller" }, rep: null },
    });
  });

  it("invalidates active and pending offers when settings hide the toast", async () => {
    const { notifications } = await setup();
    notifications.showTradeNotification(sale("Buyer"), "closed");
    const win = h.windows[0];

    notifications.hideTradeNotification();
    win.finishLoad();

    expect(win.hidden).toBe(true);
    expect(h.registerHotkey).not.toHaveBeenCalled();
    expect(win.sent).toEqual([]);

    notifications.showTradeNotification(sale("Buyer"), "closed");
    expect(h.hotkeys.has("F9")).toBe(true);
    notifications.hideTradeNotification();

    expect(h.unregisterHotkey).toHaveBeenCalledWith("F9");
    expect(h.hotkeys.size).toBe(0);
  });

  it("sends one timing contract with the rep result", async () => {
    const { notifications } = await setup();
    h.sendPlusRep.mockResolvedValueOnce("sent");
    notifications.showTradeNotification(sale("Buyer"), "closed");
    const win = h.windows[0];
    win.finishLoad();

    h.hotkeys.get("F9")?.();
    await flushPromises();

    expect(win.sent.at(-1)).toEqual({
      channel: "trade-notification-rep-result",
      payload: {
        result: "sent",
        partner: "Buyer",
        timing: { visibleMs: 4000, fadeMs: 400 },
      },
    });
  });
});
