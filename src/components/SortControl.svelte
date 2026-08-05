<script lang="ts">
  import SortDirectionIcon from "./SortDirectionIcon.svelte";
  import type { SortDirection } from "../types/filters.js";

  interface Props {
    value: string;
    options: ReadonlyArray<readonly [string, string]>;
    direction: SortDirection;
    onSelect: (value: string) => void;
    onToggleDirection: () => void;
    label?: string;
  }

  let { value, options, direction, onSelect, onToggleDirection, label = "Sort" }: Props = $props();

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
      title={direction === "asc" ? "Low to high" : "High to low"}
      aria-label={direction === "asc" ? "Sort direction ascending" : "Sort direction descending"}
    >
      <SortDirectionIcon asc={direction === "asc"} />
    </button>
  </div>
</div>
