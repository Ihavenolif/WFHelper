import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Mirror WFM: it echoes back the deadline it derived from `duration`.
const setStatus = vi.fn(async (status: string, duration: number | null) => ({
  status,
  statusUntil: duration ? new Date(Date.now() + duration * 1000).toISOString() : null,
}));
const getToken = vi.fn(() => "token" as string | null);
const getPublicStatus = vi.fn(async () => null as string | null);

vi.mock("../../services/wfmSession", () => ({
  setStatus: (status: string, duration: number | null) => setStatus(status, duration),
  getToken: () => getToken(),
  getPublicStatus: () => getPublicStatus(),
}));

type Presence = typeof import("../../services/wfmPresence");

async function freshPresence(): Promise<Presence> {
  vi.resetModules();
  setStatus.mockClear();
  getToken.mockReturnValue("token");
  return import("../../services/wfmPresence");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("wfmPresence hold duration", () => {
  it("asks WFM to expire the status instead of running the clock locally", async () => {
    const presence = await freshPresence();
    presence.setOptions({ autoIngameEnabled: false, holdMinutes: 30 });

    await presence.setManualStatus("online");

    expect(setStatus).toHaveBeenCalledWith("online", 1800);
    expect(presence.getState().expiresAt).toBe(Date.now() + 1800_000);
  });

  it("sends no duration for invisible or a zero hold", async () => {
    const presence = await freshPresence();
    presence.setOptions({ autoIngameEnabled: false, holdMinutes: 30 });

    await presence.setManualStatus("invisible");
    expect(setStatus).toHaveBeenLastCalledWith("invisible", null);
    expect(presence.getState().expiresAt).toBeNull();

    presence.setOptions({ autoIngameEnabled: false, holdMinutes: 0 });
    await presence.setManualStatus("online");
    expect(setStatus).toHaveBeenLastCalledWith("online", null);
    expect(presence.getState().expiresAt).toBeNull();
  });

  it("re-sends the status when the duration changes, as the site does", async () => {
    const presence = await freshPresence();
    presence.setOptions({ autoIngameEnabled: false, holdMinutes: 30 });
    await presence.setManualStatus("online");

    presence.setOptions({ autoIngameEnabled: false, holdMinutes: 60 });
    await vi.advanceTimersByTimeAsync(0);
    expect(setStatus).toHaveBeenLastCalledWith("online", 3600);
    expect(presence.getState().expiresAt).toBe(Date.now() + 3600_000);
  });

  it("settles to invisible locally once the deadline passes", async () => {
    const presence = await freshPresence();
    presence.setOptions({ autoIngameEnabled: false, holdMinutes: 30 });
    await presence.setManualStatus("online");
    setStatus.mockClear();

    await vi.advanceTimersByTimeAsync(1800_000);
    expect(presence.getState()).toMatchObject({ status: "invisible", expiresAt: null });
    // WFM already dropped it - we must not send a redundant set.
    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe("wfmPresence server pushes", () => {
  it("adopts the status and deadline WFM announces", async () => {
    const presence = await freshPresence();
    const until = new Date(Date.now() + 600_000).toISOString();

    presence.applyServerStatus({ status: "ingame", statusUntil: until });

    expect(presence.getState()).toMatchObject({
      status: "ingame",
      expiresAt: Date.parse(until),
    });
  });

  it("ignores payloads that carry no usable status", async () => {
    const presence = await freshPresence();
    presence.applyServerStatus({ status: "offline" });
    presence.applyServerStatus(null);

    expect(presence.getState().status).toBeNull();
  });
});

describe("wfmPresence auto in-game", () => {
  it("sets ingame on game launch and restores the previous status on exit", async () => {
    const presence = await freshPresence();
    presence.setOptions({ autoIngameEnabled: true, holdMinutes: 0 });
    await presence.setManualStatus("online");

    await presence.syncGameRunning(true);
    expect(setStatus).toHaveBeenLastCalledWith("ingame", null);
    expect(presence.getState()).toMatchObject({ status: "ingame", autoActive: true });

    await presence.syncGameRunning(false);
    expect(setStatus).toHaveBeenLastCalledWith("online", null);
    expect(presence.getState()).toMatchObject({ status: "online", autoActive: false });
  });

  it("stays put while the toggle is off", async () => {
    const presence = await freshPresence();
    presence.setOptions({ autoIngameEnabled: false, holdMinutes: 0 });
    await presence.setManualStatus("invisible");
    setStatus.mockClear();

    await presence.syncGameRunning(true);
    expect(setStatus).not.toHaveBeenCalled();
    expect(presence.getState().status).toBe("invisible");
  });

  it("restores the status when the toggle is switched off mid-game", async () => {
    const presence = await freshPresence();
    presence.setOptions({ autoIngameEnabled: true, holdMinutes: 0 });
    await presence.setManualStatus("online");
    await presence.syncGameRunning(true);

    presence.setOptions({ autoIngameEnabled: false, holdMinutes: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(setStatus).toHaveBeenLastCalledWith("online", null);
    expect(presence.getState()).toMatchObject({ status: "online", autoActive: false });
  });

  it("holds the auto status open-ended, then re-applies the hold on game exit", async () => {
    const presence = await freshPresence();
    presence.setOptions({ autoIngameEnabled: true, holdMinutes: 30 });
    await presence.setManualStatus("online");

    await presence.syncGameRunning(true);
    // The game running is the bound, so it must not expire mid-session.
    expect(setStatus).toHaveBeenLastCalledWith("ingame", null);
    expect(presence.getState().expiresAt).toBeNull();

    await presence.syncGameRunning(false);
    expect(setStatus).toHaveBeenLastCalledWith("online", 1800);
    expect(presence.getState().expiresAt).toBe(Date.now() + 1800_000);
  });

  it("hides rather than guessing when the pre-launch status is unknown", async () => {
    const presence = await freshPresence();
    presence.setOptions({ autoIngameEnabled: true, holdMinutes: 0 });

    await presence.syncGameRunning(true);
    expect(setStatus).toHaveBeenLastCalledWith("ingame", null);

    await presence.syncGameRunning(false);
    expect(setStatus).toHaveBeenLastCalledWith("invisible", null);
  });

  it("does nothing while logged out", async () => {
    const presence = await freshPresence();
    getToken.mockReturnValue(null);
    setStatus.mockClear();

    await presence.syncGameRunning(true);
    expect(setStatus).not.toHaveBeenCalled();
  });
});
