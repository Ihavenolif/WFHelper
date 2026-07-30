/**
 * Matches a completed in-game trade to the user's active WFM orders and closes
 * the best match - by item name, tiebroken on platinum then rank proximity.
 */

import { withScope } from "./logger";
import * as wfmOrders from "./wfmOrders";
import type { NormalisedOrder } from "./wfmOrders";
import * as wfmSession from "./wfmSession";
import * as wfmCatalog from "./wfmCatalog";
import * as wfmContracts from "./wfmContracts";
import { lookupTradedCatalogItem, parseTradedItemName } from "./tradeItemName";
import { normalizeForSearch, normalizeForSlug } from "../config/shared/textNormalize";
import type { TradeType, TradeDirection } from "../config/shared/statsTypes";
import type { TradeMatchPayload } from "../config/shared/tradeMatch";

const log = withScope("tradeWfmMatcher");

interface ParsedTradeForMatching {
  partner: string;
  platChange: number;
  type: TradeType;
  items: Array<{ displayName: string; count: number; direction: TradeDirection }>;
}

type WfmTradeMatch = TradeMatchPayload;

/** Prevent double-close on the same order within a short window */
const _recentlyClosedOrders = new Map<string, number>();
const CLOSE_DEDUP_MS = 30_000;
const CONTRACT_PAGE_LIMIT = 100;

function normalizeName(name: string): string {
  return normalizeForSearch(name.replace(/ Blueprint$/i, ""));
}

function rankScore(order: NormalisedOrder, tradedRank: number | null): number {
  if (tradedRank == null) return order.modRank ?? -1;
  return Math.abs((order.modRank ?? 0) - tradedRank);
}

function cleanupRecentlyClosed(): void {
  const now = Date.now();
  for (const [id, ts] of _recentlyClosedOrders) {
    if (now - ts > CLOSE_DEDUP_MS) _recentlyClosedOrders.delete(id);
  }
}

/**
 * Attempt to match a completed trade against the user's active WFM orders.
 * Returns the matched order info, or null if no match found.
 */
export async function matchTradeToOrder(
  trade: ParsedTradeForMatching,
): Promise<WfmTradeMatch | null> {
  // Guard: must be logged in to WFM
  if (!wfmSession.getToken()) {
    log.info("[Matcher] Skipping - not logged in to WFM");
    return null;
  }

  // Determine which items to match:
  // For sales, we match items we GAVE (the buyer receives them)
  // For purchases, we match items we RECEIVED
  const relevantItems = trade.items.filter((i) =>
    trade.type === "sale" ? i.direction === "given" : i.direction === "received",
  );

  if (relevantItems.length === 0) {
    log.info("[Matcher] No relevant items to match");
    return null;
  }

  cleanupRecentlyClosed();

  // Unveiled rivens live in auctions, so they never appear in the order list.
  const rivenMatch = await matchRivenContract(relevantItems, trade);
  if (rivenMatch) return rivenMatch;

  // Fetch user's current orders
  let orders: { sell: NormalisedOrder[]; buy: NormalisedOrder[] };
  try {
    orders = await wfmOrders.getMyOrders();
  } catch (err) {
    log.warn("[Matcher] Failed to fetch orders:", String(err));
    return null;
  }

  const candidateOrders = trade.type === "sale" ? orders.sell : orders.buy;
  if (candidateOrders.length === 0) {
    log.info(`[Matcher] No ${trade.type === "sale" ? "sell" : "buy"} orders to match against`);
    return null;
  }

  // Sets first: the buyer receives the individual parts, so a full-set sale
  // must close the set listing, not a lone part listing that happens to match.
  const tradedCounts = new Map<string, number>();
  for (const item of relevantItems) {
    const catalogItem = lookupTradedCatalogItem(item.displayName);
    if (catalogItem?.url_name) {
      const slug = catalogItem.url_name;
      tradedCounts.set(slug, (tradedCounts.get(slug) || 0) + item.count);
    }
  }
  const setResult = await matchSetOrder(candidateOrders, tradedCounts, trade);
  if (setResult.match) return setResult.match;
  if (setResult.unavailable) {
    log.warn("[Matcher] Set metadata unavailable - skipping automatic order closure");
    return null;
  }

  // Match the first traded item that resolves to an active order.
  for (const item of relevantItems) {
    const parsed = parseTradedItemName(item.displayName);
    const normalizedItem = normalizeName(parsed.baseName);
    if (!normalizedItem) continue;

    // Also try catalog lookup to get the canonical WFM item name
    const catalogItem = lookupTradedCatalogItem(item.displayName);

    // Filter orders that match this item by name
    const matching = candidateOrders.filter((order: NormalisedOrder) => {
      if (_recentlyClosedOrders.has(order.id)) return false;

      const orderItemName = normalizeName(String(order.itemName || ""));
      if (orderItemName === normalizedItem) return true;

      // Also try matching via url_name if we resolved the catalog
      if (catalogItem?.url_name && order.itemUrlName === catalogItem.url_name) return true;

      return false;
    });

    if (matching.length === 0) continue;

    // Sort by platinum proximity, rank proximity, then quantity.
    matching.sort((a: NormalisedOrder, b: NormalisedOrder) => {
      const platDiffA = Math.abs((a.platinum || 0) - trade.platChange);
      const platDiffB = Math.abs((b.platinum || 0) - trade.platChange);
      if (platDiffA !== platDiffB) return platDiffA - platDiffB;

      // The traded rank when the dialog carried one, lowest rank otherwise.
      const rankA = rankScore(a, parsed.rank);
      const rankB = rankScore(b, parsed.rank);
      if (rankA !== rankB) return rankA - rankB;

      // Quantity (lower is better)
      return (a.quantity || 1) - (b.quantity || 1);
    });

    const bestMatch = matching[0];
    // A single trade slot can hold a stack, so the only real bound is the
    // order's own quantity - you can't close more than you listed.
    const closeQty = Math.min(item.count, bestMatch.quantity || 1);

    return {
      kind: "order",
      orderId: bestMatch.id,
      itemName: bestMatch.itemName || item.displayName,
      itemUrlName: bestMatch.itemUrlName || catalogItem?.url_name || null,
      itemThumb: bestMatch.itemThumb || null,
      quantity: closeQty,
      platinum: bestMatch.platinum || 0,
      partner: trade.partner,
      type: trade.type,
    };
  }

  const tradedSummary = relevantItems
    .map((item) => `"${item.displayName}" x${item.count}`)
    .join(", ");
  log.info(
    `[Matcher] No matching WFM orders found for traded items: ${tradedSummary} ` +
      `(${candidateOrders.length} ${trade.type === "sale" ? "sell" : "buy"} order(s) checked)`,
  );
  return null;
}

/** Close the riven auction for a sold unveiled riven ("<weapon> <suffix>"). */
async function matchRivenContract(
  items: ParsedTradeForMatching["items"],
  trade: ParsedTradeForMatching,
): Promise<WfmTradeMatch | null> {
  if (trade.type !== "sale") return null;
  const rivens = items
    .map((item) => parseTradedItemName(item.displayName))
    .filter((parsed) => parsed.riven);
  if (rivens.length !== 1) return null;
  const { baseName, riven } = rivens[0];
  if (!riven) return null;

  let contracts: Awaited<ReturnType<typeof wfmContracts.getMyContracts>>["contracts"];
  try {
    contracts = (await wfmContracts.getMyContracts({ limit: CONTRACT_PAGE_LIMIT })).contracts;
  } catch (err) {
    log.warn("[Matcher] Failed to fetch riven auctions:", String(err));
    return null;
  }

  const weaponSlug = normalizeForSlug(riven.weapon);
  const sameWeapon = contracts.filter(
    (contract) =>
      !_recentlyClosedOrders.has(contract.id) &&
      contract.weaponUrlName &&
      normalizeForSlug(contract.weaponUrlName) === weaponSlug,
  );
  // The generated suffix identifies the roll; weapon alone only decides it when
  // there is exactly one auction for that weapon.
  const suffixSlug = normalizeForSlug(riven.suffix);
  const exact = sameWeapon.filter(
    (contract) => contract.rivenSuffix && normalizeForSlug(contract.rivenSuffix) === suffixSlug,
  );
  const best = exact[0] || (sameWeapon.length === 1 ? sameWeapon[0] : null);
  if (!best) {
    log.info(`[Matcher] No riven auction matched "${baseName}" (${sameWeapon.length} for weapon)`);
    return null;
  }

  return {
    kind: "contract",
    orderId: best.id,
    itemName: baseName,
    itemUrlName: best.weaponUrlName,
    itemThumb: best.itemThumb,
    quantity: 1,
    platinum: trade.platChange || best.platinum,
    partner: trade.partner,
    type: trade.type,
  };
}

/** Resolve traded parts instead of walking every active set order. */
async function matchSetOrder(
  candidateOrders: NormalisedOrder[],
  tradedCounts: Map<string, number>,
  trade: ParsedTradeForMatching,
): Promise<{ match: WfmTradeMatch | null; unavailable: boolean }> {
  if (tradedCounts.size < 2) return { match: null, unavailable: false };

  const setOrders = new Map<string, NormalisedOrder[]>();
  for (const order of candidateOrders) {
    if (_recentlyClosedOrders.has(order.id)) continue;
    const slug = order.itemUrlName || "";
    if (!slug.endsWith("_set")) continue;
    const matchingOrders = setOrders.get(slug);
    if (matchingOrders) matchingOrders.push(order);
    else setOrders.set(slug, [order]);
  }
  if (setOrders.size === 0) return { match: null, unavailable: false };

  let unavailable = false;
  const definitions = new Map<
    string,
    { kind: "set"; setSlug: string; parts: Array<{ slug: string; quantityInSet: number }> }
  >();
  for (const slug of tradedCounts.keys()) {
    const result = await wfmCatalog.resolveSetMembership(slug);
    if (result.kind === "unavailable") {
      unavailable = true;
    } else if (result.kind === "set" && setOrders.has(result.setSlug)) {
      definitions.set(result.setSlug, result);
    }
  }

  const covered: Array<{ order: NormalisedOrder; setsCovered: number }> = [];
  for (const definition of definitions.values()) {
    let setsCovered = Infinity;
    for (const part of definition.parts) {
      const have = tradedCounts.get(part.slug) || 0;
      setsCovered = Math.min(setsCovered, Math.floor(have / part.quantityInSet));
    }
    if (Number.isFinite(setsCovered) && setsCovered >= 1) {
      for (const order of setOrders.get(definition.setSlug) || []) {
        covered.push({ order, setsCovered });
      }
    }
  }
  if (covered.length === 0) return { match: null, unavailable };

  covered.sort(
    (a, b) =>
      Math.abs((a.order.platinum || 0) - trade.platChange) -
      Math.abs((b.order.platinum || 0) - trade.platChange),
  );
  const best = covered[0];
  return {
    match: {
      kind: "order",
      orderId: best.order.id,
      itemName: best.order.itemName || "(set)",
      itemUrlName: best.order.itemUrlName || null,
      itemThumb: best.order.itemThumb || null,
      quantity: Math.min(best.setsCovered, best.order.quantity || 1),
      platinum: best.order.platinum || 0,
      partner: trade.partner,
      type: trade.type,
    },
    unavailable: false,
  };
}

/**
 * Close the matched WFM order and mark it as recently closed to prevent duplicates.
 */
export async function closeMatchedOrder(match: WfmTradeMatch): Promise<boolean> {
  try {
    log.info(`[Matcher] Closing ${match.kind} ${match.orderId} (${match.itemName})`);
    if (match.kind === "contract") await wfmContracts.closeContract(match.orderId);
    else await wfmOrders.closeOrder(match.orderId, match.quantity);
    _recentlyClosedOrders.set(match.orderId, Date.now());
    log.info(`[Matcher] ✓ Order ${match.orderId} closed successfully`);
    return true;
  } catch (err) {
    log.warn(`[Matcher] Failed to close order ${match.orderId}:`, String(err));
    return false;
  }
}
