<script lang="ts">
  import { PLATINUM_ICON_URL } from "../../lib/assetUrls.js";
  import MarketOrderSummary from "./MarketOrderSummary.svelte";
  import MarketRowBase from "./MarketRowBase.svelte";
  import OrderStepper from "./OrderStepper.svelte";
  import { isRankedGroup } from "../../../config/shared/numeric.js";
  import type { InventoryViewItem } from "../../lib/inventoryMarket.js";
  import type { OrderModalHint, WfmOrder } from "../../types/market.js";

  export let order: WfmOrder;
  export let item: (InventoryViewItem & { sourceOrderId?: string }) | null = null;
  export let compact = false;
  export let selected = false;
  export let onSelectChange: (orderId: string, checked: boolean) => void;
  export let onOpen: (order: WfmOrder) => void;
  export let onEdit: (order: WfmOrder, hint: OrderModalHint) => void;
  export let onDelete: (orderId: string) => void;
  export let onInlineSave: (
    order: WfmOrder,
    updates: { platinum: number; quantity: number },
  ) => Promise<boolean>;

  let draftPlatinum = 0;
  let draftQuantity = 0;
  let savingInline = false;

  // Re-sync drafts whenever the underlying order values change (refetch/save).
  $: syncDrafts(order.platinum, order.quantity);
  $: dirty = draftPlatinum !== order.platinum || draftQuantity !== order.quantity;

  function syncDrafts(platinum: number, quantity: number): void {
    draftPlatinum = platinum;
    draftQuantity = quantity;
  }

  async function applyInline(): Promise<void> {
    if (!dirty || savingInline) return;
    savingInline = true;
    try {
      await onInlineSave(order, { platinum: draftPlatinum, quantity: draftQuantity });
    } finally {
      savingInline = false;
    }
  }

  function stopAndApply(event: MouseEvent): void {
    event.stopPropagation();
    void applyInline();
  }

  $: orderKind = order.orderType === "buy" ? "WTB" : "WTS";
  $: orderKindClass =
    order.orderType === "buy" ? "bg-sky-500/20 text-sky-300" : "bg-amber-500/20 text-amber-300";
  $: liveLabel = order.visible ? "live" : "hidden";
  $: ownedCount = item?.amount ?? 0;
  $: isRankedListing = item
    ? isRankedGroup(item.inventoryGroup) && item.maxRank > 0
    : order.modRank != null;
  $: rankCap = item?.maxRank && item.maxRank > 0 ? Math.floor(item.maxRank) : 0;
  $: listedRank = order.modRank != null ? Math.max(0, Math.floor(order.modRank)) : null;
  $: summaryRank =
    isRankedListing && listedRank != null ? (listedRank === rankCap ? rankCap : 0) : null;
  $: summaryWts =
    summaryRank === rankCap && summaryRank !== 0
      ? (item?.wtsRmax ?? null)
      : summaryRank === 0
        ? (item?.wtsR0 ?? null)
        : null;
  $: summaryWtb =
    summaryRank === rankCap && summaryRank !== 0
      ? (item?.wtbRmax ?? null)
      : summaryRank === 0
        ? (item?.wtbR0 ?? null)
        : null;
  $: medianLabel = item?.platinum != null ? `~${item.platinum}p` : "-";
  $: wtsLabel = summaryWts != null ? `${summaryWts}p` : "-";
  $: wtbLabel = summaryWtb != null ? `${summaryWtb}p` : "-";

  function handleCheckbox(event: Event): void {
    onSelectChange(order.id, (event.currentTarget as HTMLInputElement).checked);
  }

  function stopAndEdit(event: MouseEvent): void {
    event.stopPropagation();
    onEdit(order, { wts: wtsLabel, wtb: wtbLabel, median: medianLabel });
  }

  function stopAndDelete(event: MouseEvent): void {
    event.stopPropagation();
    onDelete(order.id);
  }
</script>

{#if compact}
  <MarketRowBase
    compact
    title={order.itemName}
    thumb={order.itemThumb}
    badgeLabel={orderKind}
    badgeClass={orderKindClass}
    onOpen={() => onOpen(order)}
  >
    <svelte:fragment slot="headerStart">
      <input
        type="checkbox"
        class="h-3.5 w-3.5 shrink-0 accent-accent"
        checked={selected}
        title="Select for bulk action"
        on:click|stopPropagation
        on:change={handleCheckbox}
      />
    </svelte:fragment>
    <svelte:fragment slot="titleMeta">
      <span class="ml-1.5 text-xs font-semibold text-text-muted">Owned {ownedCount}</span>
    </svelte:fragment>
    <svelte:fragment slot="headerEnd">
      {#if order.modRank != null}
        <span class="shrink-0 rounded-sm bg-accent/20 px-1 py-0.5 text-xs font-bold text-accent">
          R{order.modRank}
        </span>
      {/if}
      <span
        class="shrink-0 text-xs font-semibold {order.visible ? 'text-success' : 'text-warning'}"
        title={order.visible ? "Visible on WFM" : "Hidden on WFM"}
      >
        {liveLabel}
      </span>
    </svelte:fragment>
    <svelte:fragment slot="compactBody">
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="flex items-center gap-3">
          <span class="flex items-center gap-1" title="Listed quantity">
            <span class="text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">Q:</span
            >
            <OrderStepper
              value={draftQuantity}
              min={1}
              max={999}
              label="quantity"
              onChange={(next) => (draftQuantity = next)}
            />
          </span>
          <span class="flex items-center gap-1" title="Price (platinum)">
            <img src={PLATINUM_ICON_URL} alt="" width="15" height="15" class="shrink-0" />
            <OrderStepper
              value={draftPlatinum}
              min={1}
              max={99999}
              label="price"
              accent
              onChange={(next) => (draftPlatinum = next)}
            />
          </span>
          {#if dirty}
            <button
              class="btn-success btn-sm h-6 !px-1.5 text-xs font-black"
              title="Apply new price/quantity"
              aria-label="Apply changes"
              disabled={savingInline}
              on:click={stopAndApply}>&check;</button
            >
          {/if}
        </div>
        <MarketOrderSummary {isRankedListing} {summaryRank} {wtsLabel} {wtbLabel} {medianLabel} />
      </div>
    </svelte:fragment>
    <svelte:fragment slot="compactActions">
      <div class="flex shrink-0 items-center gap-2">
        <button class="btn-sm btn-secondary h-8" title="Edit" on:click={stopAndEdit}>Edit</button>
        <button
          class="btn-sm btn-danger h-8 w-8 px-0 text-base font-black"
          title="Delete"
          aria-label="Delete"
          on:click={stopAndDelete}>X</button
        >
      </div>
    </svelte:fragment>
  </MarketRowBase>
{:else}
  <MarketRowBase
    title={order.itemName}
    thumb={order.itemThumb}
    fullClass="grid grid-cols-[auto_minmax(0,1fr)_auto] items-stretch gap-2 px-2.5 py-2.5"
    fullMainClass="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] gap-x-2 gap-y-1"
    fullContentClass="contents"
    fullImageClass="row-span-2 h-11 w-11 rounded-[var(--radius-md)] object-contain"
    onOpen={() => onOpen(order)}
  >
    <svelte:fragment slot="fullStart">
      <input
        type="checkbox"
        class="mt-1 h-[15px] w-[15px] shrink-0 accent-accent"
        checked={selected}
        title="Select for bulk action"
        on:click|stopPropagation
        on:change={handleCheckbox}
      />
    </svelte:fragment>
    <svelte:fragment slot="titleMeta">
      <span class="ml-2 text-xs font-semibold text-text-muted">Owned {ownedCount}</span>
    </svelte:fragment>
    <svelte:fragment slot="fullBody">
      <MarketOrderSummary {isRankedListing} {summaryRank} {wtsLabel} {wtbLabel} {medianLabel} />
    </svelte:fragment>
    <svelte:fragment slot="fullActions">
      <div class="flex shrink-0 items-center gap-2">
        {#if order.modRank != null}
          <span class="shrink-0 rounded-sm bg-accent/20 px-1 py-0.5 text-xs font-bold text-accent">
            R{order.modRank}
          </span>
        {/if}
        {#if order.visible}
          <span class="order-vis border-success/35 bg-success/15 text-success">Visible</span>
        {:else}
          <span class="order-vis border-warning/35 bg-warning/15 text-warning">Hidden</span>
        {/if}
        <span class="flex items-center gap-1" title="Listed quantity">
          <span class="text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">Q:</span>
          <OrderStepper
            value={draftQuantity}
            min={1}
            max={999}
            label="quantity"
            onChange={(next) => (draftQuantity = next)}
          />
        </span>
        <span class="flex items-center gap-1" title="Price (platinum)">
          <img src={PLATINUM_ICON_URL} alt="" width="14" height="14" class="shrink-0" />
          <OrderStepper
            value={draftPlatinum}
            min={1}
            max={99999}
            label="price"
            accent
            onChange={(next) => (draftPlatinum = next)}
          />
        </span>
        {#if dirty}
          <button
            class="btn-success btn-sm h-6 !px-1.5 text-xs font-black"
            title="Apply new price/quantity"
            aria-label="Apply changes"
            disabled={savingInline}
            on:click={stopAndApply}>&check;</button
          >
        {/if}
        <button class="btn-sm btn-secondary h-8" on:click={stopAndEdit}>Edit</button>
        <button
          class="btn-sm btn-danger h-8 w-8 px-0 text-base font-black"
          title="Delete"
          aria-label="Delete"
          on:click={stopAndDelete}>X</button
        >
      </div>
    </svelte:fragment>
  </MarketRowBase>
{/if}
