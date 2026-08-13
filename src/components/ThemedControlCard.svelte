<script lang="ts">
  export let as: "div" | "label" = "div";
  export let density: "default" | "tight" = "default";

  $: padClass = density === "tight" ? "py-2 px-2" : "py-2 px-2.5";
  $: baseClass = `border border-[var(--ui-control-border)] rounded-[var(--radius-lg)] bg-[var(--ui-control-bg)] ${padClass}`;
</script>

{#if as === "label"}
  <label class="flex items-center justify-between gap-2.5 cursor-pointer {baseClass}">
    <slot />
  </label>
{:else}
  <div class={baseClass}>
    <slot />
  </div>
{/if}
