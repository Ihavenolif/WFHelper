<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import {
    overlaySettings,
    overlaySettingsLoaded,
    OVERLAY_DEFAULTS,
    applyOverlaySettingsResponse,
  } from "../stores/overlaySettings.js";
  import AppearanceCard from "../components/settings/AppearanceCard.svelte";
  import ProtonLaunchOption from "../components/ProtonLaunchOption.svelte";
  import LinuxDisplayBackend from "../components/LinuxDisplayBackend.svelte";
  import SegmentedControl from "../components/SegmentedControl.svelte";
  import { invoke, send, getPlatform } from "../lib/ipc.js";
  import { onInventoryLoaded } from "../lib/actions.js";
  import {
    describeInventorySource,
    INVENTORY_SOURCE_OPTIONS,
  } from "../lib/inventorySourceLabel.js";
  import {
    tr,
    locale,
    setLocale,
    LOCALE_OPTIONS,
    type LocaleCode,
    type MessageKey,
  } from "../lib/i18n.js";
  import ThemedSelect from "../components/ThemedSelect.svelte";
  import { hideFoundryClaims, hideFounderMasteryItems } from "../stores/preferences.js";
  import { TOGGLEABLE_TABS, tabVisibility } from "../stores/sidebarTabs.js";
  import type { ToggleableView } from "../types/views.js";
  import { startTour } from "../stores/tour.js";
  import { currentView } from "../stores/app.js";
  import type { InventorySource, OverlaySettings, OverlayWindowKey } from "../types/ipc.js";

  type OverlaySettingsFormInput = Partial<OverlaySettings> & {
    showTradeNotification?: boolean;
  };

  let settingsTab: "general" | "appearance" | "overlay" = "general";
  // The store owns the language: the select only mirrors it, so an external
  // setLocale is not written back over.
  let languageChoice: LocaleCode;
  $: languageChoice = $locale;
  $: if (languageChoice !== $locale) setLocale(languageChoice);
  let statusMsg = "";
  let statusError = false;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  const isLinux = getPlatform() === "linux";

  async function openScanDebugFolder(): Promise<void> {
    try {
      const result = await invoke("openScanDebugFolder");
      if (!result?.ok) flashStatus($tr("settings.scanDebugFolderFailed"), true);
    } catch {
      flashStatus($tr("settings.scanDebugFolderFailed"), true);
    }
  }

  async function openLogFolder(): Promise<void> {
    try {
      const result = await invoke("openLogFolder");
      if (!result?.ok) flashStatus($tr("settings.logFolderFailed"), true);
    } catch {
      flashStatus($tr("settings.logFolderFailed"), true);
    }
  }

  function flashStatus(msg: string, isError: boolean): void {
    statusMsg = msg;
    statusError = isError;
    if (statusTimer) clearTimeout(statusTimer);
    if (!isError) statusTimer = setTimeout(() => (statusMsg = ""), 2000);
  }

  let inventorySource: InventorySource = "helper";
  let inventoryPath: string | null = null;
  let switchingSource = false;

  $: sourceDescription = describeInventorySource(inventorySource, inventoryPath);
  $: sourceLabel = $tr(sourceDescription.labelKey);
  $: sourceTitle = sourceDescription.path || sourceLabel;
  $: inventorySourceOptions = INVENTORY_SOURCE_OPTIONS.map((option) => ({
    value: option.value,
    label: $tr(option.labelKey),
  }));
  $: autoSyncApplies = inventorySource === "helper";

  async function refreshInventorySource(): Promise<void> {
    try {
      const status = await invoke("getInventoryStatus");
      inventorySource = status.source;
      inventoryPath = status.path;
    } catch {
      // keep the last known source rather than claiming a wrong one
    }
  }

  // The pickers own the switch to a user file: a cancelled dialog returns null
  // and main keeps the current source.
  async function selectInventorySource(next: InventorySource): Promise<void> {
    if (switchingSource || next === inventorySource) return;
    switchingSource = true;
    try {
      if (next === "helper") {
        await invoke("setInventorySource", "helper");
      } else {
        const data =
          next === "aleca"
            ? await invoke("openAlecaFrameInventoryFile")
            : await invoke("openInventoryFile", "manual");
        if (data) await onInventoryLoaded(data);
      }
      await refreshInventorySource();
    } catch {
      flashStatus($tr("settings.inventorySourceChangeFailed"), true);
      await refreshInventorySource();
    } finally {
      switchingSource = false;
    }
  }

  const OVERLAY_SCALE_ROWS: Array<{ key: OverlayWindowKey; labelKey: MessageKey }> = [
    { key: "reward", labelKey: "settings.overlayScaleReward" },
    { key: "planner", labelKey: "settings.overlayScalePlanner" },
    { key: "rivenLeft", labelKey: "settings.overlayScaleRivenLeft" },
    { key: "rivenRight", labelKey: "settings.overlayScaleRivenRight" },
    { key: "arbiSummary", labelKey: "settings.overlayScaleArbiSummary" },
  ];
  let windowScales: Partial<Record<OverlayWindowKey, number>> = {};

  // Same channel the setup wizard uses: persists overlayWindowScales + live-applies.
  async function saveWindowScale(key: OverlayWindowKey, value: number): Promise<void> {
    windowScales = { ...windowScales, [key]: value };
    try {
      const result = await invoke("saveOverlayScale", key, value);
      if (!result?.ok) flashStatus($tr("settings.saveFailed"), true);
    } catch {
      flashStatus($tr("settings.saveFailed"), true);
    }
  }

  // One normalizer feeds both the form and the saved payload, so a new
  // OverlaySettings field only has to be listed here once.
  function normalizeOverlayForm(s: OverlaySettingsFormInput) {
    return {
      autoTriggerEnabled: !!s.autoTriggerEnabled,
      notificationSoundEnabled:
        s.notificationSoundEnabled ?? OVERLAY_DEFAULTS.notificationSoundEnabled,
      wfmNotificationsEnabled: !!s.wfmNotificationsEnabled,
      messageNotificationsEnabled:
        s.messageNotificationsEnabled ?? OVERLAY_DEFAULTS.messageNotificationsEnabled,
      messageNotificationsWhileFocused: !!s.messageNotificationsWhileFocused,
      autoCloseWfmOrders: s.autoCloseWfmOrders ?? OVERLAY_DEFAULTS.autoCloseWfmOrders,
      tradeRepHotkeyEnabled: s.tradeRepHotkeyEnabled ?? OVERLAY_DEFAULTS.tradeRepHotkeyEnabled,
      tradeRepHotkey: s.tradeRepHotkey || OVERLAY_DEFAULTS.tradeRepHotkey,
      // showTradeNotification is the pre-0.2 key, still read so old settings files migrate.
      tradeNotificationOverlayEnabled:
        s.tradeNotificationOverlayEnabled ??
        s.showTradeNotification ??
        OVERLAY_DEFAULTS.tradeNotificationOverlayEnabled,
      relicRewardsOverlayEnabled:
        s.relicRewardsOverlayEnabled ?? OVERLAY_DEFAULTS.relicRewardsOverlayEnabled,
      relicRecommendationOverlayEnabled:
        s.relicRecommendationOverlayEnabled ?? OVERLAY_DEFAULTS.relicRecommendationOverlayEnabled,
      rivenOverlayEnabled: s.rivenOverlayEnabled ?? OVERLAY_DEFAULTS.rivenOverlayEnabled,
      arbiSummaryOverlayEnabled:
        s.arbiSummaryOverlayEnabled ?? OVERLAY_DEFAULTS.arbiSummaryOverlayEnabled,
      arbiTrackingEnabled: s.arbiTrackingEnabled ?? OVERLAY_DEFAULTS.arbiTrackingEnabled,
      autoInventorySyncEnabled:
        s.autoInventorySyncEnabled ?? OVERLAY_DEFAULTS.autoInventorySyncEnabled,
      ocrDebugImagesEnabled: s.ocrDebugImagesEnabled ?? OVERLAY_DEFAULTS.ocrDebugImagesEnabled,
      hotkeyEnabled: !!s.hotkeyEnabled,
      hotkey: s.hotkey || OVERLAY_DEFAULTS.hotkey,
      interactionHotkeyEnabled: !!s.interactionHotkeyEnabled,
      interactionHotkey: s.interactionHotkey || OVERLAY_DEFAULTS.interactionHotkey,
    };
  }

  let form = normalizeOverlayForm(OVERLAY_DEFAULTS);
  // Display-only: the per-window rows fall back to it, but no control edits it,
  // so it is deliberately absent from the saved payload.
  let overlayScale = OVERLAY_DEFAULTS.overlayScale;

  function applyToForm(s: OverlaySettingsFormInput): void {
    form = normalizeOverlayForm(s);
    overlayScale = s.overlayScale ?? OVERLAY_DEFAULTS.overlayScale;
    windowScales = { ...(s.overlayWindowScales || {}) };
  }

  onMount(async () => {
    if (!$overlaySettingsLoaded) {
      try {
        const loaded = await invoke("getOverlaySettings");
        if (loaded) applyOverlaySettingsResponse(loaded);
      } catch {
        statusMsg = $tr("settings.loadFailed");
        statusError = true;
      }
    }
    applyToForm($overlaySettings);
    await refreshInventorySource();
  });

  let saveRevision = 0;
  let saveQueue: Promise<void> = Promise.resolve();

  function currentOverlayPayload() {
    return { ...form };
  }

  function queueSave(
    payload: ReturnType<typeof currentOverlayPayload>,
    successMessage: string,
    failureMessage: string,
  ): Promise<void> {
    const revision = ++saveRevision;
    saveQueue = saveQueue.then(async () => {
      try {
        const saved = await invoke("setOverlaySettings", payload);
        if (revision !== saveRevision) return;
        if (saved) {
          applyOverlaySettingsResponse(saved);
          applyToForm($overlaySettings);
        }
        flashStatus(successMessage, false);
      } catch {
        if (revision === saveRevision) flashStatus(failureMessage, true);
      }
    });
    return saveQueue;
  }

  function save(): Promise<void> {
    return queueSave(currentOverlayPayload(), $tr("settings.saved"), $tr("settings.saveFailed"));
  }

  // Every control saves on change; there is no separate save step.
  function autoSave(): void {
    void save();
  }

  // Return undefined for Escape, bare Tab, and lone modifiers so cancellation,
  // navigation, and incomplete combos retain their normal behavior.
  function captureAccelerator(e: KeyboardEvent): string | undefined {
    const key = e.key;
    if (key === "Escape") return undefined;
    if (["Control", "Shift", "Alt", "Meta", "OS"].includes(key)) return undefined;
    if (key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return undefined;
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");
    let main = key;
    if (main === " ") main = "Space";
    else if (main.startsWith("Arrow")) main = main.slice(5);
    else if (main.length === 1) main = main.toUpperCase();
    parts.push(main);
    e.preventDefault();
    return parts.join("+");
  }

  function recordTriggerHotkey(e: KeyboardEvent): void {
    const accel = captureAccelerator(e);
    if (accel === undefined) return;
    form.hotkey = accel;
    autoSave();
  }

  function recordInteractionHotkey(e: KeyboardEvent): void {
    const accel = captureAccelerator(e);
    if (accel === undefined) return;
    form.interactionHotkey = accel;
    autoSave();
  }

  function recordTradeRepHotkey(e: KeyboardEvent): void {
    const accel = captureAccelerator(e);
    if (accel === undefined) return;
    form.tradeRepHotkey = accel;
    autoSave();
  }

  function resetDefaults() {
    applyToForm(OVERLAY_DEFAULTS);
    void queueSave(
      currentOverlayPayload(),
      $tr("settings.defaultsRestored"),
      $tr("settings.defaultsRestoreFormFailed"),
    );
  }

  function testTrigger() {
    send("simulate-relic-trigger");
  }

  const appVersion = import.meta.env.VITE_APP_VERSION || "?";

  function openLink(url: string): void {
    send("open-external", url);
  }

  // Local mirror of the per-tab visibility stores so each checkbox can bind to a
  // plain bool; the change handler pushes back to the persisted store.
  const tabChecked = Object.fromEntries(
    TOGGLEABLE_TABS.map((t) => [t.view, get(tabVisibility[t.view])]),
  ) as Record<ToggleableView, boolean>;

  function setTabVisible(view: ToggleableView): void {
    tabVisibility[view].set(tabChecked[view]);
  }
</script>

<section class="view active mx-auto w-full max-w-[1120px]">
  <div class="view-header">
    <h2>{$tr("common.settings")}</h2>
  </div>

  <div class="tab-bar">
    <button
      class="tab-item"
      class:active={settingsTab === "general"}
      data-tour-tab="general"
      on:click={() => (settingsTab = "general")}
    >
      <span>{$tr("settings.tabGeneral")}</span>
    </button>
    <button
      class="tab-item"
      class:active={settingsTab === "appearance"}
      data-tour-tab="appearance"
      on:click={() => (settingsTab = "appearance")}
    >
      <span>{$tr("common.appearance")}</span>
    </button>
    <button
      class="tab-item"
      class:active={settingsTab === "overlay"}
      data-tour-tab="overlay"
      on:click={() => (settingsTab = "overlay")}
    >
      <span>{$tr("common.overlays")}</span>
    </button>
  </div>

  {#if settingsTab === "general"}
    <div class="settings-tab-grid settings-masonry py-3">
      <article
        class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <div>
          <h3
            class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
          >
            {$tr("settings.languageTitle")}
          </h3>
          <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">
            {$tr("settings.languageDesc")}
          </p>
        </div>
        <div class="mt-2.5 grid gap-1">
          <label class="settings-control-row">
            <span>{$tr("settings.languageRow")}</span>
            <ThemedSelect bind:value={languageChoice}>
              {#each LOCALE_OPTIONS as option}
                <option value={option.code}>{option.label}</option>
              {/each}
            </ThemedSelect>
          </label>
        </div>
      </article>

      <article
        class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <div>
          <h3
            class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
          >
            {$tr("settings.notificationsTitle")}
          </h3>
          <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">
            {$tr("settings.notificationsDesc")}
          </p>
        </div>

        <div class="mt-2.5 grid gap-1">
          <label class="settings-control-row">
            <span>{$tr("settings.windowsNotifSound")}</span>
            <input
              type="checkbox"
              bind:checked={form.notificationSoundEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row">
            <span>{$tr("settings.wfmDmNotifications")}</span>
            <input
              type="checkbox"
              bind:checked={form.wfmNotificationsEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row">
            <span>{$tr("settings.inGameMessageNotifications")}</span>
            <input
              type="checkbox"
              bind:checked={form.messageNotificationsEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row" class:opacity-50={!form.messageNotificationsEnabled}>
            <span>{$tr("settings.notifyWhileFocused")}</span>
            <input
              type="checkbox"
              bind:checked={form.messageNotificationsWhileFocused}
              disabled={!form.messageNotificationsEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row">
            <span>{$tr("settings.unlistOnTrade")}</span>
            <input
              type="checkbox"
              bind:checked={form.autoCloseWfmOrders}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row">
            <span>{$tr("settings.tradeRepKeybindEnable")}</span>
            <input
              type="checkbox"
              bind:checked={form.tradeRepHotkeyEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row settings-control-row-input">
            <span>{$tr("settings.tradeRepKeybind")}</span>
            <input
              type="text"
              bind:value={form.tradeRepHotkey}
              disabled={!form.tradeRepHotkeyEnabled}
              placeholder={$tr("settings.pressKeyCombination")}
              on:keydown={recordTradeRepHotkey}
              on:change={autoSave}
              class="settings-input"
            />
          </label>
        </div>
      </article>

      <article
        class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <div>
          <h3
            class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
          >
            {$tr("common.arbitrations")}
          </h3>
          <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">
            {$tr("settings.arbitrationsDesc")}
          </p>
        </div>

        <div class="mt-2.5 grid gap-1">
          <label class="settings-control-row">
            <span>{$tr("settings.trackArbiRuns")}</span>
            <input
              type="checkbox"
              bind:checked={form.arbiTrackingEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>
        </div>
      </article>

      <article
        class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <div>
          <h3
            class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
          >
            {$tr("common.inventory")}
          </h3>
          <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">
            {$tr("settings.inventoryDesc")}
          </p>
        </div>

        <div class="mt-2.5 grid gap-1">
          <div class="settings-control-row">
            <span>
              {$tr("common.source")}
              <span class="block text-xs text-text-secondary" title={sourceTitle}>
                {sourceLabel}{sourceDescription.detail ? ` - ${sourceDescription.detail}` : ""}
              </span>
            </span>
            <SegmentedControl
              value={inventorySource}
              options={inventorySourceOptions}
              onChange={(next) => void selectInventorySource(next)}
              disabled={switchingSource}
            />
          </div>
          <label class="settings-control-row">
            <span>
              {$tr("settings.autoInventorySync")}
              {#if !autoSyncApplies}
                <span class="block text-xs text-text-secondary"
                  >{$tr("settings.helperSourceOnly")}</span
                >
              {/if}
            </span>
            <input
              type="checkbox"
              bind:checked={form.autoInventorySyncEnabled}
              on:change={autoSave}
              disabled={!autoSyncApplies}
              class="accent-accent disabled:opacity-50"
            />
          </label>
          <label class="settings-control-row">
            <span>{$tr("settings.hideFoundryPending")}</span>
            <input type="checkbox" bind:checked={$hideFoundryClaims} class="accent-accent" />
          </label>
        </div>
      </article>

      <article
        class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <div>
          <h3
            class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
          >
            {$tr("common.mastery")}
          </h3>
          <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">
            {$tr("settings.masteryDesc")}
          </p>
        </div>

        <div class="mt-2.5 grid gap-1">
          <label class="settings-control-row">
            <span>{$tr("settings.hideFounderItems")}</span>
            <input type="checkbox" bind:checked={$hideFounderMasteryItems} class="accent-accent" />
          </label>
        </div>
      </article>

      <article
        class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <div>
          <h3
            class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
          >
            {$tr("settings.sidebarTabsTitle")}
          </h3>
          <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">
            {$tr("settings.sidebarTabsDesc")}
          </p>
        </div>

        <div class="mt-2.5 grid gap-1">
          {#each TOGGLEABLE_TABS as tab (tab.view)}
            <label class="settings-control-row">
              <span>{$tr(tab.labelKey)}</span>
              <input
                type="checkbox"
                bind:checked={tabChecked[tab.view]}
                on:change={() => setTabVisible(tab.view)}
                class="accent-accent"
              />
            </label>
          {/each}
        </div>
      </article>

      {#if isLinux}
        <article
          class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
        >
          <ProtonLaunchOption />
        </article>

        <article
          class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
        >
          <LinuxDisplayBackend />
        </article>
      {/if}

      <article
        class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3
              class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
            >
              {$tr("settings.aboutTitle")}
            </h3>
            <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">
              {$tr("settings.aboutDesc")}
            </p>
          </div>
          <span
            class="shrink-0 rounded bg-bg-raised px-2 py-0.5 font-display text-xs font-semibold text-text-secondary"
            >v{appVersion}</span
          >
        </div>

        <div class="mt-2.5 grid gap-1">
          <div class="settings-credit-row">
            <span>{$tr("settings.creditPrices")}</span>
            <button class="settings-link" on:click={() => openLink("https://warframe.market")}
              >warframe.market</button
            >
          </div>
          <div class="settings-credit-row">
            <span>{$tr("settings.creditGameData")}</span>
            <span class="settings-credit-value">{$tr("settings.creditGameDataValue")}</span>
          </div>
          <div class="settings-credit-row">
            <span>{$tr("settings.creditItemDropData")}</span>
            <button class="settings-link" on:click={() => openLink("https://github.com/WFCD")}
              >{$tr("settings.creditWfcd")}</button
            >
          </div>
          <div class="settings-credit-row">
            <span>{$tr("settings.creditIcons")}</span>
            <button class="settings-link" on:click={() => openLink("https://browse.wf")}
              >browse.wf</button
            >
          </div>
          <div class="settings-credit-row">
            <span>{$tr("settings.creditArbiStats")}</span>
            <button class="settings-link" on:click={() => openLink("https://svesk.github.io/arbi/")}
              >{$tr("settings.creditArbiStatsValue")}</button
            >
          </div>
          <div class="settings-credit-row">
            <span>{$tr("settings.creditInventorySnapshots")}</span>
            <button
              class="settings-link"
              on:click={() => openLink("https://github.com/Sainan/warframe-api-helper")}
              >warframe-api-helper</button
            >
          </div>
          <div class="settings-credit-row">
            <span>{$tr("settings.creditSource")}</span>
            <button
              class="settings-link"
              on:click={() => openLink("https://github.com/WFHelper/WFHelper")}>GitHub</button
            >
          </div>
          <div class="settings-credit-row">
            <span>{$tr("settings.creditWebsite")}</span>
            <button class="settings-link" on:click={() => openLink("https://wfhelper.com")}
              >wfhelper.com</button
            >
          </div>
          <div class="settings-credit-row">
            <span>{$tr("settings.creditCommunity")}</span>
            <button class="settings-link" on:click={() => openLink("https://discord.gg/7Gm3UvUSww")}
              >{$tr("settings.creditCommunityValue")}</button
            >
          </div>
          <div class="settings-credit-row">
            <span>{$tr("settings.creditSupport")}</span>
            <span class="flex items-center gap-2.5">
              <button
                class="settings-link"
                on:click={() => openLink("https://github.com/sponsors/WFHelper")}
                >&hearts; {$tr("settings.creditSponsors")}</button
              >
              <button class="settings-link" on:click={() => openLink("https://ko-fi.com/WFHelper")}
                >Ko-fi</button
              >
            </span>
          </div>
        </div>

        <p class="m-0 mt-2.5 text-xs leading-snug text-text-muted">
          {$tr("settings.footerDisclaimer")}
        </p>
      </article>
    </div>

    <div class="settings-wide-actions pb-3">
      <div class="flex flex-wrap items-center gap-2.5">
        <button class="btn-secondary btn-sm" on:click={resetDefaults}
          >{$tr("settings.resetDefaults")}</button
        >
        <button class="btn-secondary btn-sm" on:click={() => startTour()}
          >{$tr("settings.showFeatureTour")}</button
        >
        <button class="btn-secondary btn-sm" on:click={openScanDebugFolder}
          >{$tr("settings.openScanDebug")}</button
        >
        <button class="btn-secondary btn-sm" on:click={openLogFolder}
          >{$tr("settings.openLogFolder")}</button
        >
        <button class="btn-secondary btn-sm" on:click={() => currentView.set("setup")}
          >{$tr("settings.redoSetup")}</button
        >
        <span class="text-xs text-text-muted">{$tr("settings.changesAutoApply")}</span>
      </div>

      {#if statusMsg}
        <p class="m-0 min-h-4 text-sm text-text-secondary" class:text-danger={statusError}>
          {statusMsg}
        </p>
      {/if}
    </div>
  {:else if settingsTab === "appearance"}
    <div class="settings-tab-grid settings-masonry py-3">
      <AppearanceCard />
    </div>
  {:else if settingsTab === "overlay"}
    <div class="settings-tab-grid settings-masonry py-3">
      <article
        class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <div>
          <h3
            class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
          >
            {$tr("settings.overlayAvailabilityTitle")}
          </h3>
          <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">
            {$tr("settings.overlayAvailabilityDesc")}
          </p>
        </div>

        <div class="mt-2.5 grid gap-1">
          <label class="settings-control-row">
            <span>{$tr("settings.relicRewardsOverlay")}</span>
            <input
              type="checkbox"
              bind:checked={form.relicRewardsOverlayEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row">
            <span>{$tr("settings.relicRecommendationOverlay")}</span>
            <input
              type="checkbox"
              bind:checked={form.relicRecommendationOverlayEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row">
            <span>{$tr("settings.tradeDetectedOverlay")}</span>
            <input
              type="checkbox"
              bind:checked={form.tradeNotificationOverlayEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row">
            <span>{$tr("settings.rivenOverlay")}</span>
            <input
              type="checkbox"
              bind:checked={form.rivenOverlayEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row">
            <span>{$tr("settings.arbiSummaryOverlay")}</span>
            <input
              type="checkbox"
              bind:checked={form.arbiSummaryOverlayEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>
        </div>
      </article>

      <article
        class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <div>
          <h3
            class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
          >
            {$tr("settings.scanDiagnosticsTitle")}
          </h3>
          <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">
            {$tr("settings.scanDiagnosticsDesc")}
          </p>
        </div>

        <div class="mt-2.5 grid gap-1">
          <label class="settings-control-row">
            <span>{$tr("settings.ocrDebugImages")}</span>
            <input
              type="checkbox"
              bind:checked={form.ocrDebugImagesEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>
        </div>
      </article>

      <article
        class="w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
      >
        <div>
          <h3
            class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
          >
            {$tr("settings.overlayTitle")}
          </h3>
          <p class="mt-1 text-xs leading-tight text-text-muted">
            {$tr("settings.overlayRequirements")}
          </p>
        </div>

        <div class="mt-2.5 grid gap-1">
          <label class="settings-control-row">
            <span>{$tr("settings.autoTrigger")}</span>
            <input
              type="checkbox"
              bind:checked={form.autoTriggerEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          {#each OVERLAY_SCALE_ROWS as row (row.key)}
            <label class="settings-control-row settings-control-row-input">
              <span>{$tr(row.labelKey)}</span>
              <div class="settings-range-control">
                <input
                  type="range"
                  min="0.75"
                  max="1.5"
                  step="0.05"
                  value={windowScales[row.key] ?? overlayScale}
                  on:change={(e) => saveWindowScale(row.key, Number(e.currentTarget.value))}
                  class="settings-range"
                />
                <span class="settings-range-value"
                  >{Math.round((windowScales[row.key] ?? overlayScale) * 100)}%</span
                >
              </div>
            </label>
          {/each}

          <label class="settings-control-row">
            <span>{$tr("settings.hotkeyFallback")}</span>
            <input
              type="checkbox"
              bind:checked={form.hotkeyEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row settings-control-row-input">
            <span>{$tr("settings.hotkey")}</span>
            <input
              type="text"
              bind:value={form.hotkey}
              disabled={!form.hotkeyEnabled}
              placeholder={$tr("settings.hotkeyPlaceholder")}
              on:keydown={recordTriggerHotkey}
              on:change={autoSave}
              class="settings-input"
            />
          </label>

          <label class="settings-control-row">
            <span>{$tr("settings.interactionHotkeyEnabled")}</span>
            <input
              type="checkbox"
              bind:checked={form.interactionHotkeyEnabled}
              on:change={autoSave}
              class="accent-accent"
            />
          </label>

          <label class="settings-control-row settings-control-row-input">
            <span>{$tr("settings.interactionHotkey")}</span>
            <input
              type="text"
              bind:value={form.interactionHotkey}
              disabled={!form.interactionHotkeyEnabled}
              placeholder={$tr("settings.interactionHotkeyPlaceholder")}
              on:keydown={recordInteractionHotkey}
              on:change={autoSave}
              class="settings-input"
            />
          </label>
        </div>
      </article>
    </div>

    <div class="settings-wide-actions pb-3">
      <div class="flex flex-wrap items-center gap-2.5">
        <button class="btn-secondary btn-sm" on:click={resetDefaults}
          >{$tr("settings.resetDefaults")}</button
        >
        <button class="btn-secondary btn-sm" on:click={testTrigger}
          >{$tr("settings.testTrigger")}</button
        >
        <span class="text-xs text-text-muted">{$tr("settings.changesAutoApply")}</span>
      </div>

      {#if statusMsg}
        <p class="m-0 min-h-4 text-sm text-text-secondary" class:text-danger={statusError}>
          {statusMsg}
        </p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .settings-tab-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 0.85rem;
    align-items: start;
  }

  .settings-control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    border-radius: var(--radius-md);
    padding: 0.34rem 0.45rem;
    margin: 0 -0.45rem;
    cursor: pointer;
  }

  .settings-control-row:hover {
    background: var(--bg-hover);
  }

  .settings-control-row span {
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .settings-control-row-input {
    cursor: default;
  }

  .settings-input {
    min-width: 9rem;
    max-width: 12rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-base);
    color: var(--text-primary);
    padding: 0.38rem 0.6rem;
    font-size: 0.875rem;
    outline: none;
  }

  .settings-input:focus {
    border-color: var(--accent-dim);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .settings-input:disabled {
    opacity: 0.55;
  }

  .settings-range-control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.6rem;
    min-width: 12rem;
  }

  .settings-range {
    width: 8rem;
    accent-color: var(--accent);
  }

  .settings-range-control .settings-range-value {
    min-width: 3.7rem;
    text-align: right;
    color: var(--text-primary);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
  }

  /* Multicol packs cards tight; grid rows would leave dead space under short cards. */
  .settings-masonry {
    display: block;
    columns: 3 320px;
    column-gap: 0.85rem;
  }

  .settings-masonry > :global(article) {
    break-inside: avoid;
    margin-bottom: 0.85rem;
  }

  .settings-link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.875rem;
    font-family: inherit;
  }

  .settings-link:hover {
    text-decoration: underline;
  }

  .settings-credit-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    border-radius: var(--radius-md);
    padding: 0.34rem 0.45rem;
    margin: 0 -0.45rem;
  }

  .settings-credit-row:hover {
    background: var(--bg-hover);
  }

  .settings-credit-row > span:first-child {
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .settings-credit-value {
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .settings-wide-actions {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
</style>
