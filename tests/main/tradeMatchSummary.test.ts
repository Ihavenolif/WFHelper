import { describe, expect, it } from "vitest";

import { summarizeMatches, summarizeTrade } from "../../config/shared/tradeMatch";
import type { TradeMatchPayload } from "../../config/shared/tradeMatch";
import type { TradeEvent } from "../../config/shared/statsTypes";

function trade(overrides: Partial<TradeEvent> = {}): TradeEvent {
  return {
    id: "trade-1",
    date: "2026-07-30T10:00:00.000Z",
    type: "sale",
    platChange: 45,
    partner: "Buyer",
    items: [
      {
        internalName: "",
        displayName: "Ash Prime Chassis",
        count: 1,
        direction: "given",
        wfmSlug: "ash_prime_chassis",
        wfmThumb: "/items/ash.png",
      },
      { internalName: "", displayName: "Platinum", count: 45, direction: "received" },
    ],
    ...overrides,
  };
}

function match(itemName: string, platinum: number): TradeMatchPayload {
  return {
    kind: "order",
    orderId: itemName,
    itemName,
    itemUrlName: null,
    itemThumb: null,
    quantity: 1,
    platinum,
    partner: "Buyer",
    type: "sale",
  };
}

describe("summarizeMatches", () => {
  it("passes a lone match through untouched", () => {
    expect(summarizeMatches([match("Boar Prime Stock", 30)], 30)).toEqual(
      match("Boar Prime Stock", 30),
    );
  });

  it("counts the rest and keeps the negotiated trade total", () => {
    const summary = summarizeMatches(
      [match("Boar Prime Stock", 30), match("Boar Prime Barrel", 25), match("Arcane Energize", 40)],
      80,
    );

    expect(summary?.itemName).toBe("Boar Prime Stock +2");
    expect(summary?.platinum).toBe(80);
  });

  it("returns null when nothing closed", () => {
    expect(summarizeMatches([], 0)).toBeNull();
  });
});

describe("summarizeTrade", () => {
  it("describes a sale by what was given away", () => {
    expect(summarizeTrade(trade())).toEqual({
      kind: "order",
      orderId: "",
      itemName: "Ash Prime Chassis",
      itemUrlName: "ash_prime_chassis",
      itemThumb: "/items/ash.png",
      quantity: 1,
      platinum: 45,
      partner: "Buyer",
      type: "sale",
    });
  });

  it("counts the remaining items instead of listing them all", () => {
    const summary = summarizeTrade(
      trade({
        items: [
          { internalName: "", displayName: "Braton Prime Barrel", count: 1, direction: "given" },
          { internalName: "", displayName: "Braton Prime Stock", count: 1, direction: "given" },
          { internalName: "", displayName: "Braton Prime Blueprint", count: 1, direction: "given" },
        ],
      }),
    );

    expect(summary.itemName).toBe("Braton Prime Barrel +2");
  });

  it("describes a purchase by what was received", () => {
    const summary = summarizeTrade(
      trade({
        type: "purchase",
        items: [
          { internalName: "", displayName: "Platinum", count: 20, direction: "given" },
          { internalName: "", displayName: "Serration", count: 1, direction: "received" },
        ],
      }),
    );

    expect(summary.itemName).toBe("Serration");
    expect(summary.type).toBe("purchase");
  });

  it("describes both sides of a barter without treating it as a purchase", () => {
    const summary = summarizeTrade(
      trade({
        type: "trade",
        platChange: 0,
        items: [
          { internalName: "", displayName: "Serration", count: 1, direction: "given" },
          { internalName: "", displayName: "Split Chamber", count: 1, direction: "received" },
        ],
      }),
    );

    expect(summary.itemName).toBe("Serration +1");
    expect(summary.platinum).toBe(0);
    expect(summary.type).toBe("trade");
  });

  it("still renders when nothing matched the traded side", () => {
    const summary = summarizeTrade(trade({ items: [], partner: undefined }));

    expect(summary.itemName).toBe("Trade");
    expect(summary.partner).toBe("");
  });
});
