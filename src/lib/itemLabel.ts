// `name` is English and stays the join key for warframe.market, OCR and every
// by-name lookup. `displayName` exists only when the active game language moved
// it, so every user-facing label reads through here and nothing else.
export function itemLabel(
  item: { name?: string | null; displayName?: string | null } | null | undefined,
): string {
  if (!item) return "";
  return item.displayName || item.name || "";
}
