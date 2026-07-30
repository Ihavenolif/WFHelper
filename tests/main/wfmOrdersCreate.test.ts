import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestV2, WfmApiError } from "../../services/wfmClient";
import * as wfmOrders from "../../services/wfmOrders";
import * as wfmSession from "../../services/wfmSession";

vi.mock("../../services/wfmClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/wfmClient")>();
  return { ...actual, requestV2: vi.fn() };
});

vi.mock("../../services/wfmSession", () => ({
  getInGameName: vi.fn(),
}));

const requestV2Mock = vi.mocked(requestV2);
const getInGameNameMock = vi.mocked(wfmSession.getInGameName);

const ORDER_RESPONSE = {
  data: { order: { id: "o1", type: "sell", platinum: 85, quantity: 1, visible: true } },
};

function perTradeError(kind: "notAllowed" | "required"): WfmApiError {
  return new WfmApiError(
    `WFMClient v2 API error: perTrade: app.field.${kind}`,
    "WFM_API_ERROR",
    400,
  );
}

describe("createOrder perTrade adaptivity", () => {
  beforeEach(() => {
    requestV2Mock.mockReset();
    wfmOrders.__resetWfmOrdersForTest();
  });

  it("omits perTrade by default (api 0.25 rejects it)", async () => {
    requestV2Mock.mockResolvedValueOnce(ORDER_RESPONSE);

    await wfmOrders.createOrder({ itemId: "i1", orderType: "sell", platinum: 85, quantity: 1 });

    expect(requestV2Mock).toHaveBeenCalledTimes(1);
    const body = requestV2Mock.mock.calls[0][2]?.json as Record<string, unknown>;
    expect(body).not.toHaveProperty("perTrade");
  });

  it("retries with perTrade when the server says app.field.required, then remembers", async () => {
    requestV2Mock
      .mockRejectedValueOnce(perTradeError("required"))
      .mockResolvedValueOnce(ORDER_RESPONSE)
      .mockResolvedValueOnce(ORDER_RESPONSE);

    await wfmOrders.createOrder({ itemId: "i1", orderType: "sell", platinum: 85, quantity: 3 });

    expect(requestV2Mock).toHaveBeenCalledTimes(2);
    const retryBody = requestV2Mock.mock.calls[1][2]?.json as Record<string, unknown>;
    expect(retryBody.perTrade).toBe(1);

    // Mode is cached: the next create sends perTrade on the first attempt.
    await wfmOrders.createOrder({ itemId: "i2", orderType: "sell", platinum: 10, quantity: 2 });
    const nextBody = requestV2Mock.mock.calls[2][2]?.json as Record<string, unknown>;
    expect(nextBody.perTrade).toBe(1);
  });

  it("flips back to omitting when a perTrade-sending create hits app.field.notAllowed", async () => {
    requestV2Mock
      .mockRejectedValueOnce(perTradeError("required"))
      .mockResolvedValueOnce(ORDER_RESPONSE)
      .mockRejectedValueOnce(perTradeError("notAllowed"))
      .mockResolvedValueOnce(ORDER_RESPONSE);

    await wfmOrders.createOrder({ itemId: "i0", orderType: "sell", platinum: 10, quantity: 1 });
    await wfmOrders.createOrder({ itemId: "i1", orderType: "sell", platinum: 85, quantity: 1 });

    expect(requestV2Mock).toHaveBeenCalledTimes(4);
    const retryBody = requestV2Mock.mock.calls[3][2]?.json as Record<string, unknown>;
    expect(retryBody).not.toHaveProperty("perTrade");
  });

  it("does not retry on unrelated errors", async () => {
    requestV2Mock.mockRejectedValueOnce(
      new WfmApiError("WFMClient v2 API error: platinum: app.field.invalid", "WFM_API_ERROR", 400),
    );

    await expect(
      wfmOrders.createOrder({ itemId: "i1", orderType: "sell", platinum: -1, quantity: 1 }),
    ).rejects.toThrow(/platinum/);
    expect(requestV2Mock).toHaveBeenCalledTimes(1);
  });

  it("retries with rank 0 when the server requires rank and none was given", async () => {
    requestV2Mock
      .mockRejectedValueOnce(
        new WfmApiError("WFMClient v2 API error: rank: app.field.required", "WFM_API_ERROR", 400),
      )
      .mockResolvedValueOnce(ORDER_RESPONSE);

    await wfmOrders.createOrder({ itemId: "i1", orderType: "sell", platinum: 85, quantity: 1 });

    expect(requestV2Mock).toHaveBeenCalledTimes(2);
    const retryBody = requestV2Mock.mock.calls[1][2]?.json as Record<string, unknown>;
    expect(retryBody.rank).toBe(0);
  });

  it("does not rank-retry when a rank was already sent", async () => {
    requestV2Mock.mockRejectedValueOnce(
      new WfmApiError("WFMClient v2 API error: rank: app.field.required", "WFM_API_ERROR", 400),
    );

    await expect(
      wfmOrders.createOrder({
        itemId: "i1",
        orderType: "sell",
        platinum: 85,
        quantity: 1,
        modRank: 3,
      }),
    ).rejects.toThrow(/rank/);
    expect(requestV2Mock).toHaveBeenCalledTimes(1);
  });

  it("recovers both calls when two concurrent first creates race the flag", async () => {
    requestV2Mock.mockImplementation(async (_method, _path, opts) => {
      const body = (opts?.json ?? {}) as Record<string, unknown>;
      if (!("perTrade" in body)) throw perTradeError("required");
      return ORDER_RESPONSE;
    });

    const [a, b] = await Promise.all([
      wfmOrders.createOrder({ itemId: "i1", orderType: "sell", platinum: 85, quantity: 1 }),
      wfmOrders.createOrder({ itemId: "i2", orderType: "sell", platinum: 10, quantity: 2 }),
    ]);

    expect(a.id).toBe("o1");
    expect(b.id).toBe("o1");
    expect(requestV2Mock).toHaveBeenCalledTimes(4);
    const bodies = requestV2Mock.mock.calls.map((call) => call[2]?.json as Record<string, unknown>);
    expect(bodies[0]).not.toHaveProperty("perTrade");
    expect(bodies[1]).not.toHaveProperty("perTrade");
    expect(bodies[2]).toHaveProperty("perTrade");
    expect(bodies[3]).toHaveProperty("perTrade");
  });

  it("applies perTrade and rank fixes across successive retries", async () => {
    requestV2Mock
      .mockRejectedValueOnce(perTradeError("required"))
      .mockRejectedValueOnce(
        new WfmApiError("WFMClient v2 API error: rank: app.field.required", "WFM_API_ERROR", 400),
      )
      .mockResolvedValueOnce(ORDER_RESPONSE);

    await wfmOrders.createOrder({ itemId: "i1", orderType: "sell", platinum: 85, quantity: 1 });

    expect(requestV2Mock).toHaveBeenCalledTimes(3);
    const finalBody = requestV2Mock.mock.calls[2][2]?.json as Record<string, unknown>;
    expect(finalBody.perTrade).toBe(1);
    expect(finalBody.rank).toBe(0);
  });
});

describe("getMyOrders normalization", () => {
  beforeEach(() => {
    requestV2Mock.mockReset();
    getInGameNameMock.mockReturnValue("TestUser");
  });

  it("preserves the listing perTrade bundle", async () => {
    requestV2Mock.mockResolvedValue({
      data: [
        {
          id: "bundle-order",
          type: "sell",
          platinum: 5,
          quantity: 12,
          perTrade: 6,
          visible: true,
          item: { item_name: "Vitus Essence", url_name: "vitus_essence" },
        },
      ],
    });

    await expect(wfmOrders.getMyOrders()).resolves.toMatchObject({
      sell: [{ id: "bundle-order", quantity: 12, perTrade: 6 }],
      buy: [],
    });
  });
});
