import { persistedString } from "../lib/persistence.js";

export type UiDensity = "compact" | "row";

const STORAGE_KEY = "ui.marketDensity";
export const marketDensity = persistedString<UiDensity>(STORAGE_KEY, ["compact", "row"], "compact");
