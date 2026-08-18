import { get } from "svelte/store";

import { invoke } from "./ipc.js";
import { isIpcError } from "./ipcGuards.js";
import {
  clearMarketAccountState,
  marketOrders,
  marketSelected,
  marketSession,
  marketViewState,
  mutateMarketSelected,
  setMarketViewState,
} from "../stores/market.js";
import type { WfmMutationError, WfmOrder, WfmOrdersResult, WfmSession } from "../types/market.js";

type MarketOrdersRefreshOutcome =
  | { status: "updated" | "unchanged" | "skipped" | "stale" }
  | { status: "error"; error: string; authExpired: boolean };

interface MarketOrdersRefreshOptions {
  background?: boolean;
  clearSelection?: boolean;
}

interface MarketOrdersRefreshDependencies {
  request: () => Promise<WfmOrdersResult | WfmMutationError>;
  readSession: () => WfmSession;
  readOrders: () => WfmOrdersResult;
  writeOrders: (orders: WfmOrdersResult) => void;
  syncSelection: (validIds: Set<string>, clear: boolean) => void;
  markFetched: () => void;
  expireSession: () => void;
}

interface MarketOrdersRefreshController {
  refresh: (options?: MarketOrdersRefreshOptions) => Promise<MarketOrdersRefreshOutcome>;
  invalidate: () => void;
}

function sameOrderFields(left: WfmOrder, right: WfmOrder): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && Object.is(left[key], right[key]),
    )
  );
}

function reconcileOrderList(current: WfmOrder[], incoming: WfmOrder[]): WfmOrder[] {
  const currentById = new Map(current.map((order) => [order.id, order]));
  const reconciled = incoming.map((order) => {
    const previous = currentById.get(order.id);
    return previous && sameOrderFields(previous, order) ? previous : order;
  });

  const unchanged =
    current.length === reconciled.length &&
    current.every((order, index) => order === reconciled[index]);
  return unchanged ? current : reconciled;
}

export function reconcileMarketOrders(
  current: WfmOrdersResult,
  incoming: WfmOrdersResult,
): WfmOrdersResult {
  const sell = reconcileOrderList(current.sell, incoming.sell);
  const buy = reconcileOrderList(current.buy, incoming.buy);
  return sell === current.sell && buy === current.buy ? current : { sell, buy };
}

function sameSession(left: WfmSession, right: WfmSession): boolean {
  return right.loggedIn && left.userName === right.userName && left.platform === right.platform;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAuthError(message: string): boolean {
  return /not logged|expired/i.test(message);
}

export function createMarketOrdersRefreshController(
  dependencies: MarketOrdersRefreshDependencies,
): MarketOrdersRefreshController {
  let generation = 0;
  let activeGeneration = 0;

  function invalidate(): void {
    generation += 1;
    activeGeneration = 0;
  }

  function isCurrent(requestGeneration: number, session: WfmSession): boolean {
    return requestGeneration === generation && sameSession(session, dependencies.readSession());
  }

  async function refresh(
    options: MarketOrdersRefreshOptions = {},
  ): Promise<MarketOrdersRefreshOutcome> {
    const session = dependencies.readSession();
    if (!session.loggedIn) return { status: "skipped" };
    if (options.background && activeGeneration !== 0) return { status: "skipped" };

    const requestGeneration = ++generation;
    activeGeneration = requestGeneration;

    try {
      const result = await dependencies.request();
      if (!isCurrent(requestGeneration, session)) return { status: "stale" };

      if (isIpcError(result)) {
        const authExpired = isAuthError(result.error);
        if (authExpired) {
          invalidate();
          dependencies.expireSession();
        }
        return { status: "error", error: result.error, authExpired };
      }

      const current = dependencies.readOrders();
      const reconciled = reconcileMarketOrders(current, result);
      if (reconciled !== current) dependencies.writeOrders(reconciled);

      const validIds = new Set([...result.sell, ...result.buy].map((order) => order.id));
      dependencies.syncSelection(validIds, options.clearSelection === true);
      dependencies.markFetched();
      return { status: reconciled === current ? "unchanged" : "updated" };
    } catch (error) {
      if (!isCurrent(requestGeneration, session)) return { status: "stale" };
      return { status: "error", error: errorMessage(error), authExpired: false };
    } finally {
      if (activeGeneration === requestGeneration) activeGeneration = 0;
    }
  }

  return {
    refresh,
    invalidate,
  };
}

const controller = createMarketOrdersRefreshController({
  request: () => invoke("wfmGetOrders"),
  readSession: () => get(marketSession),
  readOrders: () => get(marketOrders),
  writeOrders: (orders) => marketOrders.set(orders),
  syncSelection: (validIds, clear) => {
    if (clear) {
      marketSelected.set(new Set());
      return;
    }
    if ([...get(marketSelected)].every((id) => validIds.has(id))) return;
    mutateMarketSelected((selected) => {
      for (const id of selected) {
        if (!validIds.has(id)) selected.delete(id);
      }
    });
  },
  markFetched: () => setMarketViewState({ ordersLastFetch: Date.now() }),
  expireSession: clearMarketAccountState,
});

export function refreshMarketOrders(
  options?: MarketOrdersRefreshOptions,
): Promise<MarketOrdersRefreshOutcome> {
  return controller.refresh(options);
}

export function invalidateMarketOrdersRefresh(): void {
  controller.invalidate();
}

const ORDERS_FRESH_MS = 30_000;

/** For views that only read order badges (inventory "Order placed"): resolve the
 * session if the Market tab never did, then fetch orders unless fresh. */
export async function ensureMarketOrdersLoaded(): Promise<void> {
  if (!get(marketSession).loggedIn) {
    try {
      const session = await invoke("wfmGetSession");
      if (!session.loggedIn) return;
      marketSession.set(session);
    } catch {
      return;
    }
  }
  // Freshness only; treating an empty store as stale would refetch no-listing
  // accounts on every visit.
  const stale = Date.now() - get(marketViewState).ordersLastFetch > ORDERS_FRESH_MS;
  if (stale) await controller.refresh({ background: true });
}
