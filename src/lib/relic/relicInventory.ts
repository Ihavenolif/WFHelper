import { collectRelicInventoryCounts } from "../../../config/shared/relicCounts.js";
import type { RawInventoryData } from "../../types/inventory.js";
import type { OwnedCounts, RelicDatabase } from "../../types/relics.js";

export function parseOwnedRelics(
  inventoryData: RawInventoryData | null,
  relicDb: RelicDatabase | null,
): OwnedCounts {
  const owned: OwnedCounts = {};
  if (!inventoryData || !relicDb) return owned;

  const ensureOwnedSlot = (groupKey: string): void => {
    if (!owned[groupKey]) {
      owned[groupKey] = {
        intact: 0,
        exceptional: 0,
        flawless: 0,
        radiant: 0,
      };
    }
  };

  const countedByItemType = collectRelicInventoryCounts(
    inventoryData,
    (itemType) => relicDb.byUniqueName[itemType] !== undefined,
  );

  for (const [itemType, count] of countedByItemType) {
    const info = relicDb.byUniqueName[itemType];
    if (!info) continue;
    ensureOwnedSlot(info.groupKey);
    owned[info.groupKey][info.quality] += count;
  }

  return owned;
}
