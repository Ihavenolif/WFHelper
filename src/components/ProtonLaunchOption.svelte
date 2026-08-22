<script lang="ts">
  import { onDestroy } from "svelte";
  import { tr } from "../lib/i18n.js";

  // Proton real-time overlay triggers: feeds game log lines live vs EE.log poll.
  // Keep Proton's channels because modern Wine logs OutputDebugString on +seh.
  const PROTON_LAUNCH_OPTION = "PROTON_LOG=1 %command%";

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
      // The field stays selectable when clipboard permission is denied.
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
    {$tr("settings.protonOverlaysTitle")}
  </h3>
  <p
    class={compact
      ? "mt-0.5 text-xs leading-snug text-text-muted"
      : "text-[var(--font-small-size,0.82rem)] text-text-secondary"}
  >
    {$tr("settings.protonOverlaysDesc")}
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
    {copied ? $tr("settings.copied") : $tr("settings.copy")}
  </button>
</div>
