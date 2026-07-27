import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scripted: [] as Array<{ status: number; headers?: Record<string, string>; body?: string }>,
  requests: [] as Array<Record<string, string>>,
}));

vi.mock("node:https", () => {
  const request = (
    options: { headers: Record<string, string> },
    cb: (res: unknown) => void,
  ) => {
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

import { request, __test__ } from "../../services/wfmClient";

function freshSolver() {
  return vi.fn(async () => {
    __test__.setClearance("cf_clearance=fresh", "UA-new");
    return true;
  });
}

describe("stale Cloudflare clearance recovery", () => {
  beforeEach(() => {
    state.scripted.length = 0;
    state.requests.length = 0;
    __test__.setClearance(null, null);
    __test__.setChallengeSolver(null);
    __test__.resetClearanceCooldown();
  });

  it("re-solves and retries when a held clearance gets 403", async () => {
    __test__.setClearance("cf_clearance=stale", "UA-old");
    const solver = freshSolver();
    __test__.setChallengeSolver(solver);
    state.scripted.push(
      { status: 403, body: "error code: 1020" },
      { status: 200, body: '{"ok":true}' },
    );

    await expect(request("GET", "/items")).resolves.toEqual({ ok: true });

    expect(solver).toHaveBeenCalledTimes(1);
    expect(state.requests).toHaveLength(2);
    expect(state.requests[0]["Cookie"]).toContain("cf_clearance=stale");
    expect(state.requests[0]["User-Agent"]).toBe("UA-old");
    expect(state.requests[1]["Cookie"]).toContain("cf_clearance=fresh");
    expect(state.requests[1]["Cookie"]).not.toContain("stale");
    expect(state.requests[1]["User-Agent"]).toBe("UA-new");
  });

  it("solves at most once per cooldown window", async () => {
    __test__.setClearance("cf_clearance=stale", "UA-old");
    const solver = freshSolver();
    __test__.setChallengeSolver(solver);

    state.scripted.push({ status: 403, body: "blocked" }, { status: 403, body: "blocked" });
    await expect(request("GET", "/items")).rejects.toMatchObject({
      code: "WFM_API_ERROR",
      status: 403,
    });
    expect(solver).toHaveBeenCalledTimes(1);

    state.scripted.push({ status: 403, body: "blocked" });
    await expect(request("GET", "/items")).rejects.toMatchObject({ status: 403 });
    expect(solver).toHaveBeenCalledTimes(1);
    expect(state.requests).toHaveLength(3);
  });

  it("leaves plain API 403s alone when no clearance is held", async () => {
    const solver = freshSolver();
    __test__.setChallengeSolver(solver);
    state.scripted.push({ status: 403, body: '{"error":"forbidden"}' });

    await expect(request("GET", "/items")).rejects.toMatchObject({ status: 403 });
    expect(solver).not.toHaveBeenCalled();
    expect(state.requests).toHaveLength(1);
  });

  it("solves on a Cloudflare challenge response even without a held clearance", async () => {
    const solver = freshSolver();
    __test__.setChallengeSolver(solver);
    state.scripted.push(
      {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
        body: "<title>Just a moment...</title>",
      },
      { status: 200, body: '{"ok":true}' },
    );

    await expect(request("GET", "/items")).resolves.toEqual({ ok: true });
    expect(solver).toHaveBeenCalledTimes(1);
  });
});
