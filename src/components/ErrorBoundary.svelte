<script lang="ts">
  import { addToast } from "../stores/toasts.js";
  import { log } from "../lib/log.js";
  import { tr } from "../lib/i18n.js";
  import { normalizeErrorMessage } from "../../config/shared/errors.js";

  // Svelte boundaries handle render failures, but not async errors. Report window
  // errors separately without replacing the UI.
  function reportAsync(reason: unknown): void {
    addToast({
      level: "error",
      title: $tr("common.rendererErrorTitle"),
      message: normalizeErrorMessage(reason, $tr("common.unknownRendererError")),
      sticky: true,
    });
  }

  function onWindowError(event: Event): void {
    const err = event as ErrorEvent;
    reportAsync(err.error ?? err.message);
  }

  function onUnhandledRejection(event: Event): void {
    reportAsync((event as PromiseRejectionEvent).reason);
  }

  function onRenderCrash(error: unknown): void {
    log.error("[Renderer] render boundary caught", error);
  }
</script>

<svelte:window on:error={onWindowError} on:unhandledrejection={onUnhandledRejection} />

<svelte:boundary onerror={onRenderCrash}>
  <slot />

  {#snippet failed(error, reset)}
    <section class="m-6 rounded-xl border border-red-300/35 bg-danger/10 p-5 text-[#fee2e2]">
      <h2 class="font-display text-2xl tracking-wide">{$tr("common.rendererCrashed")}</h2>
      <p class="mt-2 text-sm leading-relaxed text-red-100/90">
        {normalizeErrorMessage(error, $tr("common.unknownRendererError"))}
      </p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          class="cursor-pointer rounded border border-red-200/40 bg-danger/20 px-3 py-1.5 text-sm transition-[border-color,background] duration-150 hover:border-red-100/70 hover:bg-danger/30"
          on:click={reset}
        >
          {$tr("common.tryRecover")}
        </button>
        <button
          class="cursor-pointer rounded border border-white/25 bg-white/10 px-3 py-1.5 text-sm transition-[border-color,background] duration-150 hover:border-white/40 hover:bg-white/15"
          on:click={() => window.location.reload()}
        >
          {$tr("common.reloadApp")}
        </button>
      </div>
    </section>
  {/snippet}
</svelte:boundary>
