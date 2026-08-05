<script lang="ts">
  interface Props {
    asc: boolean;
  }

  let { asc }: Props = $props();
</script>

<svg
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#if asc}
    <path d="M2 4h3M2 8h5.5M2 12h8" />
    <path d="M12.5 13V3" />
    <path d="M10.4 5.1L12.5 3l2.1 2.1" />
  {:else}
    <path d="M2 4h8M2 8h5.5M2 12h3" />
    <path d="M12.5 3v10" />
    <path d="M10.4 10.9L12.5 13l2.1-2.1" />
  {/if}
</svg>
