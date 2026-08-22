<script lang="ts">
  import SortDirectionIcon from "./SortDirectionIcon.svelte";
  import { tr } from "../lib/i18n.js";
  import type { SortDirection } from "../types/filters.js";

  interface Props {
    value: string;
    options: ReadonlyArray<readonly [string, string]>;
    direction: SortDirection;
    onSelect: (value: string) => void;
    onToggleDirection: () => void;
    label?: string;
  }

  let {
    value,
    options,
    direction,
    onSelect,
    onToggleDirection,
    label = $tr("common.sort"),
  }: Props = $props();

  function onChange(event: Event): void {
    onSelect((event.currentTarget as HTMLSelectElement).value);
  }
</script>

<div class="shared-sort-controls">
  <span class="shared-sort-label">{label}</span>
  <div class="sort-control">
    <select class="shared-filter-select sort-control-select" {value} onchange={onChange}>
      {#each options as [key, text] (key)}
        <option value={key}>{text}</option>
      {/each}
    </select>
    <button
      type="button"
      class="sort-control-direction"
      onclick={onToggleDirection}
      title={direction === "asc" ? $tr("common.sortLowToHigh") : $tr("common.sortHighToLow")}
      aria-label={direction === "asc"
        ? $tr("common.sortDirectionAscending")
        : $tr("common.sortDirectionDescending")}
    >
      <SortDirectionIcon asc={direction === "asc"} />
    </button>
  </div>
</div>
