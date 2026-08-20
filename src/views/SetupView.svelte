<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import { onInventoryLoaded } from "../lib/actions.js";
  import { tr } from "../lib/i18n.js";
  import type { MessageKey } from "../lib/i18n.js";
  import { PRESET_KEYS, THEME_PRESETS } from "../config/themePresets.js";
  import { currentView, SETUP_COMPLETED_KEY, statusText } from "../stores/app.js";
  import { themeSettings } from "../stores/theme.js";
  import { invoke, on, getPlatform } from "../lib/ipc.js";
  import { loadUiScale, saveUiScale } from "../lib/uiScaleSetting.js";
  import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from "../../config/runtime/uiScale.js";
  import { APP_LOGO_URL, SETUP_OVERLAY_BG_URLS } from "../lib/assetUrls.js";
  import { writeStorage } from "../lib/persistence.js";
  import { shouldAutoStartTour, startTour } from "../stores/tour.js";
  import {
    hasInventoryShape,
    unwrapInventoryPayload as unwrapSharedInventoryPayload,
  } from "../../config/shared/inventoryPayload.js";
  import type { ThemeCornerStyle, ThemeSurfaceStyle } from "../types/theme.js";
  import type { RawInventoryData } from "../types/inventory.js";
  import type { HelperDownloadProgress, HelperStatus } from "../types/ipc.js";
  import SegmentedControl from "../components/SegmentedControl.svelte";
  import GlassBlurControl from "../components/settings/GlassBlurControl.svelte";
  import ProtonLaunchOption from "../components/ProtonLaunchOption.svelte";

  type Step = "configure" | "inventory" | "downloading" | "done" | "overlays" | "error";
  type InventorySource = "helper" | "json" | "aleca";
  type HelperInventoryStatus = "checking" | "found" | "not_found" | "error";

  const isLinux = getPlatform() === "linux";

  let step: Step = "configure";
  let inventorySource: InventorySource = "helper";
  let progress: HelperDownloadProgress | null = null;
  let errorMessage = "";
  let helperStatus: HelperInventoryStatus = "checking";
  let helperPath: string | null = null;
  let loadingApi = false;
  let runnerStatus: HelperStatus | null = null;
  let destroyed = false;
  let statusPollTimer: ReturnType<typeof setInterval> | null = null;
  const STATUS_POLL_MS = 5_000;
  let removeProgressListener: (() => void) | null = null;
  let removeInventoryListener: (() => void) | null = null;
  let pendingInventoryData: unknown = null;
  let uiScale = 1;

  const surfaceOptions: Array<{ value: ThemeSurfaceStyle; labelKey: MessageKey }> = [
    { value: "full", labelKey: "appearance.surfaceFull" },
    { value: "border", labelKey: "common.border" },
    { value: "minimal", labelKey: "appearance.surfaceMinimal" },
  ];
  const cornerOptions: Array<{ value: ThemeCornerStyle; labelKey: MessageKey }> = [
    { value: "sharp", labelKey: "appearance.cornerSharp" },
    { value: "soft", labelKey: "appearance.cornerSoft" },
    { value: "round", labelKey: "appearance.cornerRound" },
  ];
  // balanced starter picks (2 neutral, 1 light, 1 showpiece); full list in Settings > Appearance
  const SETUP_THEME_KEYS = [
    "default",
    "midnight",
    "graphite",
    "tennoMinimal",
    "light",
    "corpusGlass",
  ];

  onMount(async () => {
    // Not awaited - the inventory checks below shouldn't wait on a slider.
    loadUiScale()
      .then((value) => (uiScale = value))
      .catch(() => {});

    removeProgressListener = on("helper-download-progress", (p) => {
      progress = p;
      if (p.stage === "done") {
        step = "done";
      } else if (p.stage === "error") {
        step = "error";
        errorMessage = p.error || $tr("setup.downloadFailedGeneric");
      }
    });

    removeInventoryListener = on("inventory-updated", async (data) => {
      if (destroyed || loadingApi) return;
      if (step === "configure") {
        // App.svelte already ingested it; don't yank the user off the theme step
        pendingInventoryData = data;
        return;
      }
      try {
        await acceptInventoryData(data, $tr("setup.liveInventoryUpdateFailed"));
      } catch {
        // The user can still choose a file import source on this screen.
      }
    });

    await refreshRunnerStatus();
    if (destroyed) return;

    if (runnerStatus?.installerAutoInstallHelper === false) {
      inventorySource = "json";
    }

    await refreshHelperStatus();
    if (destroyed) return;

    // Keep the waiting-for-data banner's failure reason live: the helper now
    // retries about every 90s on its own, so the hint changes without clicks.
    statusPollTimer = setInterval(() => {
      void refreshRunnerStatus();
    }, STATUS_POLL_MS);
  });

  onDestroy(() => {
    destroyed = true;
    if (statusPollTimer) clearInterval(statusPollTimer);
    removeInventoryListener?.();
    removeProgressListener?.();
  });

  async function refreshRunnerStatus(): Promise<void> {
    try {
      runnerStatus = await invoke("getHelperStatus");
    } catch {
      runnerStatus = null;
    }
  }

  async function refreshHelperStatus(): Promise<void> {
    try {
      const status = await invoke("getInventoryStatus");
      if (status?.found) {
        helperStatus = "found";
        helperPath = status.path || null;
      } else {
        helperStatus = "not_found";
        helperPath = null;
      }
    } catch (error) {
      if (helperStatus === "checking") {
        helperStatus = "error";
      }
      helperPath = null;
      console.error("[Setup] getInventoryStatus failed:", error);
    }
  }

  function getLoadErrorMessage(data: unknown): string | null {
    if (!data || typeof data !== "object" || !("error" in data)) return null;
    const error = (data as { error?: unknown }).error;
    return typeof error === "string" ? error : null;
  }

  async function acceptInventoryData(data: unknown, failureMessage: string): Promise<void> {
    const loadError = getLoadErrorMessage(data);
    if (!data || loadError) {
      throw new Error(loadError || failureMessage);
    }

    const unwrapped = unwrapSharedInventoryPayload(data, { returnInputOnFailure: false });
    if (!hasInventoryShape(unwrapped)) {
      throw new Error(failureMessage);
    }

    await onInventoryLoaded(unwrapped as RawInventoryData);
    if (!destroyed && step !== "overlays") {
      finish();
    }
  }

  async function startDownload(): Promise<void> {
    step = "downloading";
    progress = null;
    const result = await invoke("downloadHelper");
    if (destroyed) return;
    if (result.ok) {
      step = "done";
      await refreshRunnerStatus();
      return;
    }
    if (step === "downloading") {
      step = "error";
      errorMessage = result.error || $tr("setup.downloadFailedConnection");
    }
  }

  // Remember the pick so a restart does not silently switch back to something
  // else. Only the helper needs this - the file pickers record their own source.
  async function persistHelperInventorySource(): Promise<void> {
    try {
      await invoke("setInventorySource", "helper");
    } catch {
      // non-fatal: the chosen data still loads for this session
    }
  }

  async function importInventory(): Promise<void> {
    loadingApi = true;
    try {
      const data = await invoke("openInventoryFile", "manual");
      await acceptInventoryData(data, $tr("setup.importJsonFailedMsg"));
    } catch (error) {
      errorMessage = $tr("setup.importJsonFailedPrefix", { message: (error as Error).message });
      step = "error";
    } finally {
      loadingApi = false;
    }
  }

  async function importAlecaFrameInventory(): Promise<void> {
    loadingApi = true;
    try {
      const data = await invoke("openAlecaFrameInventoryFile");
      await acceptInventoryData(data, $tr("setup.importAlecaHint"));
    } catch (error) {
      errorMessage = $tr("setup.importAlecaFailedPrefix", { message: (error as Error).message });
      step = "error";
    } finally {
      loadingApi = false;
    }
  }

  async function loadApiHelper(preferPicker = false): Promise<void> {
    loadingApi = true;
    statusText.set({ key: "setup.status.loadingInventory" });
    try {
      let data: unknown = null;
      let loadError: string | null = null;

      if (!preferPicker) {
        data = await invoke("getInventory");
        loadError = getLoadErrorMessage(data);
      }

      // "Browse for JSON" replaces the helper; the silent fallback only seeds it.
      if (!data || loadError) {
        data = await invoke("openInventoryFile", preferPicker ? "manual" : "helper");
        loadError = getLoadErrorMessage(data);
      }

      await acceptInventoryData(data, loadError || $tr("setup.loadInventoryJsonFailed"));
      await refreshHelperStatus();
    } catch (error) {
      if (!destroyed) {
        statusText.set({
          key: "setup.status.loadError",
          params: { message: (error as Error).message },
        });
        errorMessage = (error as Error).message;
      }
    } finally {
      loadingApi = false;
    }
  }

  async function triggerHelperRun(): Promise<void> {
    try {
      statusText.set({ key: "setup.status.runningHelper" });
      await invoke("runHelperNow");
      await refreshRunnerStatus();
      statusText.set({ key: "setup.status.helperFinished" });
    } catch {
      statusText.set({ key: "setup.status.helperRunFailed" });
    }
  }

  async function useSelectedInventorySource(): Promise<void> {
    if (inventorySource === "helper") {
      await persistHelperInventorySource();
      if (runnerStatus?.exeFound) {
        await loadApiHelper(false);
        return;
      }
      await startDownload();
      return;
    }

    if (inventorySource === "json") {
      await importInventory();
      return;
    }

    if (inventorySource === "aleca") {
      await importAlecaFrameInventory();
      return;
    }
  }

  function completeSetup(nextView: "inventory" = "inventory"): void {
    writeStorage(SETUP_COMPLETED_KEY, "1");
    // legacy key: a downgrade to a pre-v2 build must not re-run setup either
    writeStorage("setup-completed", "1");
    currentView.set(nextView);
    if (shouldAutoStartTour()) startTour();
  }

  async function continueFromConfigure(): Promise<void> {
    step = "inventory";
    if (pendingInventoryData === null) return;
    const data = pendingInventoryData;
    pendingInventoryData = null;
    try {
      await acceptInventoryData(data, $tr("setup.liveInventoryUpdateFailed"));
    } catch {
      // bad payload - stay on the source step and let the user pick manually
    }
  }

  // The preview maps directly to the primary display work area, so dummy panel
  // positions can be saved for the real overlays.
  type PlacementKey = "reward" | "planner" | "rivenLeft" | "rivenRight" | "arbiSummary";
  type PlacementRect = { x: number; y: number; width: number; height: number };

  const overlayPlacementSteps: Array<{
    key: "reward" | "planner" | "riven" | "arbiSummary";
    dummies: PlacementKey[];
    titleKey: MessageKey;
    textKey: MessageKey;
  }> = [
    {
      key: "reward",
      dummies: ["reward"],
      titleKey: "setup.overlay.reward.title",
      textKey: "setup.overlay.reward.text",
    },
    {
      key: "planner",
      dummies: ["planner"],
      titleKey: "setup.overlay.planner.title",
      textKey: "setup.overlay.planner.text",
    },
    {
      key: "riven",
      dummies: ["rivenLeft", "rivenRight"],
      titleKey: "setup.overlay.riven.title",
      textKey: "setup.overlay.riven.text",
    },
    {
      key: "arbiSummary",
      dummies: ["arbiSummary"],
      titleKey: "common.arbitrationSummary",
      textKey: "setup.overlay.arbiSummary.text",
    },
  ];

  const dummyLabelKeys: Record<PlacementKey, MessageKey> = {
    reward: "setup.dummy.rewardLabel",
    planner: "setup.dummy.plannerLabel",
    rivenLeft: "setup.dummy.rivenLeftLabel",
    rivenRight: "setup.dummy.rivenRightLabel",
    arbiSummary: "common.arbitrationSummary",
  };

  let overlayStepIndex = 0;
  let placementArea = { width: 1920, height: 1080 };
  let placementPos: Record<PlacementKey, PlacementRect> | null = null;
  let placementScales: Record<PlacementKey, number> = {
    reward: 1,
    planner: 1,
    rivenLeft: 1,
    rivenRight: 1,
    arbiSummary: 1,
  };
  let previewW = 0;
  let dragging: {
    key: PlacementKey;
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null = null;

  function clampToArea(rect: PlacementRect): PlacementRect {
    return {
      ...rect,
      x: Math.min(Math.max(0, rect.x), Math.max(0, placementArea.width - rect.width)),
      y: Math.min(Math.max(0, rect.y), Math.max(0, placementArea.height - rect.height)),
    };
  }

  async function enterOverlaysStep(): Promise<void> {
    step = "overlays";
    overlayStepIndex = 0;
    try {
      const layout = await invoke("getOverlayPlacementLayout");
      placementArea = layout.area;
      placementPos = {
        reward: clampToArea(layout.overlays.reward),
        planner: clampToArea(layout.overlays.planner),
        rivenLeft: clampToArea(layout.overlays.rivenLeft),
        rivenRight: clampToArea(layout.overlays.rivenRight),
        arbiSummary: clampToArea(layout.overlays.arbiSummary),
      };
      placementScales = {
        reward: layout.overlays.reward.scale,
        planner: layout.overlays.planner.scale,
        rivenLeft: layout.overlays.rivenLeft.scale,
        rivenRight: layout.overlays.rivenRight.scale,
        arbiSummary: layout.overlays.arbiSummary.scale,
      };
    } catch {
      // No dummies then - the wizard must never get stuck on this step.
      placementPos = null;
    }
  }

  function overlayNext(): void {
    if (overlayStepIndex < overlayPlacementSteps.length - 1) {
      overlayStepIndex += 1;
    } else {
      finishOverlaysStep();
    }
  }

  function overlayBack(): void {
    if (overlayStepIndex > 0) overlayStepIndex -= 1;
  }

  function finishOverlaysStep(): void {
    completeSetup("inventory");
  }

  function onDummyPointerDown(key: PlacementKey, event: PointerEvent): void {
    if (event.button !== 0 || !placementPos || previewScale <= 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const p = placementPos[key];
    dragging = {
      key,
      pointerId: event.pointerId,
      offsetX: event.clientX - p.x * previewScale,
      offsetY: event.clientY - p.y * previewScale,
    };
  }

  function onDummyPointerMove(event: PointerEvent): void {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    if (!placementPos || previewScale <= 0) return;
    const p = placementPos[dragging.key];
    placementPos = {
      ...placementPos,
      [dragging.key]: clampToArea({
        ...p,
        x: (event.clientX - dragging.offsetX) / previewScale,
        y: (event.clientY - dragging.offsetY) / previewScale,
      }),
    };
  }

  function onDummyPointerUp(event: PointerEvent): void {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const key = dragging.key;
    dragging = null;
    if (!placementPos) return;
    const p = placementPos[key];
    invoke("saveOverlayPlacement", key, {
      xFrac: p.x / placementArea.width,
      yFrac: p.y / placementArea.height,
    }).catch(() => {});
  }

  // slider preview scales the dummy like the real window zoom; persisted on release
  function applyScalePreview(value: number): void {
    if (!placementPos) return;
    const next = { ...placementPos };
    for (const key of placementStep.dummies) {
      const prev = placementScales[key] || 1;
      const rect = next[key];
      next[key] = clampToArea({
        ...rect,
        width: (rect.width / prev) * value,
        height: (rect.height / prev) * value,
      });
      placementScales = { ...placementScales, [key]: value };
    }
    placementPos = next;
  }

  function commitScale(): void {
    for (const key of placementStep.dummies) {
      invoke("saveOverlayScale", key, placementScales[key]).catch(() => {});
    }
  }

  // On release, not on input: each save re-zooms the window under the cursor.
  function commitUiScale(): void {
    void saveUiScale(uiScale).catch(() => {});
  }

  const finish = (): void => void enterOverlaysStep();
  const skip = (): void => completeSetup("inventory");

  function retry(): void {
    step = "configure";
    errorMessage = "";
    progress = null;
  }

  // reactive state comes in as parameters so the template re-evaluates these
  function sourceButtonClass(source: InventorySource, current: InventorySource): string {
    const selected = current === source;
    return [
      "w-full cursor-pointer rounded-lg border px-3 py-3 text-left transition-colors duration-150",
      selected
        ? "border-accent bg-accent/10 text-text-primary"
        : "border-border bg-bg-raised text-text-secondary hover:border-border-strong hover:text-text-primary",
    ].join(" ");
  }

  type StepTarget = "configure" | "inventory" | "overlays" | "done";

  function stepFlags(target: StepTarget, current: Step): { active: boolean; complete: boolean } {
    const active =
      current === target ||
      (target === "inventory" && (current === "downloading" || current === "error")) ||
      (target === "done" && current === "overlays");
    const complete =
      (target === "configure" && current !== "configure") ||
      (target === "inventory" && (current === "done" || current === "overlays"));
    return { active, complete };
  }

  function stepTextClass(target: StepTarget, current: Step): string {
    const { active, complete } = stepFlags(target, current);
    if (current === "error" && target === "inventory") return "text-danger";
    if (active) return "text-accent font-semibold";
    if (complete) return "text-success";
    return "text-text-muted";
  }

  function stepDotClass(target: StepTarget, current: Step): string {
    const { active, complete } = stepFlags(target, current);
    if (current === "error" && target === "inventory") return "bg-danger";
    if (active) return "bg-accent shadow-[0_0_6px_var(--accent)]";
    if (complete) return "bg-success";
    return "bg-text-muted";
  }

  $: placementStep = overlayPlacementSteps[overlayStepIndex];
  $: placementTitle = $tr(placementStep.titleKey);
  $: placementText = $tr(placementStep.textKey);
  $: previewScale = previewW > 0 && placementArea.width > 0 ? previewW / placementArea.width : 0;
  $: stepScale = placementScales[placementStep.dummies[0]] ?? 1;
  $: surfaceSegOptions = surfaceOptions.map((o) => ({ value: o.value, label: $tr(o.labelKey) }));
  $: cornerSegOptions = cornerOptions.map((o) => ({ value: o.value, label: $tr(o.labelKey) }));
  $: effects = $themeSettings.effects;
  $: activePresetKey = PRESET_KEYS.includes($themeSettings.activePreset)
    ? $themeSettings.activePreset
    : "default";
  $: progressPercent = progress?.percent ?? 0;
  $: bytesLabel = progress?.bytesTotal
    ? `${(progress.bytesReceived / 1024 / 1024).toFixed(1)} / ${(progress.bytesTotal / 1024 / 1024).toFixed(1)} MB`
    : "";
</script>

<section class="view active">
  {#if step === "overlays"}
    <!-- mt/mb-auto centre the pair when it fits and keep it scrollable when not. -->
    <div
      class="fixed inset-0 z-40 flex flex-col items-center gap-4 overflow-y-auto bg-bg-deep px-6 py-5"
    >
      <div
        class="relative mt-auto min-h-0 overflow-hidden rounded-xl border border-border-strong bg-black"
        style="aspect-ratio: {placementArea.width} / {placementArea.height}; width: min(100%, calc((100vh - 230px) * {(
          placementArea.width / Math.max(1, placementArea.height)
        ).toFixed(4)}));"
        bind:clientWidth={previewW}
      >
        <img
          src={SETUP_OVERLAY_BG_URLS[placementStep.key] || SETUP_OVERLAY_BG_URLS.reward}
          alt=""
          draggable="false"
          class="absolute inset-0 h-full w-full select-none object-cover opacity-80"
        />
        <div class="absolute inset-0 bg-black/20"></div>
        {#if placementPos && previewScale > 0}
          {#each placementStep.dummies as key (placementStep.key + "-" + key)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              data-placement-dummy={key}
              class="absolute flex cursor-move touch-none select-none flex-col overflow-hidden rounded border bg-bg-deep/85 {dragging?.key ===
              key
                ? 'border-accent ring-1 ring-accent'
                : 'border-border-strong hover:border-accent'}"
              style="left: {placementPos[key].x * previewScale}px; top: {placementPos[key].y *
                previewScale}px; width: {placementPos[key].width *
                previewScale}px; height: {placementPos[key].height * previewScale}px;"
              on:pointerdown={(e) => onDummyPointerDown(key, e)}
              on:pointermove={onDummyPointerMove}
              on:pointerup={onDummyPointerUp}
              on:pointercancel={() => (dragging = null)}
            >
              <div
                class="flex items-center justify-between gap-2 border-b border-border bg-bg-surface/90 px-2 py-1"
              >
                <span
                  class="truncate font-display text-[10px] font-bold tracking-widest text-accent"
                  >{$tr(dummyLabelKeys[key])}</span
                >
                <span class="shrink-0 text-[9px] uppercase tracking-wider text-text-muted"
                  >{$tr("setup.overlay.dragMe")}</span
                >
              </div>
              <div class="min-h-0 flex-1 p-1.5 opacity-80">
                {#if key === "reward"}
                  <div class="flex h-full gap-1.5">
                    {#each Array(4) as _}
                      <div
                        class="flex flex-1 flex-col gap-1 rounded-sm border border-border/60 bg-bg-raised/70 p-1"
                      >
                        <div class="mx-auto h-2/5 w-3/5 rounded-sm bg-bg-hover"></div>
                        <div class="h-1.5 w-full rounded-sm bg-bg-hover"></div>
                        <div class="h-1.5 w-2/3 rounded-sm bg-bg-hover"></div>
                      </div>
                    {/each}
                  </div>
                {:else if key === "planner"}
                  <div class="flex h-full flex-col gap-1.5">
                    {#each Array(3) as _}
                      <div
                        class="flex items-center gap-1.5 rounded-sm border border-border/60 bg-bg-raised/70 px-1.5 py-2"
                      >
                        <div class="h-1.5 flex-1 rounded-sm bg-bg-hover"></div>
                        <div class="h-1.5 w-8 shrink-0 rounded-sm bg-bg-hover"></div>
                      </div>
                    {/each}
                  </div>
                {:else if key === "arbiSummary"}
                  <div class="grid h-full grid-cols-2 gap-1.5">
                    {#each Array(4) as _}
                      <div
                        class="flex flex-col justify-center gap-1 rounded-sm border border-border/60 bg-bg-raised/70 px-1.5"
                      >
                        <div class="h-1.5 w-1/2 rounded-sm bg-bg-hover"></div>
                        <div class="h-2 w-2/3 rounded-sm bg-bg-hover"></div>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="flex h-full flex-col gap-1.5">
                    <div
                      class="h-1/4 shrink-0 rounded-sm border border-border/60 bg-bg-raised/70"
                    ></div>
                    {#each Array(5) as _}
                      <div class="flex items-center gap-1.5 px-0.5">
                        <div class="h-1.5 flex-1 rounded-sm bg-bg-hover"></div>
                        <div class="h-1.5 w-6 shrink-0 rounded-sm bg-bg-hover"></div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <div
        class="mb-auto w-[560px] max-w-full shrink-0 rounded-xl border border-border bg-bg-surface p-4"
      >
        <div class="mb-1 flex items-center justify-between gap-3">
          <h2 class="m-0 font-display text-base font-bold tracking-[0.02em]">
            {placementTitle}
          </h2>
          <span class="shrink-0 text-xs text-text-muted"
            >{overlayStepIndex + 1} / {overlayPlacementSteps.length}</span
          >
        </div>
        <p class="m-0 text-sm leading-snug text-text-secondary">{placementText}</p>
        <p class="m-0 mt-1.5 text-xs leading-snug text-text-muted">
          {$tr("setup.overlay.hint")}
        </p>
        <div class="mt-2.5 flex items-center gap-3">
          <span class="shrink-0 text-xs text-text-muted">{$tr("setup.overlay.sizeLabel")}</span>
          <input
            type="range"
            min="0.75"
            max="1.5"
            step="0.05"
            value={stepScale}
            disabled={!placementPos}
            on:input={(e) => applyScalePreview(Number(e.currentTarget.value))}
            on:change={commitScale}
            class="h-1.5 flex-1 cursor-pointer"
            style="accent-color: var(--accent);"
          />
          <span class="w-10 shrink-0 text-right text-xs text-text-muted"
            >{Math.round(stepScale * 100)}%</span
          >
        </div>
        <div class="mt-3 flex items-center justify-between">
          <button class="btn-secondary btn-sm" on:click={finishOverlaysStep}
            >{$tr("setup.skip")}</button
          >
          <div class="flex gap-2">
            {#if overlayStepIndex > 0}
              <button class="btn-secondary btn-sm" on:click={overlayBack}
                >{$tr("common.back")}</button
              >
            {/if}
            <button class="btn-primary btn-sm" on:click={overlayNext}>
              {overlayStepIndex === overlayPlacementSteps.length - 1
                ? $tr("setup.finish")
                : $tr("common.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div
      class="mx-auto my-8 flex min-h-[620px] w-full max-w-[1080px] overflow-hidden rounded-xl border border-border bg-bg-surface"
    >
      <div
        class="setup-left flex w-[190px] shrink-0 flex-col items-center border-r border-border bg-gradient-to-b from-bg-deep to-bg-raised px-4 pb-6 pt-7"
      >
        <div class="setup-logo">
          <img src={APP_LOGO_URL} alt={$tr("setup.appLogoAlt")} class="h-14 w-14 object-contain" />
        </div>
        <div class="mt-8 flex w-full flex-col gap-4">
          <div
            class="flex items-center gap-2 text-xs transition-colors duration-200 {stepTextClass(
              'configure',
              step,
            )}"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full transition-[background] duration-200 {stepDotClass(
                'configure',
                step,
              )}"
            ></span>
            {$tr("setup.step.configure")}
          </div>
          <div
            class="flex items-center gap-2 text-xs transition-colors duration-200 {stepTextClass(
              'inventory',
              step,
            )}"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full transition-[background] duration-200 {stepDotClass(
                'inventory',
                step,
              )}"
            ></span>
            {$tr("setup.step.inventorySource")}
          </div>
          <div
            class="flex items-center gap-2 text-xs transition-colors duration-200 {stepTextClass(
              'overlays',
              step,
            )}"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full transition-[background] duration-200 {stepDotClass(
                'overlays',
                step,
              )}"
            ></span>
            {$tr("common.overlays")}
          </div>
          <div
            class="flex items-center gap-2 text-xs transition-colors duration-200 {stepTextClass(
              'done',
              step,
            )}"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full transition-[background] duration-200 {stepDotClass(
                'done',
                step,
              )}"
            ></span>
            {$tr("setup.step.finish")}
          </div>
        </div>
      </div>

      <div class="flex flex-1 flex-col px-6 pb-5 pt-7">
        <div class="setup-content flex-1">
          {#if step === "configure"}
            <h2 class="mb-3 font-display text-lg font-bold tracking-[0.02em]">
              {$tr("setup.welcomeTitle")}
            </h2>

            <div class="grid gap-3">
              <div
                class="rounded-lg border border-[var(--ui-panel-border)] bg-[var(--ui-control-bg)] px-3 py-3 [backdrop-filter:var(--ui-backdrop-blur)]"
              >
                <div class="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <h3 class="m-0 font-display text-sm font-semibold text-text-primary">
                      {$tr("common.appSize")}
                    </h3>
                    <p class="mt-0.5 text-xs leading-snug text-text-muted">
                      {$tr("setup.appSize.hint")}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <input
                    type="range"
                    min={UI_SCALE_MIN}
                    max={UI_SCALE_MAX}
                    step={UI_SCALE_STEP}
                    bind:value={uiScale}
                    on:change={commitUiScale}
                    class="h-1.5 flex-1 cursor-pointer"
                    style="accent-color: var(--accent);"
                    aria-label={$tr("common.appSize")}
                  />
                  <span class="w-10 shrink-0 text-right text-xs text-text-muted"
                    >{Math.round(uiScale * 100)}%</span
                  >
                </div>
              </div>

              <div
                class="rounded-lg border border-[var(--ui-panel-border)] bg-[var(--ui-control-bg)] px-3 py-3 [backdrop-filter:var(--ui-backdrop-blur)]"
              >
                <div class="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <h3 class="m-0 font-display text-sm font-semibold text-text-primary">
                      {$tr("setup.theme.title")}
                    </h3>
                    <p class="mt-0.5 text-xs leading-snug text-text-muted">
                      {$tr("setup.theme.hint")}
                    </p>
                  </div>
                </div>
                <div class="grid grid-cols-3 gap-2">
                  {#each SETUP_THEME_KEYS as key (key)}
                    {@const preset = THEME_PRESETS[key]}
                    <button
                      type="button"
                      class="rounded-lg border p-2.5 text-left transition-colors duration-150 {activePresetKey ===
                      key
                        ? 'border-accent ring-1 ring-accent'
                        : 'border-border hover:border-border-strong'}"
                      style="background: {preset.colors.bgSurface};"
                      aria-pressed={activePresetKey === key}
                      on:click={() => themeSettings.applyPreset(key)}
                    >
                      <span class="flex gap-1">
                        <span
                          class="h-3 w-3 rounded-[3px] border border-white/10"
                          style="background: {preset.colors.bgBase};"
                        ></span>
                        <span
                          class="h-3 w-3 rounded-[3px] border border-white/10"
                          style="background: {preset.colors.bgRaised};"
                        ></span>
                        <span
                          class="h-3 w-3 rounded-[3px] border border-white/10"
                          style="background: {preset.colors.textPrimary};"
                        ></span>
                        <span
                          class="h-3 w-3 rounded-[3px] border border-white/10"
                          style="background: {preset.colors.accent};"
                        ></span>
                      </span>
                      <span
                        class="mt-1.5 block truncate text-xs font-semibold"
                        style="color: {preset.colors.textPrimary};">{preset.label}</span
                      >
                    </button>
                  {/each}
                </div>
                <p class="m-0 mt-2 text-xs text-text-muted">
                  {$tr("setup.theme.footer")}
                </p>
              </div>

              {#if isLinux}
                <div
                  class="rounded-lg border border-[var(--ui-panel-border)] bg-[var(--ui-control-bg)] px-3 py-3 [backdrop-filter:var(--ui-backdrop-blur)]"
                >
                  <ProtonLaunchOption compact />
                </div>
              {/if}

              <div
                class="rounded-lg border border-[var(--ui-panel-border)] bg-[var(--ui-control-bg)] px-3 py-3 [backdrop-filter:var(--ui-backdrop-blur)]"
              >
                <div class="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <h3 class="m-0 font-display text-sm font-semibold text-text-primary">
                      {$tr("setup.uiStyle.title")}
                    </h3>
                    <p class="mt-0.5 text-xs leading-snug text-text-muted">
                      {$tr("setup.uiStyle.hint")}
                    </p>
                  </div>
                </div>
                <SegmentedControl
                  value={effects.surfaceStyle}
                  options={surfaceSegOptions}
                  onChange={(surfaceStyle) => themeSettings.setEffects({ surfaceStyle })}
                />
              </div>

              <div
                class="rounded-lg border border-[var(--ui-panel-border)] bg-[var(--ui-control-bg)] px-3 py-3 [backdrop-filter:var(--ui-backdrop-blur)]"
              >
                <div class="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <h3 class="m-0 font-display text-sm font-semibold text-text-primary">
                      {$tr("setup.borderStyle.title")}
                    </h3>
                    <p class="mt-0.5 text-xs leading-snug text-text-muted">
                      {$tr("setup.borderStyle.hint")}
                    </p>
                  </div>
                </div>
                <SegmentedControl
                  value={effects.cornerStyle}
                  options={cornerSegOptions}
                  onChange={(cornerStyle) => themeSettings.setEffects({ cornerStyle })}
                />
              </div>

              <div
                class="rounded-lg border border-[var(--ui-panel-border)] bg-[var(--ui-control-bg)] px-3 py-3 [backdrop-filter:var(--ui-backdrop-blur)]"
              >
                <GlassBlurControl
                  labelClass="flex cursor-pointer items-start justify-between gap-3"
                >
                  <div>
                    <h3 class="m-0 font-display text-sm font-semibold text-text-primary">
                      {$tr("common.glassBlur")}
                    </h3>
                    <p class="mt-0.5 text-xs leading-snug text-text-muted">
                      {$tr("setup.glassBlur.hint")}
                    </p>
                  </div>
                </GlassBlurControl>
              </div>
            </div>
          {:else if step === "inventory"}
            <h2 class="mb-3 font-display text-lg font-bold tracking-[0.02em]">
              {$tr("setup.inventory.title")}
            </h2>
            <p class="mb-2.5 text-sm leading-[1.55] text-text-secondary">
              {$tr("setup.inventory.desc")}
            </p>

            {#if helperStatus === "not_found" && runnerStatus?.exeFound}
              <div class="mb-3 rounded-lg border border-warning bg-warning/10 px-3 py-3">
                <span
                  class="mb-1 inline-block rounded bg-warning px-2 py-0.5 font-display text-xs font-bold tracking-widest text-black"
                  >{$tr("setup.waiting.badge")}</span
                >
                <h3 class="font-display text-sm font-semibold text-text-primary">
                  {$tr("setup.waiting.title")}
                </h3>
                <p class="mt-0.5 text-xs leading-snug text-text-secondary">
                  {$tr("setup.waiting.desc")}
                </p>
                {#if runnerStatus?.lastRunReason === "access-denied"}
                  <p class="mt-1 text-xs font-semibold leading-snug text-warning">
                    {$tr("setup.waiting.accessDenied")}
                  </p>
                {:else if runnerStatus?.lastRunReason === "not-logged-in"}
                  <p class="mt-1 text-xs leading-snug text-text-secondary">
                    {$tr("setup.waiting.notLoggedIn")}
                  </p>
                {:else if runnerStatus?.lastRunReason === "token-not-found"}
                  <p class="mt-1 text-xs font-semibold leading-snug text-warning">
                    {$tr("setup.waiting.tokenNotFound")}
                  </p>
                {:else if runnerStatus?.lastRunReason === "game-not-running"}
                  <p class="mt-1 text-xs leading-snug text-text-secondary">
                    {$tr("setup.waiting.gameNotRunning")}
                  </p>
                {/if}
                <div class="mt-2 flex gap-2">
                  <button
                    class="btn-primary btn-sm"
                    disabled={loadingApi}
                    on:click={triggerHelperRun}>{$tr("setup.runHelperNow")}</button
                  >
                  <button
                    class="btn-secondary btn-sm"
                    disabled={loadingApi}
                    on:click={() => loadApiHelper(true)}>{$tr("setup.browseForJson")}</button
                  >
                </div>
              </div>
            {/if}

            <div class="grid gap-2">
              <button
                type="button"
                class={sourceButtonClass("helper", inventorySource)}
                aria-pressed={inventorySource === "helper"}
                on:click={() => (inventorySource = "helper")}
              >
                <div class="flex items-center justify-between gap-3">
                  <!-- The executable's real name on GitHub Releases; never localised. -->
                  <span class="font-display text-sm font-semibold">warframe-api-helper</span>
                  <span
                    class="rounded bg-success/15 px-2 py-0.5 font-display text-xs font-bold tracking-widest text-success"
                    >{$tr("common.recommended")}</span
                  >
                </div>
                <div class="mt-1 text-xs leading-snug">
                  {$tr("setup.source.helper.desc")}
                </div>
                <div class="mt-2 text-xs text-text-muted">
                  {#if helperStatus === "checking"}
                    {$tr("setup.source.helper.checking")}
                  {:else if helperStatus === "found"}
                    {$tr("setup.source.helper.found", { path: helperPath ?? "" })}
                  {:else if runnerStatus?.exeFound}
                    {$tr("setup.source.helper.ready")}
                  {:else}
                    {$tr("setup.source.helper.notInstalled")}
                  {/if}
                </div>
              </button>

              <button
                type="button"
                class={sourceButtonClass("json", inventorySource)}
                aria-pressed={inventorySource === "json"}
                on:click={() => (inventorySource = "json")}
              >
                <span class="font-display text-sm font-semibold"
                  >{$tr("setup.source.json.name")}</span
                >
                <div class="mt-1 text-xs leading-snug">
                  {$tr("setup.source.json.desc")}
                </div>
              </button>

              <button
                type="button"
                class={sourceButtonClass("aleca", inventorySource)}
                aria-pressed={inventorySource === "aleca"}
                on:click={() => (inventorySource = "aleca")}
              >
                <span class="font-display text-sm font-semibold"
                  >{$tr("setup.source.aleca.name")}</span
                >
                <div class="mt-1 text-xs leading-snug">
                  {$tr("setup.source.aleca.desc")}
                </div>
              </button>
            </div>
          {:else if step === "downloading"}
            <h2 class="mb-3 font-display text-lg font-bold tracking-[0.02em]">
              {$tr("setup.downloading.title")}
            </h2>
            <p class="mb-2.5 text-sm leading-[1.55] text-text-secondary">
              {$tr("setup.downloading.desc")}
            </p>
            <div class="my-4">
              <div class="h-2 overflow-hidden rounded border border-border bg-bg-raised">
                <div
                  class="h-full rounded bg-accent transition-[width] duration-300 ease-in-out"
                  style="width: {progressPercent}%"
                ></div>
              </div>
              <div class="mt-1.5 flex justify-between text-xs text-text-muted">
                <span>{progressPercent}%</span>
                <span>{bytesLabel}</span>
              </div>
            </div>
            <p class="!mt-4 !text-xs !text-text-muted">
              {$tr("setup.downloading.wait")}
            </p>
          {:else if step === "done"}
            <h2 class="mb-3 font-display text-lg font-bold tracking-[0.02em]">
              {$tr("setup.done.title")}
            </h2>
            <p class="mb-2.5 text-sm leading-[1.55] text-text-secondary">
              {$tr("setup.done.ready")}
            </p>
            <p class="mb-2.5 text-sm leading-[1.55] text-text-secondary">
              {$tr("setup.done.background")}
            </p>
            <div class="my-4 flex justify-center text-success">
              <svg
                class="h-10 w-10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p class="!mt-4 !text-xs !text-text-muted">
              {$tr("setup.done.clickHint", { button: $tr("common.next") })}
            </p>
          {:else if step === "error"}
            <h2 class="mb-3 font-display text-lg font-bold tracking-[0.02em]">
              {$tr("setup.error.title")}
            </h2>
            <p class="mb-2.5 text-sm font-semibold leading-[1.55] text-danger">{errorMessage}</p>
            <p class="mb-2.5 text-sm leading-[1.55] text-text-secondary">
              {$tr("setup.error.desc")}
            </p>
          {/if}
        </div>

        <div class="mt-2 flex justify-end gap-2 border-t border-border pt-4">
          {#if step === "configure"}
            <button class="btn-secondary btn-sm" on:click={skip}>{$tr("setup.skip")}</button>
            <button class="btn-primary btn-sm" on:click={continueFromConfigure}
              >{$tr("common.next")}</button
            >
          {:else if step === "inventory"}
            <button class="btn-secondary btn-sm" on:click={skip}>{$tr("setup.skip")}</button>
            <button
              class="btn-primary btn-sm"
              disabled={loadingApi}
              on:click={useSelectedInventorySource}
            >
              {#if loadingApi}
                {$tr("common.loading")}
              {:else if inventorySource === "helper"}
                {runnerStatus?.exeFound ? $tr("setup.loadHelperData") : $tr("setup.installHelper")}
              {:else if inventorySource === "json"}
                {$tr("setup.importJsonButton")}
              {:else if inventorySource === "aleca"}
                {$tr("setup.importAlecaButton")}
              {/if}
            </button>
          {:else if step === "downloading"}
            <span></span>
          {:else if step === "done"}
            <button class="btn-primary btn-sm" on:click={finish}>{$tr("common.next")}</button>
          {:else if step === "error"}
            <button class="btn-secondary btn-sm" on:click={skip}>{$tr("setup.skip")}</button>
            <button class="btn-primary btn-sm" on:click={retry}>{$tr("common.retry")}</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</section>
