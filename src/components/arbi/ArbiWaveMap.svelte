<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import ThemedPanel from "../ThemedPanel.svelte";
  import type { ArbiMissionType, ArbiRunStats } from "../../types/ipc.js";

  export let stats: ArbiRunStats;
  export let missionType: ArbiMissionType = "defense";

  /** Above this per-wave clear time the box is flagged slow (reference threshold). */
  const SLOW_WAVE_SEC = 25;
  /** Disruption rounds last minutes and vary by squad, so judge them against
   * this run's own median rather than a fixed clock. */
  const SLOW_ROUND_FACTOR = 1.25;
  const FAST_ROUND_FACTOR = 0.8;

  $: waves = stats.waves ?? [];
  $: rounds = missionType === "disruption";

  $: median = (() => {
    if (!rounds || waves.length === 0) return 0;
    const sorted = waves.map((w) => w.durationSec).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  })();

  function tone(durationSec: number): string {
    if (!rounds) {
      return durationSec > SLOW_WAVE_SEC
        ? "border-danger/50 bg-danger/15 text-danger"
        : "border-success/50 bg-success/15 text-success";
    }
    if (median <= 0) return "border-border bg-surface-2 text-text-secondary";
    if (durationSec > median * SLOW_ROUND_FACTOR)
      return "border-danger/50 bg-danger/15 text-danger";
    if (durationSec < median * FAST_ROUND_FACTOR)
      return "border-success/50 bg-success/15 text-success";
    return "border-border bg-surface-2 text-text-secondary";
  }

  function label(durationSec: number): string {
    const total = Math.max(0, Math.round(durationSec));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }
</script>

{#if waves.length > 0}
  <ThemedPanel className="flex flex-col p-5">
    <h3 class="m-0 text-sm font-semibold uppercase tracking-wide text-text-secondary">
      {rounds ? $tr("arbi.roundMap.title") : $tr("arbi.waveMap.title")}
    </h3>
    <p class="mb-3 mt-1 text-xs text-text-muted">
      {rounds ? $tr("arbi.roundMap.desc") : $tr("arbi.waveMap.desc")}
    </p>
    <div
      class="grid gap-1.5 {rounds
        ? 'grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))]'
        : 'grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))]'}"
    >
      {#each waves as wave (wave.index)}
        <div
          class="flex h-9 items-center justify-center rounded-sm border text-xs font-bold {tone(
            wave.durationSec,
          )}"
          title="{wave.index}: {wave.durationSec.toFixed(1)}s"
        >
          {rounds ? label(wave.durationSec) : wave.index}
        </div>
      {/each}
    </div>
  </ThemedPanel>
{/if}
