import { componentUniqueNameAliases } from "../../config/shared/componentNames.js";
import type { ItemDbEntry, MasteryData } from "../types/inventory.js";

interface RowLike {
  name: string;
  internalName?: string;
  parentMastered?: boolean;
}

function dbEntryFor(
  itemDb: Record<string, ItemDbEntry>,
  key: string | undefined,
): { uniqueName: string; entry: ItemDbEntry } | null {
  if (!key) return null;
  const candidates = [...componentUniqueNameAliases(key), key.replace(/Blueprint$/i, "")];
  for (const candidate of candidates) {
    const entry = itemDb[candidate];
    if (entry) return { uniqueName: candidate, entry };
  }
  return null;
}

/** Per-row "is everything this builds into mastered": parts resolve through
 * componentOf, sets through their base item, masterables through themselves.
 * Undefined = nothing masterable needs the row, the filter never applies. */
export function buildParentMasteredResolver(
  itemDb: Record<string, ItemDbEntry>,
  mastery: MasteryData | null,
): (row: RowLike) => boolean | undefined {
  const items = mastery?.items ?? [];
  if (items.length === 0) return () => undefined;

  const statusByUnique = new Map<string, string>();
  const statusByName = new Map<string, string>();
  for (const item of items) {
    if (!item.status) continue;
    if (item.uniqueName) statusByUnique.set(item.uniqueName, item.status);
    statusByName.set(item.name.toLowerCase(), item.status);
  }

  const nameIndex = new Map<string, string>();
  for (const [uniqueName, entry] of Object.entries(itemDb)) {
    const key = entry.name?.toLowerCase();
    if (key && !nameIndex.has(key)) nameIndex.set(key, uniqueName);
  }

  const masteredOf = (uniqueName?: string, name?: string): boolean | undefined => {
    const status =
      (uniqueName ? statusByUnique.get(uniqueName) : undefined) ??
      (name ? statusByName.get(name.toLowerCase()) : undefined);
    return status ? status === "mastered" : undefined;
  };

  return (row) => {
    const setBase = /\sSet$/i.test(row.name) ? row.name.replace(/\s+Set$/i, "") : null;
    if (setBase) return masteredOf(undefined, setBase);

    const resolved =
      dbEntryFor(itemDb, row.internalName) ??
      dbEntryFor(itemDb, nameIndex.get(row.name.toLowerCase()));
    if (resolved?.entry.isBuildComponent && resolved.entry.componentOf) {
      const parent = itemDb[resolved.entry.componentOf];
      return masteredOf(resolved.entry.componentOf, parent?.name);
    }
    return masteredOf(resolved?.uniqueName ?? row.internalName, row.name);
  };
}

export function attachParentMastered<T extends RowLike>(
  rows: T[],
  itemDb: Record<string, ItemDbEntry>,
  mastery: MasteryData | null,
): T[] {
  const resolve = buildParentMasteredResolver(itemDb, mastery);
  return rows.map((row) => {
    const parentMastered = resolve(row);
    return parentMastered === undefined ? row : { ...row, parentMastered };
  });
}
