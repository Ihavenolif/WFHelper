import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { withScope } from "./logger";
import { writeFileAtomicSync } from "./atomicFile";
import {
  collectRelicInventoryCounts,
  totalRelicInventoryCount,
} from "../config/shared/relicCounts";

const log = withScope("statsTracker");

import type { DailyStatEntry, SessionStats } from "../config/shared/statsTypes";

// Session baselines (set on first inventory update)
let _baselinePlat: number | null = null;
let _baselineCredits: number | null = null;
let _baselineEndo: number | null = null;
let _baselineDucats: number | null = null;
let _baselineAya: number | null = null;
let _baselineVitus: number | null = null;

let _currentPlat: number | null = null;
let _currentCredits: number | null = null;
let _currentEndo: number | null = null;
let _currentDucats: number | null = null;
let _currentAya: number | null = null;
let _currentVitus: number | null = null;

// Relic tracking: accumulate decreases in total LevelKeys count throughout the day
let _lastRelicTotal: number | null = null;
let _todayRelicsOpened = 0;
let _todayDateForRelics = ""; // tracks which day the relics counter belongs to
let _todayDailyTrades = 0;
let _todayDateForTrades = "";

// Resume saved daily deltas so a restart cannot overwrite them with fresh baselines.
let _resumedPlatDelta = 0;
let _resumedCreditsDelta = 0;
let _resumedEndoDelta = 0;
let _resumedDucatsDelta = 0;
let _resumedAyaDelta = 0;
let _resumedVitusDelta = 0;

let _history: DailyStatEntry[] = [];
const HISTORY_MAX_DAYS = 90;

// Schema marker for the persisted history file. v2 = day keys are in the
// user's LOCAL timezone. v1 (and unversioned legacy files) used UTC.
const HISTORY_SCHEMA_VERSION = 2;


function _historyPath(): string {
  return path.join(app.getPath("userData"), "stats-history.json");
}

function _todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function _findMiscItemCount(data: Record<string, unknown>, itemType: string): number | null {
  const misc = Array.isArray(data.MiscItems) ? data.MiscItems as Array<Record<string, unknown>> : [];
  const entry = misc.find((e) => e.ItemType === itemType);
  return entry && typeof entry.ItemCount === "number" ? entry.ItemCount : null;
}

function _saveHistory(): void {
  try {
    // Wrap entries in a small envelope so the schema version travels with the
    // data. On load we still accept a bare-array legacy format for v1/untagged.
    const payload = {
      schemaVersion: HISTORY_SCHEMA_VERSION,
      entries: _history,
    };
    writeFileAtomicSync(_historyPath(), JSON.stringify(payload, null, 2));
  } catch (err: unknown) {
    log.warn("[StatsTracker] Failed to save history:", String(err));
  }
}

function _upsertToday(): void {
  const today = _todayStr();

  const platDelta = _resumedPlatDelta +
    (_currentPlat !== null && _baselinePlat !== null ? _currentPlat - _baselinePlat : 0);
  const creditsDelta = _resumedCreditsDelta +
    (_currentCredits !== null && _baselineCredits !== null
      ? _currentCredits - _baselineCredits
      : 0);
  const endoDelta = _resumedEndoDelta +
    (_currentEndo !== null && _baselineEndo !== null ? _currentEndo - _baselineEndo : 0);
  const ducatsDelta = _resumedDucatsDelta +
    (_currentDucats !== null && _baselineDucats !== null
      ? _currentDucats - _baselineDucats
      : 0);
  const ayaDelta = _resumedAyaDelta +
    (_currentAya !== null && _baselineAya !== null ? _currentAya - _baselineAya : 0);
  const vitusDelta = _resumedVitusDelta +
    (_currentVitus !== null && _baselineVitus !== null ? _currentVitus - _baselineVitus : 0);

  const entry: DailyStatEntry = {
    date: today,
    platDelta,
    creditsDelta,
    endoDelta,
    ducatsDelta,
    ayaDelta,
    vitusDelta,
    relicsOpened: _todayRelicsOpened,
    daysPlayed: 1,
    dailyTrades: _todayDailyTrades,
  };
  if (_currentPlat !== null) entry.absPlat = _currentPlat;
  if (_currentCredits !== null) entry.absCredits = _currentCredits;
  if (_currentEndo !== null) entry.absEndo = _currentEndo;
  if (_currentDucats !== null) entry.absDucats = _currentDucats;
  if (_currentAya !== null) entry.absAya = _currentAya;
  if (_currentVitus !== null) entry.absVitus = _currentVitus;

  const idx = _history.findIndex((e) => e.date === today);
  if (idx >= 0) {
    _history[idx] = entry;
  } else {
    _history.push(entry);
    if (_history.length > HISTORY_MAX_DAYS) {
      _history = _history.slice(-HISTORY_MAX_DAYS);
    }
  }

  _saveHistory();
}

export function loadHistory(): void {
  try {
    const raw = fs.readFileSync(_historyPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    // Track the loaded schema while accepting both the legacy array and v2 envelope.
    let entries: unknown = null;
    let loadedVersion = 1;
    if (Array.isArray(parsed)) {
      entries = parsed;
      loadedVersion = 1;
    } else if (parsed && typeof parsed === "object") {
      const env = parsed as { schemaVersion?: unknown; entries?: unknown };
      if (Array.isArray(env.entries)) {
        entries = env.entries;
        loadedVersion = typeof env.schemaVersion === "number" ? env.schemaVersion : 1;
      }
    }
    if (Array.isArray(entries)) {
      // Back-fill any fields missing from older schema so the shape is always complete
      const backFillDefaults: Pick<DailyStatEntry, "ducatsDelta" | "ayaDelta" | "vitusDelta" | "relicsOpened" | "daysPlayed" | "dailyTrades"> = {
        ducatsDelta: 0,
        ayaDelta: 0,
        vitusDelta: 0,
        relicsOpened: 0,
        daysPlayed: 1,
        dailyTrades: 0,
      };
      _history = (entries as DailyStatEntry[]).map((e) => ({
        ...backFillDefaults,
        ...e,
      }));
      if (loadedVersion < HISTORY_SCHEMA_VERSION) {
        log.info(
          `[StatsTracker] Migrating history schema v${loadedVersion} -> v${HISTORY_SCHEMA_VERSION} ` +
            `(day boundaries now local timezone; legacy UTC-keyed entries retained as-is).`,
        );
        // Preserve old date keys because aggregates lack timestamps for re-attribution.
        _saveHistory();
      }
      // Restore today's relic accumulator so app restarts don't reset the daily count to 0
      const today = _todayStr();
      const todayEntry = _history.find((e) => e.date === today);
      if (todayEntry && todayEntry.relicsOpened > 0) {
        _todayRelicsOpened = todayEntry.relicsOpened;
        _todayDateForRelics = today;
      }
      if (todayEntry && todayEntry.dailyTrades > 0) {
        _todayDailyTrades = todayEntry.dailyTrades;
        _todayDateForTrades = today;
      }
      // Resume accumulated deltas from today's saved entry so app restarts
      // don't overwrite the daily total with a fresh session baseline of 0.
      if (todayEntry) {
        _resumedPlatDelta = todayEntry.platDelta;
        _resumedCreditsDelta = todayEntry.creditsDelta;
        _resumedEndoDelta = todayEntry.endoDelta;
        _resumedDucatsDelta = todayEntry.ducatsDelta;
        _resumedAyaDelta = todayEntry.ayaDelta;
        _resumedVitusDelta = todayEntry.vitusDelta;
      }
      log.info(`[StatsTracker] Loaded ${_history.length} history entries`);
    }
  } catch (err) {
    _history = [];
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      log.warn(`[StatsTracker] Failed to load history:`, err);
    }
  }
}

export function onInventoryData(data: Record<string, unknown>): void {
  const plat    = _num(data.PremiumCredits);
  const credits = _num(data.RegularCredits);
  const endo    = _num(data.FusionPoints);
  // Ducats are stored as a MiscItem entry, not a top-level field
  const ducats  = _findMiscItemCount(data, "/Lotus/Types/Items/MiscItems/PrimeBucks");
  // PrimeTokens is the raw field name for Aya in the Warframe inventory JSON
  const aya     = _num(data.PrimeTokens);
  // Vitus Essence's internal name is Elitium
  const vitus   = _findMiscItemCount(data, "/Lotus/Types/Items/MiscItems/Elitium");

  const today = _todayStr();

  // Reset accumulator when the day rolls over
  if (_todayDateForRelics !== today) {
    _todayRelicsOpened = 0;
    _todayDateForRelics = today;
    _lastRelicTotal = null; // avoid a spurious spike across midnight
    // Reset resumed deltas and baselines for the new day
    _resumedPlatDelta = 0;
    _resumedCreditsDelta = 0;
    _resumedEndoDelta = 0;
    _resumedDucatsDelta = 0;
    _resumedAyaDelta = 0;
    _resumedVitusDelta = 0;
    _baselinePlat = null;
    _baselineCredits = null;
    _baselineEndo = null;
    _baselineDucats = null;
    _baselineAya = null;
    _baselineVitus = null;
  }
  if (_todayDateForTrades !== today) {
    _todayDailyTrades = 0;
    _todayDateForTrades = today;
  }

  const relicTotal = totalRelicInventoryCount(collectRelicInventoryCounts(data));
  if (_lastRelicTotal !== null && relicTotal < _lastRelicTotal) {
    _todayRelicsOpened += _lastRelicTotal - relicTotal;
  }
  _lastRelicTotal = relicTotal;

  if (_baselinePlat    === null && plat    !== null) _baselinePlat    = plat;
  if (_baselineCredits === null && credits !== null) _baselineCredits = credits;
  if (_baselineEndo    === null && endo    !== null) _baselineEndo    = endo;
  if (_baselineDucats  === null && ducats  !== null) _baselineDucats  = ducats;
  if (_baselineAya     === null && aya     !== null) _baselineAya     = aya;
  if (_baselineVitus   === null && vitus   !== null) _baselineVitus   = vitus;

  _currentPlat    = plat;
  _currentCredits = credits;
  _currentEndo    = endo;
  _currentDucats  = ducats;
  _currentAya     = aya;
  _currentVitus   = vitus;

  _upsertToday();
}

export function incrementTodayTrades(): void {
  const today = _todayStr();
  if (_todayDateForTrades !== today) {
    _todayDailyTrades = 0;
    _todayDateForTrades = today;
  }
  _todayDailyTrades++;
  _upsertToday();
}

export function getHistory(): DailyStatEntry[] {
  return _history;
}

const _num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export function importHistory(raw: DailyStatEntry[]): number {
  let imported = 0;
  const today = _todayStr();
  const byDate = new Map(_history.map((entry) => [entry.date, entry]));

  for (const entry of raw) {
    if (entry.date === today) continue;
    byDate.set(entry.date, entry);
    imported++;
  }

  if (imported > 0) {
    _history = [...byDate.values()].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    if (_history.length > HISTORY_MAX_DAYS) {
      _history = _history.slice(-HISTORY_MAX_DAYS);
    }
    _saveHistory();
  }
  return imported;
}

export function getCurrentSession(): SessionStats {
  const hasData =
    _currentPlat !== null ||
    _currentCredits !== null ||
    _currentEndo !== null ||
    _currentDucats !== null ||
    _currentAya !== null ||
    _currentVitus !== null;
  return {
    platDelta: _resumedPlatDelta +
      (_currentPlat !== null && _baselinePlat !== null ? _currentPlat - _baselinePlat : 0),
    creditsDelta: _resumedCreditsDelta +
      (_currentCredits !== null && _baselineCredits !== null
        ? _currentCredits - _baselineCredits
        : 0),
    endoDelta: _resumedEndoDelta +
      (_currentEndo !== null && _baselineEndo !== null ? _currentEndo - _baselineEndo : 0),
    ducatsDelta: _resumedDucatsDelta +
      (_currentDucats !== null && _baselineDucats !== null
        ? _currentDucats - _baselineDucats
        : 0),
    ayaDelta: _resumedAyaDelta +
      (_currentAya !== null && _baselineAya !== null ? _currentAya - _baselineAya : 0),
    vitusDelta: _resumedVitusDelta +
      (_currentVitus !== null && _baselineVitus !== null ? _currentVitus - _baselineVitus : 0),
    currentPlat:    _currentPlat,
    currentCredits: _currentCredits,
    currentEndo:    _currentEndo,
    currentDucats:  _currentDucats,
    currentAya:     _currentAya,
    currentVitus:   _currentVitus,
    hasData,
  };
}
