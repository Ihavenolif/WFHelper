import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scripted: [] as Array<{ status: number; headers?: Record<string, string>; body?: string }>,
  requests: [] as Array<Record<string, string>>,
}));

vi.mock("node:https", () => {
  const request = (options: { headers: Record<string, string> }, cb: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
    req.setHeader = () => {};
    req.write = () => {};
    req.destroy = (err: Error) => req.emit("error", err);
    req.end = () => {
      state.requests.push({ ...options.headers });
      const next = state.scripted.shift();
      if (!next) {
        queueMicrotask(() => req.emit("error", new Error("no scripted response left")));
        return;
      }
      const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
      res.statusCode = next.status;
      res.headers = next.headers ?? {};
      res.destroy = () => {};
      queueMicrotask(() => {
        cb(res);
        if (next.body) res.emit("data", Buffer.from(next.body, "utf-8"));
        res.emit("end");
      });
    };
    return req;
  };
  return { default: { request }, request };
});

import {
  request,
  requestV2,
  setTokenProvider,
  setTokenRotationHandler,
  updateCsrfFromToken,
  clearCsrfToken,
  __test__,
} from "../../services/wfmClient";

const CSRF_CLAIM = "csrf-claim-abc";
const FAKE_JWT = `h.${Buffer.from(JSON.stringify({ csrf_token: CSRF_CLAIM })).toString("base64url")}.s`;

describe("header-only WFM auth", () => {
  beforeEach(() => {
    state.scripted.length = 0;
    state.requests.length = 0;
    __test__.resetHeaderAuthForTest();
    __test__.setClearanceForTest(null, null);
    __test__.resetClearanceCooldownForTest();
    clearCsrfToken();
    setTokenProvider(() => FAKE_JWT);
  });

  afterEach(() => {
    setTokenProvider(() => null);
    setTokenRotationHandler(null);
  });

  it("sends Bearer-only auth on v2 mutations - no cookie, no csrf", async () => {
    state.scripted.push({ status: 200, body: '{"ok":true}' });

    await requestV2("PATCH", "/order/abc", { json: { visible: true } });

    expect(state.requests).toHaveLength(1);
    const headers = state.requests[0];
    expect(headers["Authorization"]).toBe(`Bearer ${FAKE_JWT}`);
    expect(headers["auth_type"]).toBe("header");
    expect(headers["Cookie"]).toBeUndefined();
    expect(headers["X-CSRFToken"]).toBeUndefined();
    expect(headers["Origin"]).toBeUndefined();
  });

  it("uses the JWT scheme on v1 requests", async () => {
    state.scripted.push({ status: 200, body: '{"ok":true}' });

    await request("GET", "/auctions/search?type=riven");

    expect(state.requests[0]["Authorization"]).toBe(`JWT ${FAKE_JWT}`);
    expect(state.requests[0]["Cookie"]).toBeUndefined();
  });

  it("falls back to cookie+csrf when header auth is rejected, then latches", async () => {
    updateCsrfFromToken(FAKE_JWT);
    state.scripted.push(
      { status: 403, body: '{"error":"forbidden"}' },
      { status: 200, body: '{"ok":true}' },
      { status: 200, body: '{"ok":true}' },
    );

    await requestV2("POST", "/order", { json: { itemId: "x" } });

    expect(state.requests).toHaveLength(2);
    expect(state.requests[0]["auth_type"]).toBe("header");
    const fallback = state.requests[1];
    expect(fallback["Cookie"]).toBe(`JWT=${FAKE_JWT}`);
    expect(fallback["X-CSRFToken"]).toBe(CSRF_CLAIM);
    expect(fallback["Authorization"]).toBe(`JWT ${FAKE_JWT}`);

    // Latched: the next call goes straight to the cookie path.
    await requestV2("POST", "/order", { json: { itemId: "y" } });
    expect(state.requests).toHaveLength(3);
    expect(state.requests[2]["Cookie"]).toBe(`JWT=${FAKE_JWT}`);
    expect(state.requests[2]["auth_type"]).toBeUndefined();
  });

  it("does not latch when the cookie fallback also fails", async () => {
    updateCsrfFromToken(FAKE_JWT);
    state.scripted.push(
      { status: 401, body: '{"error":"unauthorized"}' },
      { status: 401, body: '{"error":"unauthorized"}' },
      { status: 200, body: '{"ok":true}' },
    );

    await expect(requestV2("GET", "/me")).rejects.toMatchObject({ code: "WFM_UNAUTHORIZED" });

    // Token was the problem, not the auth style - header auth stays first.
    await requestV2("GET", "/me");
    expect(state.requests[2]["auth_type"]).toBe("header");
  });

  it("adopts rotated tokens from response Authorization headers", async () => {
    const rotated = vi.fn();
    setTokenRotationHandler(rotated);
    state.scripted.push({
      status: 200,
      headers: { authorization: "Bearer rotated-token" },
      body: '{"ok":true}',
    });

    await requestV2("GET", "/me");

    expect(rotated).toHaveBeenCalledWith("rotated-token");
  });

  it("keeps anonymous requests free of auth headers", async () => {
    setTokenProvider(() => null);
    state.scripted.push({ status: 200, body: '{"ok":true}' });

    await requestV2("GET", "/items");

    expect(state.requests[0]["Authorization"]).toBeUndefined();
    expect(state.requests[0]["Cookie"]).toBeUndefined();
  });
});
