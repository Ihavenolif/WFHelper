export type FilterScope = "inventory" | "mastery" | "market" | "foundry" | "rivens";

export type PrimeFilterMode = "all" | "prime" | "non_prime";
export type MasteredFilterMode = "all" | "mastered" | "not_mastered";
export type YesNoFilterMode = "all" | "yes" | "no";
type PartTypeFilterMode = "all" | "normal" | "prime";

export type SharedSortKey =
  | "name"
  | "owned"
  | "platinum"
  | "ducats"
  | "amount"
  | "count"
  | "time"
  | "disposition"
  | "rerolls"
  | "grade"
  | "ducatonator"
  | "complete_sets"
  | "missing_parts"
  | "mastery_xp";

export type SortDirection = "asc" | "desc";

export interface SharedFiltersState {
  search: string;
  primeMode: PrimeFilterMode;
  masteredMode: MasteredFilterMode;
  sortBy: SharedSortKey;
  sortDirection: SortDirection;
  orderPlaced: YesNoFilterMode;
  vaulted: YesNoFilterMode;
  partType: PartTypeFilterMode;
  favorite: YesNoFilterMode;
  minimumPlatinum: 0 | 5 | 10 | 15;
  /** 0 = any, 2 = only items owned more than once (">1"). */
  minimumAmount: 0 | 2;
  equipped: YesNoFilterMode;
  leveledUp: YesNoFilterMode;
  subsumed: YesNoFilterMode;
  /** Its foundry build has finished and is waiting to be claimed. */
  foundryReady: YesNoFilterMode;
  /** Every part sits in the inventory but the item itself is not built. */
  buildable: YesNoFilterMode;
}
