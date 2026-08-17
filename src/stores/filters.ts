import { derived, writable, type Readable } from "svelte/store";
import type { FilterScope, SharedFiltersState } from "../types/filters.js";

function createDefaultSharedFiltersState(): SharedFiltersState {
  return {
    search: "",
    primeMode: "all",
    masteredMode: "all",
    sortBy: "name",
    sortDirection: "asc",
    orderPlaced: "all",
    mastered: "all",
    vaulted: "all",
    partType: "all",
    favorite: "all",
    minimumPlatinum: 0,
    minimumAmount: 0,
    equipped: "all",
    leveledUp: "all",
    subsumed: "all",
    foundryState: "all",
  };
}

function createDefaultFiltersByScope(): Record<FilterScope, SharedFiltersState> {
  return {
    inventory: createDefaultSharedFiltersState(),
    mastery: createDefaultSharedFiltersState(),
    market: createDefaultSharedFiltersState(),
    foundry: {
      ...createDefaultSharedFiltersState(),
      sortBy: "count",
      sortDirection: "desc",
    },
    rivens: createDefaultSharedFiltersState(),
  };
}

const sharedFiltersByScope = writable<Record<FilterScope, SharedFiltersState>>(
  createDefaultFiltersByScope(),
);

export function sharedFilters(scope: FilterScope): Readable<SharedFiltersState> {
  return derived(sharedFiltersByScope, ($filters) => $filters[scope]);
}

export function updateSharedFilters(scope: FilterScope, patch: Partial<SharedFiltersState>): void {
  sharedFiltersByScope.update((current) => ({
    ...current,
    [scope]: {
      ...current[scope],
      ...patch,
    },
  }));
}

export function resetSharedFilters(scope: FilterScope): void {
  sharedFiltersByScope.update((current) => ({
    ...current,
    // Per-scope defaults: foundry resets to count/desc, not the generic name/asc.
    [scope]: createDefaultFiltersByScope()[scope],
  }));
}
