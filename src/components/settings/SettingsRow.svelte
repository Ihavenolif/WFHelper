<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label: string;
    // Widened because a caller computes it, and exactOptionalPropertyTypes is on.
    hint?: string | undefined;
    hintTitle?: string;
    dataSetting?: string;
    // A label forwards its clicks to the first control inside it, which is wrong
    // for a row whose control is a group of buttons.
    as?: "label" | "div";
    inputRow?: boolean;
    dimmed?: boolean;
    children: Snippet;
  }

  let {
    label,
    hint,
    hintTitle,
    dataSetting,
    as = "label",
    inputRow = false,
    dimmed = false,
    children,
  }: Props = $props();
</script>

{#snippet body()}
  <span>
    {label}
    {#if hint}
      <span class="block text-xs text-text-secondary" title={hintTitle}>{hint}</span>
    {/if}
  </span>
  {@render children()}
{/snippet}

{#if as === "label"}
  <label
    class="settings-control-row"
    class:settings-control-row-input={inputRow}
    class:opacity-50={dimmed}
    data-setting={dataSetting}
  >
    {@render body()}
  </label>
{:else}
  <div
    class="settings-control-row"
    class:settings-control-row-input={inputRow}
    class:opacity-50={dimmed}
    data-setting={dataSetting}
  >
    {@render body()}
  </div>
{/if}

<style>
  .settings-control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    border-radius: var(--radius-md);
    padding: 0.34rem 0.45rem;
    margin: 0 -0.45rem;
    cursor: pointer;
  }

  .settings-control-row:hover {
    background: var(--bg-hover);
  }

  /* :global also reaches the spans the caller slots in, as the one-file version did. */
  .settings-control-row :global(span) {
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .settings-control-row-input {
    cursor: default;
  }
</style>
