import { writable } from "svelte/store";
import type {
  MarketTab,
  OrderModalState,
  WfmContractsResult,
  WfmOrder,
  WfmOrdersResult,
  WfmSession,
  WfmStatus,
} from "../types/market.js";

export const marketSession = writable<WfmSession>({
  loggedIn: false,
  userName: null,
  platform: "pc",
});

export const marketOrders = writable<WfmOrdersResult>({ sell: [], buy: [] });
export const marketContracts = writable<WfmContractsResult>({
  contracts: [],
  page: 1,
  totalPages: null,
  hasMore: false,
});

interface MarketViewState {
  typeTab: MarketTab;
  status: WfmStatus | null;
  ordersLastFetch: number;
  contractsLastFetch: number;
}

const DEFAULT_MARKET_VIEW_STATE: MarketViewState = {
  typeTab: "sell",
  status: null,
  ordersLastFetch: 0,
  contractsLastFetch: 0,
};

export const marketViewState = writable<MarketViewState>({ ...DEFAULT_MARKET_VIEW_STATE });
export const marketSelected = writable<Set<string>>(new Set());

/**
 * Mutate `marketSelected` via callback with the `new Set(...)` replacement
 * handled here - in-place Set mutation keeps the reference, so subscribers
 * never fire.
 */
export function mutateMarketSelected(mutator: (s: Set<string>) => void): void {
  marketSelected.update((s) => {
    mutator(s);
    return new Set(s);
  });
}

export function setMarketViewState(patch: Partial<MarketViewState>): void {
  marketViewState.update((state) => ({ ...state, ...patch }));
}

export function resetMarketFetchTimes(): void {
  setMarketViewState({ ordersLastFetch: 0, contractsLastFetch: 0 });
}

function dropClosedQuantity(entries: WfmOrder[], orderId: string, quantity: number): WfmOrder[] {
  return entries.flatMap((entry) => {
    if (entry.id !== orderId) return [entry];
    const remaining = (entry.quantity ?? 0) - quantity;
    return remaining > 0 ? [{ ...entry, quantity: remaining }] : [];
  });
}

/** A trade already closed this listing on WFM; mirror it so an open My Orders
 *  list drops the row now. Local math is a guess, so refetch on the next visit. */
export function applyClosedWfmListing(match: {
  kind: "order" | "contract";
  orderId: string;
  quantity: number;
}): void {
  if (!match.orderId) return;

  if (match.kind === "contract") {
    marketContracts.update((state) => ({
      ...state,
      contracts: state.contracts.filter((contract) => contract.id !== match.orderId),
    }));
  } else {
    marketOrders.update((state) => ({
      sell: dropClosedQuantity(state.sell, match.orderId, match.quantity),
      buy: dropClosedQuantity(state.buy, match.orderId, match.quantity),
    }));
  }

  mutateMarketSelected((selected) => {
    selected.delete(match.orderId);
  });
  resetMarketFetchTimes();
}

export const orderModalState = writable<OrderModalState | null>(null);
