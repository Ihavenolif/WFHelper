<script lang="ts">
  interface Props {
    value: string;
    placeholder?: string;
    class?: string;
    onValueChange?: (value: string) => void;
  }

  let {
    value = $bindable(),
    placeholder = "Search...",
    class: extraClass = "",
    onValueChange,
  }: Props = $props();

  let inputEl: HTMLInputElement | undefined = $state();

  function handleInput(): void {
    onValueChange?.(value);
  }

  function clear(): void {
    value = "";
    onValueChange?.("");
    inputEl?.focus();
  }
</script>

<div class="search-box {extraClass}">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
  <input
    type="text"
    bind:this={inputEl}
    bind:value
    {placeholder}
    oninput={handleInput}
    data-search-focus
  />
  {#if value}
    <button type="button" class="search-box-clear" aria-label="Clear search" onclick={clear}
      >&times;</button
    >
  {/if}
</div>
