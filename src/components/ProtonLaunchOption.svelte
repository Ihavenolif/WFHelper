<script lang="ts">
  import { onDestroy } from "svelte";

  // Proton real-time overlay triggers: feeds game log lines live vs EE.log poll.
  const PROTON_LAUNCH_OPTION = "WINEDEBUG=+debugstr PROTON_LOG=1 %command%";

  /** Tighter type sizes for the setup wizard, which has less room than Settings. */
  export let compact = false;

  let copied = false;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyLaunchOption(): Promise<void> {
    try {
      await navigator.clipboard.writeText(PROTON_LAUNCH_OPTION);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2000);
    } catch {
      // clipboard blocked - the text is selectable in the field as a fallback
    }
  }

  onDestroy(() => {
    if (copyTimer) clearTimeout(copyTimer);
  });
</script>

<div>
  <h3
    class="m-0 mb-1.5 font-display font-semibold text-text-primary {compact
      ? 'text-sm'
      : 'text-[var(--font-heading-size,0.95rem)] tracking-[0.03em]'}"
  >
    Linux: instant overlays
  </h3>
  <p
    class={compact
      ? "mt-0.5 text-xs leading-snug text-text-muted"
      : "text-[var(--font-small-size,0.82rem)] text-text-secondary"}
  >
    Under Proton the overlay trigger relies on a delayed log. For instant triggers, add this to
    Warframe's Steam launch options (Steam &gt; right-click Warframe &gt; Properties &gt; Launch
    Options), then restart the game.
  </p>
</div>

<div class="mt-2.5 flex items-center gap-2">
  <input
    type="text"
    readonly
    value={PROTON_LAUNCH_OPTION}
    class="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--ui-panel-border)] bg-[var(--ui-input-bg,transparent)] px-2 py-1.5 font-mono text-[var(--font-small-size,0.82rem)] text-text-primary"
    on:focus={(e) => e.currentTarget.select()}
  />
  <button class="btn-secondary btn-sm shrink-0" on:click={copyLaunchOption}>
    {copied ? "Copied" : "Copy"}
  </button>
</div>
