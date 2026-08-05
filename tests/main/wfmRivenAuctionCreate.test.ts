import { beforeEach, describe, expect, it, vi } from "vitest";

import { request } from "../../services/wfmClient";
import * as wfmRivenSearch from "../../services/wfmRivenSearch";

vi.mock("../../services/wfmClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/wfmClient")>();
  return { ...actual, request: vi.fn() };
});

const requestMock = vi.mocked(request);

function baseOpts(): Parameters<typeof wfmRivenSearch.createRivenAuction>[0] {
  return {
    weaponSlug: "rubico",
    rivenName: "croni-visican",
    attributes: [
      { url_name: "critical_chance", value: 16, positive: true },
      { url_name: "recoil", value: -9.9, positive: true },
      { url_name: "recoil", value: 7.2, positive: false },
    ],
    rerolls: 3,
    masteryLevel: 14,
    polarity: "madurai",
    modRank: 0,
    buyoutPrice: null,
    startingPrice: 100,
    isPrivate: false,
    description: "",
  };
}

describe("createRivenAuction request body", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ payload: { auction: { id: "abc123" } } });
  });

  it("always includes buyout_price, null when unset (omitting it -> field_required)", async () => {
    const result = await wfmRivenSearch.createRivenAuction(baseOpts());
    expect(result).toEqual({ ok: true, auctionId: "abc123" });

    const body = requestMock.mock.calls[0][2]?.json as Record<string, unknown>;
    expect("buyout_price" in body).toBe(true);
    expect(body.buyout_price).toBeNull();
  });

  it("passes a positive buyout through and keeps signed attribute values", async () => {
    await wfmRivenSearch.createRivenAuction({ ...baseOpts(), buyoutPrice: 150 });

    const body = requestMock.mock.calls[0][2]?.json as Record<string, unknown>;
    expect(body.buyout_price).toBe(150);
    const item = body.item as { attributes: { value: number; positive: boolean }[] };
    expect(item.attributes.map((a) => a.value)).toEqual([16, -9.9, 7.2]);
  });
});
