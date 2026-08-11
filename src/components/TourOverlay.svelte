<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";

  import { currentView } from "../stores/app.js";
  import { setMarketViewState } from "../stores/market.js";
  import { hiddenTabs } from "../stores/sidebarTabs.js";
  import { endTour } from "../stores/tour.js";

  const TOUR_TAB_STORAGE_KEYS = [
    "wf_inventory_tab",
    "wf_mastery_view_tab",
    "wf_rivens_tab",
    "world-tab",
  ] as const;

  interface TourStep {
    view: string;
    text: string;
    /** CSS selector to spotlight; defaults to the content area. */
    target?: string;
    /** Clicks and typing pass through the spotlight so the feature can be tried live. */
    interactive?: boolean;
    /** Runs after navigation, e.g. to switch a sub-tab. */
    prepare?: () => void;
  }

  function clickContentButton(label: string): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("#content button"));
    buttons.find((b) => b.textContent?.trim() === label)?.click();
  }

  function selectTourTab(selector: string, label: string, startsWith = false): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(`${selector} button`));
    buttons
      .find((button) => {
        const text = button.textContent?.trim() ?? "";
        return startsWith ? text.startsWith(label) : text === label;
      })
      ?.click();
  }

  function prepareTab(storageKey: string, value: string, selector: string, label: string): void {
    localStorage.setItem(storageKey, value);
    selectTourTab(selector, label);
  }

  const steps: TourStep[] = [
    {
      view: "inventory",
      target: '[data-tour="inventory-grid"]',
      text: "Inventory shows your tradable items and current warframe.market prices. Click a card to view orders or list the item.",
      interactive: true,
      prepare: () =>
        prepareTab("wf_inventory_tab", "all_parts", '[data-tour="inventory-tabs"]', "All Parts"),
    },
    {
      view: "inventory",
      target: '[data-tour="inventory-tabs"]',
      text: "Use these tabs to switch item types. Full Sets shows every set you can sell as a complete set.",
      interactive: true,
    },
    {
      view: "foundry",
      text: "Foundry shows builds you can start, builds in progress, and items ready to claim. Pinned recipes stay at the top.",
    },
    {
      view: "mastery",
      text: "Mastery tracks your rank progress and the items you have not mastered.",
      prepare: () =>
        prepareTab(
          "wf_mastery_view_tab",
          "collection",
          '[data-tour="mastery-view-tabs"]',
          "Collection",
        ),
    },
    {
      view: "mastery",
      target: '[data-tour="filter-bar"]',
      text: "Press Ctrl+F to search. Filters can be combined. Use the arrow next to Sort to change direction.",
      interactive: true,
      prepare: () =>
        prepareTab(
          "wf_mastery_view_tab",
          "collection",
          '[data-tour="mastery-view-tabs"]',
          "Collection",
        ),
    },
    {
      view: "mastery",
      target: '[data-tour="mastery-roadmap"]',
      text: "MR Roadmap suggests what to master next. Easy uses owned and Foundry items. From Relics uses your relics. With Platinum compares XP per platinum.",
      interactive: true,
      prepare: () =>
        prepareTab(
          "wf_mastery_view_tab",
          "roadmap",
          '[data-tour="mastery-view-tabs"]',
          "MR Roadmap",
        ),
    },
    {
      view: "stats",
      text: "Stats tracks resources and trades detected in EE.log. You can also import AlecaFrame history.",
    },
    {
      view: "world",
      text: "World shows cycles, fissures, invasions, bounties, and Circuit rotations. Cycle alerts are optional.",
      prepare: () => {
        localStorage.setItem("world-tab", "world");
        clickContentButton("World");
      },
    },
    {
      view: "world",
      target: '[data-tour="arbi-schedule"]',
      text: "Filter the arbitration schedule by node or save a preset. Click a bell to get a notification before that arbitration starts.",
      interactive: true,
      prepare: () => {
        localStorage.setItem("world-tab", "arbis");
        clickContentButton("Arbitrations");
      },
    },
    {
      view: "relics",
      target: '[data-tour="relic-filters"]',
      text: "Relics can show your collection or the full catalog. Search by reward, find relics with unowned items, and compare expected value.",
      interactive: true,
    },
    {
      view: "market",
      text: "View and manage your warframe.market orders here. Completed trades can close matching orders automatically.",
      prepare: () => setMarketViewState({ typeTab: "sell" }),
    },
    {
      view: "market",
      target: '[data-tour="market-browse"]',
      text: "Browse shows public buy and sell orders without signing in. You can copy a whisper or create your own order.",
      interactive: true,
      prepare: () => setMarketViewState({ typeTab: "browse" }),
    },
    {
      view: "rivens",
      target: '[data-tour="riven-view-tabs"]',
      text: "Use these tabs for unveiled Rivens, veiled Rivens, and Riven Finder. Click an owned Riven to see its grades. Riven Finder searches market listings by weapon and stats.",
      interactive: true,
      prepare: () => {
        localStorage.setItem("wf_rivens_tab", "unveiled");
        selectTourTab('[data-tour="riven-view-tabs"]', "Unveiled", true);
      },
    },
    {
      view: "arbi",
      text: "Arbitration runs are recorded automatically. Open a run for details or import an EE.log file.",
    },
    {
      view: "wiki",
      text: "Search for an item to see where it drops.",
      interactive: true,
    },
    {
      view: "settings",
      text: "Configure the relic, Riven, trade, and arbitration overlays here.",
      prepare: () => clickContentButton("Overlays"),
    },
    {
      view: "settings",
      text: "Choose which tabs and notifications you want. You can restart this tour here.",
      prepare: () => clickContentButton("General"),
    },
  ];

  let index = 0;
  let rect: { x: number; y: number; w: number; h: number } | null = null;
  let targetMatched = false;
  let winW = 0;
  let winH = 0;
  let missingSince = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let savedTabPreferences: Array<readonly [string, string | null]> = [];
  let preferencesRestored = false;

  $: tourSteps = steps.filter((candidate) => !$hiddenTabs.has(candidate.view));
  $: if (index >= tourSteps.length) index = Math.max(0, tourSteps.length - 1);
  $: step = tourSteps[index];
  const cutoutRadius = 10;

  function measure(): void {
    winW = window.innerWidth;
    winH = window.innerHeight;
    const requestedTarget = step.target ? document.querySelector(step.target) : null;
    let el = requestedTarget;
    targetMatched = !step.target;
    if (!el && step.target) {
      // lazy views need a moment; after 3s give up and frame the whole view
      if (!missingSince) missingSince = Date.now();
      if (Date.now() - missingSince < 3000) {
        rect = null;
        return;
      }
    }
    if (!el) el = document.querySelector("#content");
    if (!el) {
      rect = null;
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      rect = null;
      return;
    }
    targetMatched = !step.target || Boolean(requestedTarget);
    const pad = 6;
    rect = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
  }

  async function activate(next: number): Promise<void> {
    const entry = tourSteps[next];
    if (!entry) return;
    index = next;
    rect = null;
    targetMatched = false;
    missingSince = 0;
    currentView.set(entry.view as never);
    await tick();
    entry.prepare?.();
    measure();
  }

  function restoreTabPreferences(): void {
    if (preferencesRestored) return;
    preferencesRestored = true;
    const saved = Object.fromEntries(savedTabPreferences);
    if ($currentView === "inventory") {
      const labels: Record<string, string> = {
        all_parts: "All Parts",
        relics: "Relics",
        mods: "Mods",
        arcanes: "Arcanes",
        full_sets: "Full Sets",
        equipment: "Equipment",
        resources: "Resources",
        misc: "Misc",
      };
      selectTourTab(
        '[data-tour="inventory-tabs"]',
        labels[saved.wf_inventory_tab ?? "all_parts"] ?? "All Parts",
      );
    } else if ($currentView === "mastery") {
      selectTourTab(
        '[data-tour="mastery-view-tabs"]',
        saved.wf_mastery_view_tab === "roadmap" ? "MR Roadmap" : "Collection",
      );
    } else if ($currentView === "rivens") {
      const label =
        saved.wf_rivens_tab === "finder"
          ? "Riven Finder"
          : saved.wf_rivens_tab === "veiled"
            ? "Veiled"
            : "Unveiled";
      selectTourTab('[data-tour="riven-view-tabs"]', label, true);
    } else if ($currentView === "world") {
      clickContentButton(saved["world-tab"] === "arbis" ? "Arbitrations" : "World");
    }

    for (const [key, value] of savedTabPreferences) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  }

  function finishTour(): void {
    restoreTabPreferences();
    endTour();
  }

  function nextStep(): void {
    if (index >= tourSteps.length - 1) {
      finishTour();
      return;
    }
    void activate(index + 1);
  }

  function backStep(): void {
    if (index > 0) void activate(index - 1);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      finishTour();
      return;
    }
    // typing into a spotlighted input must not advance the tour
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
    ) {
      return;
    }
    if (event.key === "ArrowRight" || event.key === "Enter") nextStep();
    if (event.key === "ArrowLeft") backStep();
  }

  // Caption goes below the cutout, then above, then beside it; if the cutout
  // fills the screen it sits bottom-center so headers and filters stay visible.
  const CARD_W = 380;
  const GAP = 12;
  let cardH = 150;

  function placeCard(r: typeof rect, w: number, h: number, ch: number): { x: number; y: number } {
    if (!r) return { x: w / 2 - CARD_W / 2, y: h / 2 - ch / 2 };
    const clampX = (x: number): number => Math.min(Math.max(x, GAP), w - CARD_W - GAP);
    const clampY = (y: number): number => Math.min(Math.max(y, GAP), h - ch - GAP);
    if (r.y + r.h + GAP + ch + GAP <= h) return { x: clampX(r.x), y: r.y + r.h + GAP };
    if (r.y - ch - GAP >= GAP) return { x: clampX(r.x), y: r.y - ch - GAP };
    if (r.x + r.w + GAP + CARD_W + GAP <= w) return { x: r.x + r.w + GAP, y: clampY(r.y) };
    if (r.x - CARD_W - GAP >= GAP) return { x: r.x - CARD_W - GAP, y: clampY(r.y) };
    return { x: w / 2 - CARD_W / 2, y: h - ch - GAP * 2 };
  }

  $: ({ x: cardX, y: cardY } = placeCard(rect, winW, winH, cardH));

  onMount(() => {
    savedTabPreferences = TOUR_TAB_STORAGE_KEYS.map(
      (key) => [key, localStorage.getItem(key)] as const,
    );
    void activate(0);
    pollTimer = setInterval(measure, 300);
    window.addEventListener("resize", measure);
    window.addEventListener("keydown", onKeydown, true);
  });

  onDestroy(() => {
    restoreTabPreferences();
    if (pollTimer) clearInterval(pollTimer);
    window.removeEventListener("resize", measure);
    window.removeEventListener("keydown", onKeydown, true);
  });
</script>

<div class="pointer-events-none fixed inset-0 z-[300]">
  <svg class="pointer-events-none absolute inset-0 h-full w-full" width={winW} height={winH}>
    <defs>
      <mask id="tour-mask">
        <rect x="0" y="0" width="100%" height="100%" fill="white" />
        {#if rect}
          <rect
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            rx={cutoutRadius}
            ry={cutoutRadius}
            fill="black"
          />
        {/if}
      </mask>
    </defs>
    <rect
      x="0"
      y="0"
      width="100%"
      height="100%"
      fill="rgba(0, 0, 0, 0.62)"
      mask="url(#tour-mask)"
    />
    {#if rect}
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        rx={cutoutRadius}
        ry={cutoutRadius}
        fill="none"
        stroke="var(--accent)"
        stroke-width="1.5"
        opacity="0.9"
      />
    {/if}
  </svg>

  {#if step.interactive && rect}
    <!-- block everything except the spotlight so only the featured UI is live -->
    <div
      class="pointer-events-auto absolute inset-x-0 top-0"
      style="height: {Math.max(0, rect.y)}px;"
    ></div>
    <div
      class="pointer-events-auto absolute inset-x-0 bottom-0"
      style="top: {rect.y + rect.h}px;"
    ></div>
    <div
      class="pointer-events-auto absolute left-0"
      style="top: {rect.y}px; height: {rect.h}px; width: {Math.max(0, rect.x)}px;"
    ></div>
    <div
      class="pointer-events-auto absolute right-0"
      style="top: {rect.y}px; height: {rect.h}px; left: {rect.x + rect.w}px;"
    ></div>
  {:else}
    <div class="pointer-events-auto absolute inset-0"></div>
  {/if}

  <div
    bind:clientHeight={cardH}
    data-tour-card
    data-tour-target-matched={!step.target || targetMatched ? "true" : "false"}
    class="pointer-events-auto absolute flex flex-col gap-2 rounded-xl border border-border bg-bg-surface p-4"
    style="left: {cardX}px; top: {cardY}px; width: {CARD_W}px;"
  >
    <div class="flex items-center justify-between gap-3">
      <span class="font-display text-xs font-bold tracking-widest text-accent">FEATURE TOUR</span>
      <span class="text-xs text-text-muted">{index + 1} / {tourSteps.length}</span>
    </div>
    <p class="m-0 text-sm leading-snug text-text-primary">{step.text}</p>
    {#if step.interactive}
      <p class="m-0 text-xs font-semibold text-accent">You can use the highlighted area now.</p>
    {/if}
    <div class="mt-1 flex items-center justify-between">
      <button class="btn-secondary btn-sm" on:click={finishTour}>Skip tour</button>
      <div class="flex gap-2">
        {#if index > 0}
          <button class="btn-secondary btn-sm" on:click={backStep}>Back</button>
        {/if}
        <button class="btn-primary btn-sm" on:click={nextStep}>
          {index >= tourSteps.length - 1 ? "Done" : "Next"}
        </button>
      </div>
    </div>
  </div>
</div>
