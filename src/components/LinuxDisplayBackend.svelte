<script lang="ts">
  import { onMount } from "svelte";

  import { invoke } from "../lib/ipc.js";
  import type { DisplayPreference, LinuxDisplayInfo } from "../../config/shared/linuxDisplay.js";

  const OPTIONS: Array<{ value: DisplayPreference; label: string; hint: string }> = [
    { value: "auto", label: "Automatic", hint: "XWayland, falling back if no window appears" },
    { value: "x11", label: "XWayland", hint: "Needed for overlays above the game" },
    { value: "wayland", label: "Native Wayland", hint: "Use if the window stays invisible" },
  ];

  let info: LinuxDisplayInfo | null = null;
  let changed = false;

  onMount(async () => {
    info = await invoke("getLinuxDisplay");
  });

  async function choose(preference: DisplayPreference): Promise<void> {
    if (!info || info.preference === preference) return;
    info = await invoke("setLinuxDisplay", preference);
    changed = true;
  }
</script>

<div>
  <h3
    class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
  >
    Linux: display backend
  </h3>
  <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">
    WFHelper normally uses XWayland so overlays can appear above Warframe. Try Native Wayland if the
    app window is invisible.
  </p>
</div>

<div class="mt-2.5 flex flex-wrap gap-2">
  {#each OPTIONS as option (option.value)}
    <button
      class={info?.preference === option.value ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
      title={option.hint}
      disabled={!info}
      on:click={() => choose(option.value)}>{option.label}</button
    >
  {/each}
</div>

{#if changed}
  <p class="mt-2 text-[var(--font-small-size,0.82rem)] text-warning">Restart WFHelper to apply.</p>
{/if}
