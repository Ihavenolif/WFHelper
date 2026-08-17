<script lang="ts">
  import { onMount } from "svelte";

  import { tr } from "../../lib/i18n.js";
  import { invoke } from "../../lib/ipc.js";
  import { buildCodexRows, type CodexRow } from "../../lib/codexScans.js";
  import SearchBox from "../SearchBox.svelte";

  let rows: CodexRow[] = [];
  let fetchedAt: number | null = null;
  let error: "no-account" | "fetch-failed" | null = null;
  let loading = false;
  let search = "";
  let incompleteOnly = false;

  async function load(force = false): Promise<void> {
    if (loading) return;
    loading = true;
    try {
      const result = await invoke("getCodexScans", force);
      if ("error" in result) {
        error = result.error;
      } else {
        error = null;
        fetchedAt = result.fetchedAt;
        rows = buildCodexRows(result.scans);
      }
    } catch {
      error = "fetch-failed";
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  $: query = search.trim().toLowerCase();
  $: filtered = rows.filter((row) => {
    if (incompleteOnly && row.complete !== false) return false;
    if (query && !row.name.toLowerCase().includes(query)) return false;
    return true;
  });
  $: doneCount = rows.filter((row) => row.complete === true).length;
  $: knownCount = rows.filter((row) => row.complete !== null).length;
  $: updatedLabel = fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : null;
</script>

<div class="grid gap-3">
  <div class="flex flex-wrap items-center gap-2">
    <SearchBox class="w-64" value={search} onValueChange={(value) => (search = value)} />
    <label class="flex cursor-pointer items-center gap-1.5 text-sm text-text-secondary">
      <input type="checkbox" bind:checked={incompleteOnly} />
      {$tr("codex.incompleteOnly")}
    </label>
    <div class="ml-auto flex items-center gap-2 text-xs text-text-muted">
      {#if updatedLabel}<span>{$tr("codex.updated", { when: updatedLabel })}</span>{/if}
      <button class="btn-secondary btn-sm" disabled={loading} on:click={() => void load(true)}>
        {loading ? $tr("codex.refreshing") : $tr("codex.refresh")}
      </button>
    </div>
  </div>

  {#if rows.length > 0}
    <p class="m-0 text-sm text-text-secondary">
      {$tr("codex.summary", { done: String(doneCount), total: String(knownCount) })}
    </p>
  {/if}

  {#if error === "no-account" && rows.length === 0}
    <div class="empty-state"><p>{$tr("codex.noAccount")}</p></div>
  {:else if error === "fetch-failed" && rows.length === 0}
    <div class="empty-state"><p>{$tr("codex.fetchFailed")}</p></div>
  {:else if filtered.length === 0}
    <div class="empty-state"><p>{$tr("codex.empty")}</p></div>
  {:else}
    <div
      class="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3"
      data-tour="mastery-codex-list"
    >
      {#each filtered as row (row.type)}
        <div
          class="flex items-center justify-between gap-2 rounded border border-border bg-bg-surface px-2.5 py-1.5"
        >
          <span class="truncate text-sm text-text-primary" title={row.type}>{row.name}</span>
          <span
            class="shrink-0 text-sm font-semibold {row.complete
              ? 'text-success'
              : row.complete === false
                ? 'text-text-secondary'
                : 'text-text-muted'}"
            title={$tr("codex.colScans")}
          >
            {row.scanned}{row.required !== null ? ` / ${row.required}` : ""}
            {#if row.complete}<span aria-hidden="true">✓</span>{/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</div>
