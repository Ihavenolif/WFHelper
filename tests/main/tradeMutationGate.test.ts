import { beforeEach, describe, expect, it, vi } from "vitest";

const showMessageBox = vi.fn();

vi.mock("electron", () => ({
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) },
}));

import ctx from "../../ipc/context";
import { confirmTradeMutation, __test__ } from "../../ipc/tradeMutationGate";
import type { IpcMainInvokeEvent } from "electron";

const WEB_CONTENTS_ID = 7;

function fakeWindow(): typeof ctx.mainWindow {
  return {
    isDestroyed: () => false,
    isFocused: () => true,
    webContents: { id: WEB_CONTENTS_ID },
  } as unknown as typeof ctx.mainWindow;
}

function fakeEvent(senderId = WEB_CONTENTS_ID): IpcMainInvokeEvent {
  return { sender: { id: senderId } } as unknown as IpcMainInvokeEvent;
}

const CONFIRMATION = { title: "t", message: "m", detail: "d" };

describe("confirmTradeMutation", () => {
  beforeEach(() => {
    showMessageBox.mockReset();
    __test__.resetSessionApprovalForTest();
    ctx.mainWindow = fakeWindow();
  });

  it("asks once, then lets the whole session through silently", async () => {
    showMessageBox.mockResolvedValue({ response: 1 });

    expect(await confirmTradeMutation(fakeEvent(), CONFIRMATION)).toBe(true);
    expect(await confirmTradeMutation(fakeEvent(), CONFIRMATION)).toBe(true);
    expect(await confirmTradeMutation(fakeEvent(), CONFIRMATION)).toBe(true);

    expect(showMessageBox).toHaveBeenCalledTimes(1);
    // Cancel stays the default on the one prompt that is shown.
    const options = showMessageBox.mock.calls[0][1] as { defaultId: number; cancelId: number };
    expect(options.defaultId).toBe(0);
    expect(options.cancelId).toBe(0);
  });

  it("keeps asking while the user cancels", async () => {
    showMessageBox.mockResolvedValue({ response: 0 });

    expect(await confirmTradeMutation(fakeEvent(), CONFIRMATION)).toBe(false);
    expect(await confirmTradeMutation(fakeEvent(), CONFIRMATION)).toBe(false);

    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });

  it("still rejects foreign senders after session approval", async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    expect(await confirmTradeMutation(fakeEvent(), CONFIRMATION)).toBe(true);

    expect(await confirmTradeMutation(fakeEvent(WEB_CONTENTS_ID + 1), CONFIRMATION)).toBe(false);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it("still requires window focus after session approval", async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    expect(await confirmTradeMutation(fakeEvent(), CONFIRMATION)).toBe(true);

    ctx.mainWindow = {
      ...fakeWindow(),
      isFocused: () => false,
    } as unknown as typeof ctx.mainWindow;
    expect(await confirmTradeMutation(fakeEvent(), CONFIRMATION)).toBe(false);
  });
});
