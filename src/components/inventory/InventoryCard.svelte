<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";

  import ItemImage from "../ItemImage.svelte";
  import MarketMetricStrip from "../MarketMetricStrip.svelte";
  import { NAV_ICON_URLS } from "../../lib/assetUrls.js";
  import type { InventoryViewItem } from "../../lib/inventoryMarket.js";
  import { isRankedGroup } from "../../../config/shared/numeric.js";

  export let item: InventoryViewItem;
  export let showDucats = true;

  const dispatch = createEventDispatcher<{
    select: InventoryViewItem;
    visible: InventoryViewItem;
    expand: InventoryViewItem;
  }>();
  let cardEl: HTMLDivElement | null = null;
  let visibilityObserver: IntersectionObserver | null = null;
  let visibilityReported = false;

  $: mastered = item.rank >= item.maxRank && item.maxRank > 1;
  $: canShowRank = item.maxRank > 1 && isRankedGroup(item.inventoryGroup);
  $: rankFillPct =
    canShowRank && item.maxRank > 0
      ? Math.max(0, Math.min(100, (item.rank / item.maxRank) * 100))
      : 0;

  $: showRankOrderSummary = isRankedGroup(item.inventoryGroup) && item.maxRank > 1;
  $: rankCapLabel = Number.isFinite(item.maxRank) ? Math.max(0, Math.floor(item.maxRank)) : 0;

  $: wtsRank0Label = item.wtsR0 != null ? `${item.wtsR0}p` : "-";
  $: wtbRank0Label = item.wtbR0 != null ? `${item.wtbR0}p` : "-";
  $: wtsRankMaxLabel = item.wtsRmax != null ? `${item.wtsRmax}p` : "-";
  $: wtbRankMaxLabel = item.wtbRmax != null ? `${item.wtbRmax}p` : "-";

  function selectCard(): void {
    dispatch("select", item);
  }

  onMount(() => {
    if (!cardEl) return;

    visibilityObserver = new IntersectionObserver(
      (entries) => {
        if (visibilityReported) return;
        const entry = entries[0];
        if (!entry?.isIntersecting) return;

        visibilityReported = true;
        dispatch("visible", item);
        visibilityObserver?.disconnect();
        visibilityObserver = null;
      },
      {
        root: null,
        rootMargin: "160px 0px 240px 0px",
        threshold: 0.01,
      },
    );

    visibilityObserver.observe(cardEl);
  });

  onDestroy(() => {
    if (visibilityObserver) {
      visibilityObserver.disconnect();
      visibilityObserver = null;
    }
  });
</script>

<div
  class="item-card group relative {mastered ? 'border-success/25' : ''} {item.isPrime
    ? 'border-accent/30'
    : ''}"
  role="button"
  tabindex="0"
  aria-label="Open details for {item.name}"
  on:click={selectCard}
  on:keydown={(event) => (event.key === "Enter" || event.key === " ") && selectCard()}
  bind:this={cardEl}
>
  <button
    type="button"
    class="expand-link absolute top-1.5 right-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-black/25 text-text-muted opacity-0 transition-[opacity,color,border-color] duration-100 group-hover:opacity-100 hover:text-accent hover:border-accent-dim"
    title="Open item details"
    aria-label="Open details for {item.name}"
    on:click|stopPropagation={() => dispatch("expand", item)}
  >
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      class="h-3.5 w-3.5"
    >
      <path d="M6 3H3v10h10v-3" />
      <path d="M9 2h5v5" />
      <path d="M14 2L7 9" />
    </svg>
  </button>
  <div class="item-img-wrap">
    <ItemImage
      src={item.displayImageUrl}
      fallbackSrc={item.imageUrl !== item.displayImageUrl ? item.imageUrl : null}
      alt={item.name}
    />
    {#if item.vaulted}<span class="vault-badge">V</span>{/if}
    {#if item.orderPlaced}
      <span
        class="absolute top-1.5 left-1.5 inline-flex items-center justify-center rounded-full border border-border bg-black/50 p-1"
        title="Listed on warframe.market"
      >
        <img src={NAV_ICON_URLS.market} alt="Listed on warframe.market" class="h-3 w-3" />
      </span>
    {/if}
    {#if item.inventoryGroup === "incomplete_sets"}
      <span
        class="absolute right-2 bottom-1.5 font-display text-base font-bold text-info drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
        >{item.ownedPartTypes ?? 0}/{item.totalPartTypes ?? 0}</span
      >
    {:else}
      <span
        class="absolute right-2 bottom-1.5 font-display text-base font-bold text-success drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
        >x{item.amount}</span
      >
    {/if}
  </div>
  <div class="item-body">
    <span class="item-name">{item.name}</span>
    <span class="item-type">
      {item.categoryLabel}
      {#if item.inventoryGroup === "full_sets"}
        {` · Complete ${typeof item.completeSets === "number" ? item.completeSets : 0}`}
      {:else if item.inventoryGroup === "incomplete_sets"}
        {` · Needs ${typeof item.missingParts === "number" ? item.missingParts : 0} ${
          item.missingParts === 1 ? "part" : "parts"
        }`}
      {/if}
    </span>

    <MarketMetricStrip
      platinum={item.platinum}
      ducats={item.ducats}
      ratio={item.ducatonator}
      {showDucats}
      className="mt-1"
    />

    {#if showRankOrderSummary}
      <div class="grid grid-cols-2 gap-1">
        <span
          class="inventory-rank-order-box grid gap-0.5 min-h-8 content-center border border-accent-bright/50 bg-accent/20 rounded-md py-1 px-1.5"
        >
          <span class="inventory-rank-order-label text-xs uppercase tracking-[0.04em] font-display"
            >WTS R{rankCapLabel}</span
          >
          <strong>{wtsRankMaxLabel}</strong>
        </span>
        <span
          class="inventory-rank-order-box grid gap-0.5 min-h-8 content-center border border-accent-bright/50 bg-accent/20 rounded-md py-1 px-1.5"
        >
          <span class="inventory-rank-order-label text-xs uppercase tracking-[0.04em] font-display"
            >WTB R{rankCapLabel}</span
          >
          <strong>{wtbRankMaxLabel}</strong>
        </span>
        <span
          class="inventory-rank-order-box grid gap-0.5 min-h-8 content-center border border-accent-bright/50 bg-accent/20 rounded-md py-1 px-1.5"
        >
          <span class="inventory-rank-order-label text-xs uppercase tracking-[0.04em] font-display"
            >WTS R0</span
          >
          <strong>{wtsRank0Label}</strong>
        </span>
        <span
          class="inventory-rank-order-box grid gap-0.5 min-h-8 content-center border border-accent-bright/50 bg-accent/20 rounded-md py-1 px-1.5"
        >
          <span class="inventory-rank-order-label text-xs uppercase tracking-[0.04em] font-display"
            >WTB R0</span
          >
          <strong>{wtbRank0Label}</strong>
        </span>
      </div>
    {/if}

    {#if canShowRank}
      <div class="item-rank-bar">
        <svg class="rank-bar-svg" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
          <rect
            class="rank-fill-svg"
            class:max={mastered}
            class:partial={!mastered}
            x="0"
            y="0"
            width={rankFillPct}
            height="4"
            rx="2"
            ry="2"
          ></rect>
        </svg>
      </div>
      <span class="item-rank-text">{item.rank}/{item.maxRank}</span>
    {/if}

    {#if item.equippedSummary}
      <span class="text-xs text-success whitespace-nowrap overflow-hidden text-ellipsis"
        >{item.equippedSummary}</span
      >
    {/if}
  </div>
</div>

<style>
  .inventory-rank-order-label {
    color: color-mix(in oklab, var(--accent-bright) 80%, white);
  }
  .inventory-rank-order-box :global(strong) {
    font-family: var(--font-display);
    color: var(--accent-bright);
    font-size: 0.86rem;
    line-height: 1.05;
    letter-spacing: 0.01em;
  }
</style>
