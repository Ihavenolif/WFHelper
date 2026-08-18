<script lang="ts">
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";

  import { tr } from "../../lib/i18n.js";
  import { invoke } from "../../lib/ipc.js";
  import {
    CODEX_FACTIONS,
    buildCodexRows,
    enemyImageUrl,
    sortCodexRows,
    type CodexRow,
    type CodexSortKey,
  } from "../../lib/codexScans.js";
  import SearchBox from "../SearchBox.svelte";

  let rows: CodexRow[] = [];
  let fetchedAt: number | null = null;
  let error: "no-account" | "fetch-failed" | "no-data" | null = null;
  let loading = false;
  let search = "";
  let incompleteOnly = false;
  let factionFilter = "all";
  let sortBy: CodexSortKey = "name";
  let brokenImages = new SvelteSet<string>();

  async function load(refresh = false): Promise<void> {
    if (loading) return;
    loading = true;
    try {
      const result = await invoke("getCodexScans", refresh);
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

  function markBroken(type: string): void {
    brokenImages = new SvelteSet(brokenImages).add(type);
  }

  $: shownFactions = CODEX_FACTIONS.filter((faction) =>
    rows.some((row) => row.faction === faction.key),
  );
  $: query = search.trim().toLowerCase();
  $: filtered = sortCodexRows(
    rows.filter((row) => {
      if (factionFilter !== "all" && row.faction !== factionFilter) return false;
      if (incompleteOnly && row.complete !== false) return false;
      if (query && !row.name.toLowerCase().includes(query)) return false;
      return true;
    }),
    sortBy,
  );
  $: doneCount = rows.filter((row) => row.complete === true).length;
  $: knownCount = rows.filter((row) => row.complete !== null).length;
  $: updatedLabel = fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : null;
</script>

<div class="grid gap-3">
  <div class="flex flex-wrap items-center gap-2">
    <SearchBox
      class="w-64"
      value={search}
      placeholder={$tr("codex.searchPlaceholder")}
      onValueChange={(value) => (search = value)}
    />
    <label class="flex cursor-pointer items-center gap-1.5 text-sm text-text-secondary">
      <input type="checkbox" bind:checked={incompleteOnly} />
      {$tr("codex.incompleteOnly")}
    </label>
    <div class="shared-select-group">
      <span class="shared-chip-label">{$tr("codex.sortLabel")}</span>
      <select class="shared-filter-select" bind:value={sortBy}>
        <option value="name">{$tr("codex.sortName")}</option>
        <option value="scans">{$tr("codex.sortScans")}</option>
        <option value="progress">{$tr("codex.sortProgress")}</option>
      </select>
    </div>
    <div class="ml-auto flex items-center gap-2 text-xs text-text-muted">
      {#if updatedLabel}<span>{$tr("codex.updated", { when: updatedLabel })}</span>{/if}
      <button class="btn-secondary btn-sm" disabled={loading} on:click={() => void load(true)}>
        {loading ? $tr("codex.refreshing") : $tr("codex.refresh")}
      </button>
    </div>
  </div>

  {#if rows.length > 0}
    <div class="filter-tabs flex-wrap" data-tour="mastery-codex-factions">
      <button
        class="filter-tab"
        data-active={factionFilter === "all" || undefined}
        class:active={factionFilter === "all"}
        on:click={() => (factionFilter = "all")}>{$tr("codex.factionAll")}</button
      >
      {#each shownFactions as faction (faction.key)}
        <button
          class="filter-tab"
          data-active={factionFilter === faction.key || undefined}
          class:active={factionFilter === faction.key}
          on:click={() => (factionFilter = faction.key)}>{faction.label}</button
        >
      {/each}
    </div>

    <p class="m-0 text-sm text-text-secondary">
      {$tr("codex.summary", { done: String(doneCount), total: String(knownCount) })}
    </p>
  {/if}

  {#if error === "no-data" && rows.length === 0}
    <div class="empty-state"><p>{$tr("codex.noData")}</p></div>
  {:else if error === "no-account" && rows.length === 0}
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
        {@const imageUrl = brokenImages.has(row.type) ? null : enemyImageUrl(row.image)}
        <div
          class="flex items-center gap-2.5 rounded border border-border bg-bg-surface px-2.5 py-1.5"
        >
          {#if imageUrl}
            <img
              class="h-9 w-9 shrink-0 rounded object-cover object-top"
              src={imageUrl}
              alt=""
              loading="lazy"
              on:error={() => markBroken(row.type)}
            />
          {:else}
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-bg-raised text-sm font-bold text-text-muted"
            >
              {row.name.slice(0, 1)}
            </div>
          {/if}
          <span class="min-w-0 flex-1 truncate text-sm text-text-primary" title={row.type}
            >{row.name}</span
          >
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
