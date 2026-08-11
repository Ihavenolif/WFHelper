<script lang="ts">
  import HeaderTabs from "../HeaderTabs.svelte";
  import ItemImage from "../ItemImage.svelte";
  import SearchBox from "../SearchBox.svelte";
  import ThemedPanel from "../ThemedPanel.svelte";
  import { masteryXpToRank } from "../../../config/shared/masteryXp.js";
  import type { MasteryRoadmap, MasteryRoadmapRecommendation } from "../../lib/masteryRoadmap.js";

  type RoadmapMode = "easy" | "relics" | "platinum";
  type RoadmapSort = "recommended" | "xp" | "price";

  export let roadmap: MasteryRoadmap;
  export let totalXp: number | null = null;
  export let onOpen: (item: MasteryRoadmapRecommendation) => void;

  const MODE_TABS = [
    { key: "easy", label: "Easy" },
    { key: "relics", label: "From Relics" },
    { key: "platinum", label: "With Platinum" },
  ];

  const ACCESS_LABELS = {
    owned: "Owned - level it",
    claimable: "Ready to claim",
    building: "Crafting",
    buildable: "Can build",
    relics: "From owned relics",
    platinum: "Buy on Market",
  } as const;

  let mode: RoadmapMode = "easy";
  let sort: RoadmapSort = "recommended";
  let category = "all";
  let search = "";

  $: source =
    mode === "easy" ? roadmap.easy : mode === "relics" ? roadmap.relics : roadmap.platinum;
  $: categories = [
    ...new Set(
      [...roadmap.easy, ...roadmap.relics, ...roadmap.platinum].map((item) => item.category),
    ),
  ].sort((a, b) => a.localeCompare(b));
  $: visible = source
    .filter((item) => category === "all" || item.category === category)
    .filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      if (sort === "xp") {
        return b.masteryXpRemaining - a.masteryXpRemaining || a.name.localeCompare(b.name);
      }
      if (sort === "price") {
        return (
          (a.estimatedCost ?? Number.POSITIVE_INFINITY) -
            (b.estimatedCost ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name)
        );
      }
      return 0;
    });
  $: easyXp = roadmap.easy.reduce((sum, item) => sum + item.masteryXpRemaining, 0);
  $: relicXp = roadmap.relics.reduce((sum, item) => sum + item.masteryXpRemaining, 0);
  $: buyableXp = roadmap.platinum.reduce((sum, item) => sum + item.masteryXpRemaining, 0);
  $: easyPotentialRank = totalXp == null ? null : masteryXpToRank(totalXp + easyXp);
  $: bestValue = roadmap.platinum[0] ?? null;

  function selectMode(value: string): void {
    mode = value as RoadmapMode;
    sort = "recommended";
  }

  function formatProbability(value: number | null): string {
    return `${((value ?? 0) * 100).toFixed(2).replace(/\.00$/, "")}%`;
  }

  function ownedPartTypes(item: MasteryRoadmapRecommendation): number {
    return item.components.filter(
      (component) =>
        component.owned || (component.ownedCount ?? 0) >= Math.max(1, component.itemCount ?? 1),
    ).length;
  }
</script>

<div class="grid gap-3" data-tour="mastery-roadmap">
  <div class="grid gap-2 min-[900px]:grid-cols-2 min-[1400px]:grid-cols-4">
    <ThemedPanel className="p-3">
      <span class="block text-xs uppercase tracking-[0.08em] text-text-muted">Easy mastery</span>
      <strong class="font-display text-2xl text-success">+{easyXp.toLocaleString()} XP</strong>
      <span class="block text-xs text-text-secondary">
        {roadmap.easy.length} items owned or available through Foundry{#if easyPotentialRank != null}
          - potential MR {easyPotentialRank}{/if}
      </span>
    </ThemedPanel>
    <ThemedPanel className="p-3">
      <span class="block text-xs uppercase tracking-[0.08em] text-text-muted"
        >From owned relics</span
      >
      <strong class="font-display text-2xl text-accent">+{relicXp.toLocaleString()} XP</strong>
      <span class="block text-xs text-text-secondary">
        {roadmap.relics.length} items with every missing part available
      </span>
    </ThemedPanel>
    <ThemedPanel className="p-3">
      <span class="block text-xs uppercase tracking-[0.08em] text-text-muted">Buyable mastery</span>
      <strong class="font-display text-2xl text-info">+{buyableXp.toLocaleString()} XP</strong>
      <span class="block text-xs text-text-secondary">
        {roadmap.platinum.length} recommendations with snapshot prices
      </span>
    </ThemedPanel>
    <ThemedPanel className="p-3">
      <span class="block text-xs uppercase tracking-[0.08em] text-text-muted">Best value</span>
      {#if bestValue}
        <strong class="block truncate font-display text-lg text-accent">{bestValue.name}</strong>
        <span class="block text-xs text-text-secondary">
          {Math.round(bestValue.xpPerPlatinum ?? 0).toLocaleString()} XP/p at {bestValue.estimatedCost}p
        </span>
      {:else}
        <strong class="font-display text-lg text-text-muted">No priced items</strong>
      {/if}
    </ThemedPanel>
  </div>

  <div class="view-sticky-filters grid gap-2">
    <div class="flex flex-wrap items-end border-b border-white/[0.09]">
      <HeaderTabs options={MODE_TABS} activeKey={mode} onSelect={selectMode} />
      <div class="ml-auto flex flex-wrap items-center justify-end gap-2 pb-2">
        <SearchBox value={search} onValueChange={(value) => (search = value)} />
        <label class="shared-filter-sort">
          <span>Category</span>
          <select class="shared-filter-select" bind:value={category}>
            <option value="all">All</option>
            {#each categories as option}
              <option value={option}>{option}</option>
            {/each}
          </select>
        </label>
        <label class="shared-filter-sort">
          <span>Sort</span>
          <select class="shared-filter-select" bind:value={sort}>
            <option value="recommended">Recommended</option>
            <option value="xp">Most mastery XP</option>
            {#if mode === "platinum"}<option value="price">Lowest price</option>{/if}
          </select>
        </label>
      </div>
    </div>
  </div>

  {#if visible.length === 0}
    <div class="empty-state"><p>No roadmap items match these filters</p></div>
  {:else}
    <div class="grid gap-2 min-[900px]:grid-cols-2">
      {#each visible as item (`${item.uniqueName || item.internalName}-${item.access}`)}
        <button
          type="button"
          class="grid min-w-0 grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-2.5 text-left text-inherit transition-[border-color,background-color] hover:border-accent-dim hover:bg-bg-hover"
          on:click={() => onOpen(item)}
        >
          <span
            class="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-black/20"
          >
            <ItemImage src={item.imageUrl} alt={item.name} />
          </span>
          <span class="min-w-0">
            <strong class="block truncate font-display text-base text-text-primary"
              >{item.name}</strong
            >
            {#if item.access === "relics"}
              <span
                class="block text-xs font-semibold text-success"
                title="Chance of collecting every missing part by opening each relevant owned relic once"
              >
                {formatProbability(item.relicProbability)} chance with {item.relevantRelicCount}
                owned {item.relevantRelicCount === 1 ? "relic" : "relics"}
              </span>
              <span class="mt-1 block text-xs text-text-muted">
                {item.category} - {ownedPartTypes(item)}/{item.components.length} parts owned
              </span>
            {:else}
              <span class="block text-xs text-text-secondary">
                {item.category} - {ACCESS_LABELS[item.access]}
              </span>
              <span class="mt-1 block text-xs text-text-muted">
                {#if item.access === "owned"}Level {item.rank}/{item.maxRank}{:else if item.components.length > 0}{ownedPartTypes(
                    item,
                  )}/{item.components.length} parts owned{:else}Not owned{/if}
              </span>
            {/if}
          </span>
          <span class="grid justify-items-end gap-1 text-right">
            <strong class="font-display text-base text-accent"
              >+{item.masteryXpRemaining.toLocaleString()} XP</strong
            >
            {#if item.estimatedCost != null && item.access === "platinum"}
              <span class="text-sm font-semibold text-info">{item.estimatedCost}p</span>
              <span class="text-[0.68rem] text-text-muted">
                {Math.round(item.xpPerPlatinum ?? 0).toLocaleString()} XP/p
              </span>
            {/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
