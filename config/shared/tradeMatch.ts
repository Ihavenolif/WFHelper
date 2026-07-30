import type { TradeEvent, TradeType } from "./statsTypes";

export interface TradeMatchPayload {
  /** Regular market order, or a riven auction (closed through a different route). */
  kind: "order" | "contract";
  orderId: string;
  itemName: string;
  itemUrlName: string | null;
  itemThumb: string | null;
  quantity: number;
  platinum: number;
  partner: string;
  type: TradeType;
}

/** Listing closed, nothing matched, close rejected, or never checked. */
export type TradeNotificationStatus = "closed" | "no-match" | "close-failed" | "detected";

/** Toast content for a trade that closed no listing - built from the trade. */
export function summarizeTrade(trade: TradeEvent): TradeMatchPayload {
  const sideItems = trade.items.filter((item) =>
    trade.type === "sale" ? item.direction === "given" : item.direction === "received",
  );
  const items = sideItems.length > 0 ? sideItems : trade.items;
  const first = items[0];
  const extra = items.length - 1;
  return {
    kind: "order",
    orderId: "",
    itemName: first ? `${first.displayName}${extra > 0 ? ` +${extra}` : ""}` : "Trade",
    itemUrlName: first?.wfmSlug ?? null,
    itemThumb: first?.wfmThumb ?? null,
    quantity: first?.count ?? 1,
    platinum: trade.platChange,
    partner: trade.partner ?? "",
    type: trade.type,
  };
}
