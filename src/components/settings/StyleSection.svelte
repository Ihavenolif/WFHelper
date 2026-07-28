<script lang="ts">
  import type { RelicCardStyle, ThemeCornerStyle, ThemeSurfaceStyle } from "../../types/theme.js";
  import { tr } from "../../lib/i18n.js";
  import type { MessageKey } from "../../lib/i18n.js";
  import { themeSettings } from "../../stores/theme.js";
  import { marketDensity } from "../../stores/uiDensity.js";
  import type { UiDensity } from "../../stores/uiDensity.js";
  import ThemedControlCard from "../ThemedControlCard.svelte";
  import SegmentedControl from "../SegmentedControl.svelte";

  const cornerOptions: Array<{ value: ThemeCornerStyle; labelKey: MessageKey }> = [
    { value: "sharp", labelKey: "appearance.cornerSharp" },
    { value: "soft", labelKey: "appearance.cornerSoft" },
    { value: "round", labelKey: "appearance.cornerRound" },
  ];

  const surfaceOptions: Array<{ value: ThemeSurfaceStyle; labelKey: MessageKey }> = [
    { value: "full", labelKey: "appearance.surfaceFull" },
    { value: "border", labelKey: "appearance.surfaceBorder" },
    { value: "minimal", labelKey: "appearance.surfaceMinimal" },
  ];

  const relicCardOptions: Array<{ value: RelicCardStyle; labelKey: MessageKey }> = [
    { value: "ornate", labelKey: "appearance.relicCardsOrnate" },
    { value: "plain", labelKey: "appearance.relicCardsPlain" },
  ];

  const densityOptions: ReadonlyArray<{ value: UiDensity; label: string }> = [
    { value: "compact", label: "Cards" },
    { value: "row", label: "Rows" },
  ];

  $: effects = $themeSettings.effects;
  $: cornerSegOptions = cornerOptions.map((o) => ({ value: o.value, label: $tr(o.labelKey) }));
  $: surfaceSegOptions = surfaceOptions.map((o) => ({ value: o.value, label: $tr(o.labelKey) }));
  $: relicSegOptions = relicCardOptions.map((o) => ({ value: o.value, label: $tr(o.labelKey) }));
</script>

<div class="appearance-section">
  <h4 class="appearance-section-label">{$tr("appearance.style")}</h4>

  <div class="grid gap-2">
    <ThemedControlCard>
      <div class="flex items-center justify-between gap-3">
        <span class="text-text-secondary text-xs font-medium">{$tr("appearance.cornerStyle")}</span>
        <SegmentedControl
          value={effects.cornerStyle}
          options={cornerSegOptions}
          onChange={(v) => themeSettings.setEffects({ cornerStyle: v })}
        />
      </div>
    </ThemedControlCard>

    <ThemedControlCard>
      <div class="flex items-center justify-between gap-3">
        <span class="text-text-secondary text-xs font-medium">{$tr("appearance.surfaceStyle")}</span
        >
        <SegmentedControl
          value={effects.surfaceStyle}
          options={surfaceSegOptions}
          onChange={(v) => themeSettings.setEffects({ surfaceStyle: v })}
        />
      </div>
    </ThemedControlCard>

    <ThemedControlCard>
      <label class="flex cursor-pointer items-center justify-between gap-2.5">
        <span class="text-text-secondary text-xs font-medium">
          {$tr("appearance.glass")}
          <span class="block text-xs text-text-muted font-normal mt-0.5"
            >{$tr("appearance.glassHint")}</span
          >
        </span>
        <input
          class="accent-accent"
          type="checkbox"
          checked={effects.glass}
          on:change={(e) =>
            themeSettings.setEffects({ glass: (e.target as HTMLInputElement).checked })}
        />
      </label>
      {#if effects.glass}
        <div class="mt-2 flex items-center gap-2">
          <input
            type="range"
            min="2"
            max="32"
            step="1"
            class="w-full accent-accent"
            aria-label="Glass blur strength"
            value={effects.glassBlurPx}
            on:input={(e) =>
              themeSettings.setEffects({
                glassBlurPx: Number((e.target as HTMLInputElement).value),
              })}
          />
          <span class="w-9 shrink-0 text-right text-xs text-text-primary tabular-nums"
            >{effects.glassBlurPx}px</span
          >
        </div>
      {/if}
    </ThemedControlCard>

    <ThemedControlCard>
      <div class="flex items-center justify-between gap-3">
        <span class="text-text-secondary text-xs font-medium">{$tr("appearance.relicCards")}</span>
        <SegmentedControl
          value={effects.relicCardStyle}
          options={relicSegOptions}
          onChange={(v) => themeSettings.setEffects({ relicCardStyle: v })}
        />
      </div>
    </ThemedControlCard>

    <ThemedControlCard>
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span class="min-w-0 text-text-secondary text-xs font-medium">
          Market list density
          <span class="block text-xs text-text-muted font-normal mt-0.5">
            How Warframe.market orders and riven contracts are displayed.
          </span>
        </span>
        <span class="shrink-0">
          <SegmentedControl
            value={$marketDensity}
            options={densityOptions}
            onChange={(v) => marketDensity.set(v)}
          />
        </span>
      </div>
    </ThemedControlCard>
  </div>
</div>
