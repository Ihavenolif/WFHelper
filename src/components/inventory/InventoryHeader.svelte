<script lang="ts">
  import { createEventDispatcher } from "svelte";

  import HeaderTabs from "../HeaderTabs.svelte";
  import SharedFilterBar from "../SharedFilterBar.svelte";
  import type { InventoryFilterTab } from "../../lib/inventoryMarket.js";
  import type { SharedSortKey } from "../../types/filters.js";

  export let totalCount = 0;
  export let filters: Array<{ key: InventoryFilterTab; label: string }> = [];
  export let activeFilter: InventoryFilterTab = "all_parts";
  export let showFilterPanel = false;
  export let sortOptions: Array<[SharedSortKey, string]> | null = null;
  export let advancedCount = 0;
  export let filtersEnabled = true;

  const dispatch = createEventDispatcher<{
    filter: InventoryFilterTab;
    toggle: void;
  }>();

  function selectFilter(value: InventoryFilterTab): void {
    dispatch("filter", value);
  }

  function toggleFilters(): void {
    dispatch("toggle");
  }

  function handleTabSelect(value: string): void {
    selectFilter(value as InventoryFilterTab);
  }
</script>

<!-- Keep the sticky row outside the scrolling heading. -->
<h2
  class="m-0 mb-2 font-display text-4xl leading-none font-semibold tracking-[0.03em] text-text-primary"
>
  Inventory ({totalCount})
</h2>
<div class="view-sticky-filters mb-4">
  <div class="flex flex-wrap items-end border-b border-white/10" data-tour="inventory-tabs">
    <div class="min-w-0 flex-1 max-[1100px]:basis-full">
      <HeaderTabs options={filters} activeKey={activeFilter} onSelect={handleTabSelect} />
    </div>
    <div
      class="ml-auto flex shrink-0 flex-nowrap items-center gap-2 pb-2 max-[1100px]:mt-2 max-[1100px]:w-full max-[1100px]:justify-end"
    >
      <SharedFilterBar
        scope="inventory"
        singleLine={true}
        showBasic={true}
        showAdvanced={false}
        basicVariant="quick"
        {sortOptions}
      />
      {#if filtersEnabled}
        <button
          class="filter-tab inline-flex min-h-8 items-center gap-1.5 pt-0 pb-0 [&_svg]:h-3.5 [&_svg]:w-3.5"
          class:active={showFilterPanel || advancedCount > 0}
          title={advancedCount > 0
            ? `${advancedCount} advanced filter${advancedCount === 1 ? "" : "s"} active`
            : "Advanced filters"}
          on:click={toggleFilters}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 5h18" />
            <path d="M6 12h12" />
            <path d="M10 19h4" />
          </svg>
          Filters
          {#if advancedCount > 0}
            <span
              class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--accent)] px-1 text-[10px] font-bold leading-none text-bg-deep"
            >
              {advancedCount}
            </span>
          {/if}
        </button>
      {/if}
    </div>
  </div>
  <slot />
</div>
