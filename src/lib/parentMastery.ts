import { componentUniqueNameAliases } from "../../config/shared/componentNames.js";
import type { ItemDbEntry, MasteryData } from "../types/inventory.js";

interface RowLike {
  name: string;
  internalName?: string;
  amount?: number | null;
  parentMastered?: boolean;
  spare?: boolean;
}

interface PartMasteryFlags {
  parentMastered?: boolean;
  spare?: boolean;
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

/** Per-row mastered/spare flags: parts resolve through componentOf, sets via
 * their base item, masterables via themselves. A part only counts against its
 * recipe while the owner is missing - built or mastered gear needs nothing
 * more. Unset flags mean nothing masterable needs the row; filters skip it. */
export function buildPartMasteryResolver(
  itemDb: Record<string, ItemDbEntry>,
  mastery: MasteryData | null,
): (row: RowLike) => PartMasteryFlags {
  const items = mastery?.items ?? [];
  if (items.length === 0) return () => ({});

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

  const statusOf = (uniqueName?: string, name?: string): string | undefined =>
    (uniqueName ? statusByUnique.get(uniqueName) : undefined) ??
    (name ? statusByName.get(name.toLowerCase()) : undefined);

  const masteredFlag = (status: string | undefined): PartMasteryFlags =>
    status ? { parentMastered: status === "mastered" } : {};

  return (row) => {
    const setBase = /\sSet$/i.test(row.name) ? row.name.replace(/\s+Set$/i, "") : null;
    if (setBase) return masteredFlag(statusOf(undefined, setBase));

    const resolved =
      dbEntryFor(itemDb, row.internalName) ??
      dbEntryFor(itemDb, nameIndex.get(row.name.toLowerCase()));
    if (resolved?.entry.isBuildComponent && resolved.entry.componentOf) {
      const parent = itemDb[resolved.entry.componentOf];
      const status = statusOf(resolved.entry.componentOf, parent?.name);
      if (!status) return {};
      const aliases = componentUniqueNameAliases(resolved.uniqueName);
      const required =
        (parent?.components || []).find(
          (comp) => comp.uniqueName && aliases.includes(comp.uniqueName),
        )?.itemCount || 1;
      const stillNeeded = status === "missing" ? required : 0;
      return {
        parentMastered: status === "mastered",
        ...(typeof row.amount === "number" ? { spare: row.amount > stillNeeded } : {}),
      };
    }
    return masteredFlag(statusOf(resolved?.uniqueName ?? row.internalName, row.name));
  };
}

export function attachPartMasteryFlags<T extends RowLike>(
  rows: T[],
  itemDb: Record<string, ItemDbEntry>,
  mastery: MasteryData | null,
): T[] {
  const resolve = buildPartMasteryResolver(itemDb, mastery);
  return rows.map((row) => {
    const flags = resolve(row);
    return flags.parentMastered === undefined && flags.spare === undefined
      ? row
      : { ...row, ...flags };
  });
}
