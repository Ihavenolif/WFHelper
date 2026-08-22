import {
  type GoodRollData,
  parseRivenGoodRollCsv,
  RIVEN_GOOD_ROLL_TABS,
  RIVEN_GOOD_ROLLS_SHEET_ID,
} from "../config/shared/rivenGoodRolls";
import { statTagToDisplayName } from "../config/shared/rivenStatDisplayNames";
import { createJsonCache } from "./jsonCache";
import { withScope } from "./logger";

const log = withScope("rivenBestAttributes");

type GoodRollMap = Record<string, GoodRollData>;

interface CachePayload {
  updatedAt: string;
  data: GoodRollMap;
}

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let goodRolls: GoodRollMap | null = null;
let loadPromise: Promise<void> | null = null;

interface BestAttributes {
  positives: string[];
  negatives: string[];
}

export type { GoodRollData };

function isGoodRollData(value: unknown): value is GoodRollData {
  if (!value || typeof value !== "object") return false;
  const data = value as GoodRollData;
  return Array.isArray(data.goodAttrs) && Array.isArray(data.acceptedBadAttrs);
}

// An all-garbage entry map is treated as no cache at all so the sheet is refetched.
const cache = createJsonCache<CachePayload>("riven-good-rolls-cache.json", (raw) => {
  const parsed = raw as Partial<CachePayload>;
  if (!parsed.updatedAt || !parsed.data || typeof parsed.data !== "object") return null;
  const data: GoodRollMap = {};
  for (const [name, value] of Object.entries(parsed.data)) {
    if (isGoodRollData(value)) data[name] = value;
  }
  return Object.keys(data).length > 0 ? { updatedAt: parsed.updatedAt, data } : null;
});

function loadCacheIfNeeded(): void {
  if (goodRolls) return;
  const cached = cache.read();
  if (cached) goodRolls = cached.data;
}

function lookupName(weaponName: string): string | null {
  if (!weaponName) return null;
  loadCacheIfNeeded();
  if (!goodRolls) return null;
  const lc = weaponName.toLowerCase().trim();
  if (goodRolls[lc]) return lc;
  const stripped = lc
    .replace(/\s+(prime|wraith|vandal)\b/gi, " ")
    .replace(/^(kuva|tenet|prisma)\s+/i, "")
    .replace(/^mk1[-\s]+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped !== lc && goodRolls[stripped] ? stripped : null;
}

async function fetchSheet(): Promise<GoodRollMap> {
  const next: GoodRollMap = {};
  for (const { gid, klass } of RIVEN_GOOD_ROLL_TABS) {
    const url = `https://docs.google.com/spreadsheets/d/${RIVEN_GOOD_ROLLS_SHEET_ID}/export?format=csv&gid=${gid}`;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`gid=${gid}: HTTP ${response.status}`);
    for (const entry of parseRivenGoodRollCsv(await response.text(), klass)) {
      if (!next[entry.name]) {
        next[entry.name] = {
          goodAttrs: entry.goodAttrs,
          acceptedBadAttrs: entry.acceptedBadAttrs,
        };
      }
    }
  }
  return next;
}

export async function ensureRivenGoodRollsLoaded(force = false): Promise<void> {
  loadCacheIfNeeded();
  if (goodRolls && !force) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const fresh = await fetchSheet();
      goodRolls = fresh;
      cache.write({ updatedAt: new Date().toISOString(), data: fresh });
      log.info(`Loaded ${Object.keys(fresh).length} riven good-roll rows from Google Sheet`);
    } catch (err) {
      const cached = cache.read();
      if (cached) {
        goodRolls = cached.data;
        const ageMs = Date.now() - Date.parse(cached.updatedAt);
        const staleNote = Number.isFinite(ageMs) && ageMs > CACHE_MAX_AGE_MS ? " (stale)" : "";
        log.warn(`Using cached riven good-rolls data${staleNote}`, err);
      } else {
        goodRolls = {};
        log.warn("No riven good-rolls data available", err);
      }
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

export function setRivenGoodRollsForTest(data: GoodRollMap): void {
  goodRolls = data;
  loadPromise = null;
}

export function getGoodRolls(weaponName: string): GoodRollData | null {
  const key = lookupName(weaponName);
  return key && goodRolls ? goodRolls[key] : null;
}

export function getBestAttributes(weaponName: string, isMelee = false): BestAttributes | null {
  const data = getGoodRolls(weaponName);
  if (!data) return null;

  const seen = new Set<string>();
  const positives: string[] = [];
  for (const roll of data.goodAttrs) {
    for (const tag of roll.mandatory) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      positives.push(statTagToDisplayName(tag, isMelee));
    }
  }
  for (const roll of data.goodAttrs) {
    for (const tag of roll.optional) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      positives.push(statTagToDisplayName(tag, isMelee));
    }
  }
  const negatives = data.acceptedBadAttrs.map((tag) => statTagToDisplayName(tag, isMelee));
  return { positives, negatives };
}
