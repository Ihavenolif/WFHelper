<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import { parsedItems, wfmItems, inventoryData, itemDb } from "../stores/data.js";
  import { masteryData } from "../stores/mastery.js";
  import { marketOrders } from "../stores/market.js";
  import { ensureMarketOrdersLoaded } from "../lib/marketOrdersSync.js";
  import { attachPartMasteryFlags } from "../lib/parentMastery.js";
  import { relicDb } from "../stores/relics.js";
  import InventoryHeader from "../components/inventory/InventoryHeader.svelte";
  import InventoryGrid from "../components/inventory/InventoryGrid.svelte";
  import InventoryOrderBookPanel from "../components/inventory/InventoryOrderBookPanel.svelte";
  import SharedFilterBar from "../components/SharedFilterBar.svelte";
  import ResourcesView from "./ResourcesView.svelte";
  import { parseResources } from "../lib/inventory.js";
  import { applySharedFiltersAndSort } from "../lib/filters.js";
  import {
    INVENTORY_FILTERS,
    buildBaseInventoryItems,
    buildInventoryViewItems,
    buildOrderLookups,
    metricNeedsFromFilters,
    shouldHydrateMetrics,
    type InventoryBaseItem,
    type InventoryFilterTab,
    type InventoryViewItem,
    type MetricNeeds,
  } from "../lib/inventoryMarket.js";
  import { buildRelicSearchKeywordIndex } from "../lib/relic.js";
  import { readStorage, writeStorage } from "../lib/persistence.js";
  import { startupPriceCacheReady } from "../lib/startupLoader.js";
  import { log } from "../lib/log.js";
  import {
    getRankedHotsetEntries,
    getRankedHotsetSeenAt,
    recordRankedHotsetEntry,
  } from "../lib/wfm/rankedHotset.js";
  import { getInventoryHydrationController } from "../stores/inventoryHydration.js";
  import { sharedFilters, updateSharedFilters } from "../stores/filters.js";
  import { activeItem } from "../stores/modals.js";
  import { isRankedGroup } from "../../config/shared/numeric.js";
  import type { SharedSortKey, SharedFiltersState } from "../types/filters.js";

  const METRIC_VISIBLE_PREFETCH_LIMIT = 42;
  const METRIC_BACKGROUND_PREFETCH_LIMIT = 210;
  const HOTSET_REFRESH_DELAY_MS = 4_000;
  const HOTSET_REFRESH_LIMIT = 12;

  const FILTER_TAB_KEY = "wf_inventory_tab";

  function restoreFilterTab(): InventoryFilterTab {
    const raw = readStorage(FILTER_TAB_KEY);
    const known = INVENTORY_FILTERS.some((entry) => entry.key === raw);
    return known ? (raw as InventoryFilterTab) : "all_parts";
  }

  // Only sorts the active tab can actually compute; anything else would
  // silently fall back to a name sort (metrics missing on those items).
  const FULL_SORT_OPTIONS: Array<[SharedSortKey, string]> = [
    ["name", "Name"],
    ["platinum", "Platinum"],
    ["ducats", "Ducats"],
    ["amount", "Amount"],
    ["ducatonator", "Ducatonator"],
    ["complete_sets", "Complete (Sets)"],
    ["missing_parts", "Parts to Complete"],
  ];
  const PRICED_SORT_OPTIONS: Array<[SharedSortKey, string]> = [
    ["name", "Name"],
    ["platinum", "Platinum"],
    ["amount", "Amount"],
  ];
  const RESOURCE_SORT_OPTIONS: Array<[SharedSortKey, string]> = [
    ["name", "Name"],
    ["amount", "Amount"],
  ];
  const SORT_OPTIONS_BY_TAB: Partial<Record<InventoryFilterTab, Array<[SharedSortKey, string]>>> = {
    all_parts: FULL_SORT_OPTIONS,
    full_sets: FULL_SORT_OPTIONS,
    resources: RESOURCE_SORT_OPTIONS,
  };

  let filter: InventoryFilterTab = restoreFilterTab();
  let showFilterPanel = false;
  // Full Sets lists sellable spares; this folds in the sets still missing parts.
  let showIncompleteSets = false;
  let selectedInternalName: string | null = null;
  let orderBookPanelOpen = false;
  const FILTERS = INVENTORY_FILTERS;
  const inventoryFilters = sharedFilters("inventory");

  const hydration = getInventoryHydrationController();
  const hydrationMetrics = hydration.metricsByKey;
  let hotsetRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let hotsetRefreshSignature = "";
  let hotsetRefreshCompletedSignature = "";

  function trackRankedHotset(item: InventoryBaseItem | null | undefined): void {
    if (!item || !isRankedGroup(item.inventoryGroup) || !item.marketSlug) return;
    recordRankedHotsetEntry(item.marketSlug, item.maxRank);
  }

  function prefetchVisibleMetrics(items: InventoryBaseItem[], needs: MetricNeeds): void {
    const hydrationCandidates = items.filter((item) => shouldHydrateMetrics(item));
    const visible = hydrationCandidates.slice(0, METRIC_VISIBLE_PREFETCH_LIMIT);
    const background = hydrationCandidates.slice(
      METRIC_VISIBLE_PREFETCH_LIMIT,
      METRIC_VISIBLE_PREFETCH_LIMIT + METRIC_BACKGROUND_PREFETCH_LIMIT,
    );

    // the startup snapshot doesn't cover every slug, so the visible slice may fetch
    hydration.enqueue(visible, $wfmItems, { ...needs, network: true });
    hydration.enqueue(background, $wfmItems, { ...needs, ducats: false, orders: false });
  }

  function handleFilterSelect(event: CustomEvent<InventoryFilterTab>): void {
    filter = event.detail;
    writeStorage(FILTER_TAB_KEY, filter);
  }

  function toggleIncompleteSets(): void {
    showIncompleteSets = !showIncompleteSets;
    // Fewest-parts-first on arrival; don't fight a deliberate re-sort.
    if (showIncompleteSets && $inventoryFilters.sortBy !== "missing_parts") {
      updateSharedFilters("inventory", { sortBy: "missing_parts", sortDirection: "asc" });
    }
  }

  function handleToggleFilterPanel(): void {
    showFilterPanel = !showFilterPanel;
  }

  function handleItemSelect(event: CustomEvent<InventoryViewItem>): void {
    selectedInternalName = event.detail.internalName;
    orderBookPanelOpen = true;

    if (!wfmItemsLoaded) return;
    const selectedBaseItem = tabBaseItems.find(
      (entry) => entry.internalName === event.detail.internalName,
    );
    if (selectedBaseItem && shouldHydrateMetrics(selectedBaseItem)) {
      trackRankedHotset(selectedBaseItem);
      hydration.enqueue([selectedBaseItem], $wfmItems, {
        price: true,
        ducats: false,
        orders: true,
        network: true,
      });
    }
  }

  function handleItemExpand(event: CustomEvent<InventoryViewItem>): void {
    const parsed = $parsedItems.find((entry) => entry.internalName === event.detail.internalName);
    // Base items predate hydration - carry the slug so the modal prices by it.
    if (parsed) activeItem.set({ ...parsed, marketSlug: event.detail.marketSlug });
  }

  function closeOrderBookPanel(): void {
    selectedInternalName = null;
    orderBookPanelOpen = false;
  }

  function handleItemVisible(event: CustomEvent<InventoryViewItem>): void {
    // before the catalog loads, cards carry guessed slugs - don't fetch with those
    if (!wfmItemsLoaded) return;
    const visibleBaseItem = tabBaseItems.find(
      (entry) => entry.internalName === event.detail.internalName,
    );
    if (!visibleBaseItem || !shouldHydrateMetrics(visibleBaseItem)) return;
    trackRankedHotset(visibleBaseItem);

    const isRankedTab = isRankedGroup(filter);
    hydration.enqueue([visibleBaseItem], $wfmItems, {
      price: true,
      ducats: false,
      orders: isRankedTab,
      network: true,
    });
  }

  function clearHotsetRefreshTimer(): void {
    if (!hotsetRefreshTimer) return;
    clearTimeout(hotsetRefreshTimer);
    hotsetRefreshTimer = null;
  }

  function buildHotsetRefreshSignature(items: InventoryBaseItem[]): string {
    const topHotset = getRankedHotsetEntries()
      .slice(0, HOTSET_REFRESH_LIMIT)
      .map((entry) => `${entry.slug}:r${entry.maxRank}`)
      .join("|");
    return `${items.length}:${topHotset}`;
  }

  function maybeScheduleRankedHotsetRefresh(items: InventoryBaseItem[]): void {
    if (!$startupPriceCacheReady) return;
    if (!wfmItemsLoaded) return;

    const signature = buildHotsetRefreshSignature(items);
    if (signature === hotsetRefreshSignature || signature === hotsetRefreshCompletedSignature) {
      return;
    }

    hotsetRefreshSignature = signature;
    clearHotsetRefreshTimer();
    hotsetRefreshTimer = setTimeout(() => {
      hotsetRefreshTimer = null;
      const topHotset = getRankedHotsetEntries().slice(0, HOTSET_REFRESH_LIMIT);
      if (topHotset.length === 0) {
        hotsetRefreshCompletedSignature = signature;
        return;
      }

      const bySlug = new Map(topHotset.map((entry) => [entry.slug, entry]));
      const queue = items
        .filter((item) => item.marketSlug && bySlug.has(item.marketSlug))
        .sort((a, b) => getRankedHotsetSeenAt(b.marketSlug) - getRankedHotsetSeenAt(a.marketSlug))
        .slice(0, HOTSET_REFRESH_LIMIT);

      if (queue.length > 0) {
        hydration.enqueue(queue, $wfmItems, {
          price: true,
          ducats: false,
          orders: true,
          network: true,
        });
        log.info(`[Inventory] queued ranked hotset refresh (${queue.length} items)`);
      }

      hotsetRefreshCompletedSignature = signature;
    }, HOTSET_REFRESH_DELAY_MS);
  }

  function mergeKeywords(base: string[] | undefined, extra: string[]): string[] {
    const merged = Array.isArray(base) ? [...base] : [];
    for (const keyword of extra) {
      if (!merged.includes(keyword)) {
        merged.push(keyword);
      }
    }
    return merged;
  }

  onMount(() => {
    hydration.resume();
    // The "Order placed" badges read the orders store, which only the Market
    // tab used to fill - straight-to-inventory sessions saw every item as unlisted.
    void ensureMarketOrdersLoaded();
  });

  onDestroy(() => {
    clearHotsetRefreshTimer();

    hydration.pause();
  });

  $: ({ orderedNames, orderedSlugs } = buildOrderLookups($marketOrders));
  $: incompleteSetBaseItems =
    filter === "full_sets" && showIncompleteSets
      ? buildBaseInventoryItems(
          $parsedItems,
          "incomplete_sets",
          $wfmItems,
          orderedNames,
          orderedSlugs,
          $relicDb,
        )
      : [];
  $: tabBaseItems = [
    ...buildBaseInventoryItems(
      $parsedItems,
      filter,
      $wfmItems,
      orderedNames,
      orderedSlugs,
      $relicDb,
    ),
    ...incompleteSetBaseItems,
  ];
  $: allRankedBaseItems = [
    ...buildBaseInventoryItems(
      $parsedItems,
      "mods",
      $wfmItems,
      orderedNames,
      orderedSlugs,
      $relicDb,
    ),
    ...buildBaseInventoryItems(
      $parsedItems,
      "arcanes",
      $wfmItems,
      orderedNames,
      orderedSlugs,
      $relicDb,
    ),
  ];
  $: tabItems = buildInventoryViewItems(tabBaseItems, $hydrationMetrics);
  $: relicSearchKeywordIndex = buildRelicSearchKeywordIndex($relicDb);
  $: searchableTabItems =
    filter !== "relics"
      ? tabItems
      : tabItems.map((item) => {
          const relicKeywords = relicSearchKeywordIndex[item.internalName] || [];
          if (relicKeywords.length === 0) return item;

          return {
            ...item,
            keywords: mergeKeywords(item.keywords, relicKeywords),
          };
        });
  $: selectedItem = selectedInternalName
    ? tabItems.find((entry) => entry.internalName === selectedInternalName) || null
    : null;
  $: masteredTabItems = attachPartMasteryFlags(searchableTabItems, $itemDb, $masteryData);
  $: filtered = applySharedFiltersAndSort(masteredTabItems, $inventoryFilters);
  $: resourceList =
    $inventoryData && Object.keys($itemDb).length > 0
      ? parseResources($inventoryData, $itemDb)
      : [];
  function filterAndSortResources(
    list: typeof resourceList,
    filters: typeof $inventoryFilters,
  ): typeof resourceList {
    const search = filters.search.trim().toLowerCase();
    const searched = search
      ? list.filter(
          (r) =>
            r.name.toLowerCase().includes(search) || r.internalName.toLowerCase().includes(search),
        )
      : list;
    const dir = filters.sortDirection === "asc" ? 1 : -1;
    return [...searched].sort((a, b) =>
      filters.sortBy === "amount" ? (a.count - b.count) * dir : a.name.localeCompare(b.name) * dir,
    );
  }

  $: filteredResources = filterAndSortResources(resourceList, $inventoryFilters);
  $: filteredTotalCount = filter === "resources" ? filteredResources.length : filtered.length;
  function countActiveAdvancedFilters(state: SharedFiltersState): number {
    let active = 0;
    if (state.orderPlaced !== "all") active++;
    if (state.mastered !== "all") active++;
    if (state.spares !== "all") active++;
    if (state.vaulted !== "all") active++;
    if (state.partType !== "all") active++;
    if (state.favorite !== "all") active++;
    if (state.equipped !== "all") active++;
    if (state.leveledUp !== "all") active++;
    if (state.minimumPlatinum > 0) active++;
    if (state.minimumAmount > 0) active++;
    return active;
  }
  $: activeAdvancedCount = countActiveAdvancedFilters($inventoryFilters);
  $: showDucats = filter === "all_parts" || filter === "full_sets";
  $: metricNeeds = metricNeedsFromFilters($inventoryFilters, filter);
  $: wfmItemsLoaded = Object.keys($wfmItems).length > 0;
  $: if ($startupPriceCacheReady && wfmItemsLoaded) {
    prefetchVisibleMetrics(filtered, metricNeeds);
    maybeScheduleRankedHotsetRefresh(allRankedBaseItems);
  }
</script>

<section class="view active">
  <InventoryHeader
    totalCount={filteredTotalCount}
    filters={FILTERS}
    activeFilter={filter}
    {showFilterPanel}
    sortOptions={SORT_OPTIONS_BY_TAB[filter] ?? PRICED_SORT_OPTIONS}
    advancedCount={activeAdvancedCount}
    filtersEnabled={filter !== "resources"}
    on:filter={handleFilterSelect}
    on:toggle={handleToggleFilterPanel}
  >
    {#if showFilterPanel && filter !== "resources"}
      <div
        class="inventory-filter-popover mb-3.5 max-h-[67vh] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-2.5 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <SharedFilterBar scope="inventory" showBasic={false} showAdvanced={true} />
      </div>
    {/if}
  </InventoryHeader>

  {#if filter === "resources"}
    <ResourcesView resources={filteredResources} />
  {:else}
    <div
      class="grid grid-cols-1 items-start gap-3 {orderBookPanelOpen
        ? 'min-[1101px]:grid-cols-[minmax(0,1fr)_360px]'
        : ''}"
    >
      <div class="min-w-0" data-tour="inventory-grid">
        {#if filter === "full_sets"}
          <label
            class="mb-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-text-secondary"
          >
            <input
              type="checkbox"
              class="accent-[color:var(--accent)]"
              checked={showIncompleteSets}
              on:change={toggleIncompleteSets}
            />
            Show incomplete sets
          </label>
        {/if}
        <InventoryGrid
          items={filtered}
          {showDucats}
          on:select={handleItemSelect}
          on:visible={handleItemVisible}
          on:expand={handleItemExpand}
        />
      </div>

      {#if orderBookPanelOpen}
        <InventoryOrderBookPanel item={selectedItem} onClose={closeOrderBookPanel} />
      {/if}
    </div>
  {/if}
</section>

<style>
  .inventory-filter-popover :global(.shared-filter-bar) {
    margin-bottom: 0;
  }
  .inventory-filter-popover :global(.shared-filter-controls) {
    align-items: flex-start;
    gap: 0.5rem;
  }
  .inventory-filter-popover :global(.shared-chip-group) {
    flex-direction: column;
    align-items: stretch;
    gap: 0.3rem;
  }
  .inventory-filter-popover :global(.shared-chip-group .filter-tabs) {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
</style>
