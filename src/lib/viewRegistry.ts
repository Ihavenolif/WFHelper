import type { Component } from "svelte";

import type { MessageKey } from "./i18n.js";
import type { ViewName } from "../types/views.js";

/** Views loaded on first visit. Everything else is in the initial bundle. */
export type LazyViewName = Extract<ViewName, "world" | "market" | "relics" | "wiki" | "arbi">;

type LazyViewComponent = Component<Record<string, never>>;

export const LAZY_VIEW_LOADERS: Record<
  LazyViewName,
  () => Promise<{ default: LazyViewComponent }>
> = {
  world: () => import("../views/WorldView.svelte"),
  market: () => import("../views/MarketView.svelte"),
  relics: () => import("../views/RelicsView.svelte"),
  wiki: () => import("../views/WikiView.svelte"),
  arbi: () => import("../views/ArbiAnalyzeView.svelte"),
};

export function isLazyView(view: ViewName): view is LazyViewName {
  return view in LAZY_VIEW_LOADERS;
}

export const VIEW_LABEL_KEYS: Record<ViewName, MessageKey> = {
  setup: "nav.setup",
  inventory: "common.inventory",
  foundry: "common.foundry",
  mastery: "common.mastery",
  stats: "common.stats",
  world: "common.world",
  market: "common.market",
  relics: "common.relics",
  wiki: "common.wiki",
  rivens: "common.rivens",
  arbi: "common.arbitrations",
  settings: "common.settings",
};

/** Sidebar order: ViewName in declaration order, minus the wizard-only setup view. */
export const SIDEBAR_VIEW_ORDER: readonly Exclude<ViewName, "setup">[] = [
  "inventory",
  "foundry",
  "mastery",
  "stats",
  "world",
  "market",
  "relics",
  "wiki",
  "rivens",
  "arbi",
  "settings",
];
