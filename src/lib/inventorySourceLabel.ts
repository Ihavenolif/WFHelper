import {
  normalizeInventorySource,
  type InventorySource,
} from "../../config/shared/inventorySource.js";

interface InventorySourceDescription {
  label: string;
  /** File name of the user's pick, or "" for the helper, which discovers its own. */
  detail: string;
  /** Full path when there is one, so the row can carry it as a tooltip. */
  title: string;
}

/** Sources that are a file the user chose, so naming it tells them something. */
const USER_PICKED_SOURCES = new Set<InventorySource>(["manual", "aleca"]);

const SOURCE_LABELS: Record<InventorySource, string> = {
  helper: "Built-in helper",
  manual: "Custom JSON file",
  aleca: "AlecaFrame",
};

export const INVENTORY_SOURCE_OPTIONS: ReadonlyArray<{ value: InventorySource; label: string }> = [
  { value: "helper", label: "Helper" },
  { value: "manual", label: "JSON" },
  { value: "aleca", label: "AlecaFrame" },
];

function fileName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/** Plain-language summary of where inventory data comes from. */
export function describeInventorySource(
  source: unknown,
  path: string | null,
): InventorySourceDescription {
  const normalized = normalizeInventorySource(source);
  const label = SOURCE_LABELS[normalized];
  if (!USER_PICKED_SOURCES.has(normalized) || !path) return { label, detail: "", title: label };
  return { label, detail: fileName(path), title: path };
}
