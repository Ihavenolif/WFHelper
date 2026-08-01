import { writable, derived } from "svelte/store";
import { ownedComponentCount } from "../../config/shared/componentNames.js";
import { aggregateComponentOwnership } from "../../config/shared/componentOwnership.js";
import { withoutFoundryPending } from "../../config/shared/foundryPending.js";
import { parseInventory } from "../lib/inventory.js";
import { parseFoundry } from "../lib/inventory/foundryResources.js";
import { hideFoundryClaims } from "./preferences.js";
import type { WfmItemsLookup } from "../types/ipc.js";
import type {
  ComponentInfo,
  FoundryData,
  ItemDbEntry,
  ParsedItem,
  RawInventoryData,
} from "../types/inventory.js";

export const itemDb = writable<Record<string, ItemDbEntry>>({});
export const wfmItems = writable<WfmItemsLookup>({});
export const inventoryData = writable<RawInventoryData | null>(null);

/** What the account can actually use: blueprints handed to the foundry are gone
 *  from the in-game inventory but stay in Recipes until the build is claimed. */
const usableInventory = derived(
  [inventoryData, hideFoundryClaims, itemDb],
  ([$inv, $hide, $db]): RawInventoryData | null =>
    $inv && $hide
      ? withoutFoundryPending($inv, (uniqueName) => $db[uniqueName]?.reusableBlueprint === true)
      : $inv,
);

/** Reactive map of uniqueName -> owned count, derived from MiscItems + Recipes. */
export const componentOwnership = derived(
  usableInventory,
  ($inv): Map<string, number> =>
    $inv ? aggregateComponentOwnership($inv.MiscItems, $inv.Recipes) : new Map(),
);

/** Enrich raw db components with ownership counts from the reactive ownership map. */
export function enrichComponents(
  components: ComponentInfo[],
  ownership: Map<string, number>,
): ComponentInfo[] {
  return components.map((comp) => {
    const count = ownedComponentCount(comp.uniqueName, ownership);
    return { ...comp, ownedCount: count, owned: count >= (comp.itemCount || 1) };
  });
}

export const parsedItems = derived([usableInventory, itemDb], ([$inv, $db]): ParsedItem[] => {
  if (!$inv || !$db || typeof $db !== "object") return [];
  if (Object.keys($db).length === 0) return [];
  return parseInventory($inv, $db);
});

/**
 * Foundry building / recipe list. Memoised on input identity - parsing the
 * full itemDb costs ~1 s on large accounts; only real input changes re-parse.
 */
let _foundryCache: FoundryData = { building: [], recipes: [] };
let _foundryInvRef: RawInventoryData | null = null;
let _foundryDbRef: Record<string, ItemDbEntry> | null = null;

export const foundryData = derived([usableInventory, itemDb], ([$inv, $db]): FoundryData => {
  if ($inv === _foundryInvRef && $db === _foundryDbRef) return _foundryCache;
  _foundryInvRef = $inv;
  _foundryDbRef = $db;
  if (!$inv || !$db || Object.keys($db).length === 0) {
    _foundryCache = { building: [], recipes: [] };
  } else {
    _foundryCache = parseFoundry($inv, $db);
  }
  return _foundryCache;
});
