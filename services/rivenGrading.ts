// Reverses browse.wf/calamity RivenParser.js display values to roll floats before grading.
// The forward formulas are inverted in unparseBuff and unparseCurse.

import { withScope } from "./logger";
import * as rivenData from "./rivenData";
import {
  NUM_BUFFS_ATTEN,
  NUM_BUFFS_CURSE_ATTEN,
  SPECIFIC_FIT_ATTEN,
  BASE_DRAIN,
  NON_PERCENTAGE_TAGS,
} from "./rivenConstants";
import { getGoodRolls, type GoodRollData } from "./rivenBestAttributes";
import { clamp01 } from "./rewardScannerUtils";

const log = withScope("rivenGrading");

interface GradedStat {
  name: string;
  positive: boolean;
  displayPositive?: boolean;
  value: number | null;
  multiplier?: boolean;
  grade: string;
  rollFloat: number;
}

export interface RivenGradeResult {
  stats: GradedStat[];
  overallGrade: string;
  /** Attribute-based riven quality: "Great" | "Good" | "OK" | "Bad" */
  attributeGrade: string;
}

/** Default riven max rank. Most rivens are rank 8 (lvl 0..8). */
const DEFAULT_LVL = 8;

/** RivenParser.js thresholds map lerp(-10, 10, rollFloat) to letter grades. */
const GRADE_THRESHOLDS: { min: number; grade: string }[] = [
  { min: 9.5, grade: "S" },
  { min: 7.5, grade: "A+" },
  { min: 5.5, grade: "A" },
  { min: 3.5, grade: "A-" },
  { min: 1.5, grade: "B+" },
  { min: -1.5, grade: "B" },
  { min: -3.5, grade: "B-" },
  { min: -5.5, grade: "C+" },
  { min: -7.5, grade: "C" },
  { min: -9.5, grade: "C-" },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function inverseLerp(a: number, b: number, v: number): number {
  if (b === a) return 0;
  return (v - a) / (b - a);
}

/** Converts a roll float to a grade, inverting curses so lower magnitude grades higher. */
export function floatToGrade(rollFloat: number, isCurse: boolean): string {
  const f = isCurse ? 1 - rollFloat : rollFloat;
  const score = lerp(-10, 10, f);
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return "F";
}

/** Inverts RivenParser.js's buff formula for percentage or raw special-stat values.
 * Forward: base * (1.5*disp*10) * 1.25^curses * lerp(0.9,1.1,roll) * buffsAtten * (lvl+1). */
export function unparseBuff(
  displayedValue: number,
  baseValue: number,
  disposition: number,
  numBuffs: number,
  numCurses: number,
  tag?: string,
  lvl: number = DEFAULT_LVL,
): number {
  return clamp01(
    unparseBuffRaw(displayedValue, baseValue, disposition, numBuffs, numCurses, tag, lvl),
  );
}

/** Same as unparseBuff but unclamped - out-of-range floats reveal a dispo misfit. */
function unparseBuffRaw(
  displayedValue: number,
  baseValue: number,
  disposition: number,
  numBuffs: number,
  numCurses: number,
  tag?: string,
  lvl: number = DEFAULT_LVL,
): number {
  const buffsAtten = NUM_BUFFS_ATTEN[Math.min(numBuffs, NUM_BUFFS_ATTEN.length - 1)];
  const curseAtten = Math.pow(1.25, numCurses);
  const attenuation = SPECIFIC_FIT_ATTEN * disposition * BASE_DRAIN;

  // Convert displayed value to raw multiplier
  let value: number;
  if (tag && NON_PERCENTAGE_TAGS.has(tag)) {
    value = displayedValue;
  } else {
    value = displayedValue / 100;
  }

  if (baseValue === 0 || attenuation === 0 || buffsAtten === 0 || curseAtten === 0) return 0.5;

  value /= lvl + 1;
  value /= buffsAtten;
  value /= curseAtten;
  value /= attenuation;
  // OCR values are unsigned; abs(baseValue) handles negative-base stats such as recoil.
  value /= Math.abs(baseValue);

  // value is now lerp(0.9, 1.1, rollFloat) -> invert
  return (value - 0.9) / 0.2;
}

/** Inverts RivenParser.js's curse formula after OCR has removed the displayed sign.
 * Forward: -base * (1.5*disp*10) * lerp(0.9,1.1,roll) * curseAtten * buffsAtten * (lvl+1). */
export function unparseCurse(
  displayedValue: number,
  baseValue: number,
  disposition: number,
  numBuffs: number,
  numCurses: number,
  tag?: string,
  lvl: number = DEFAULT_LVL,
): number {
  return clamp01(
    unparseCurseRaw(displayedValue, baseValue, disposition, numBuffs, numCurses, tag, lvl),
  );
}

/** Same as unparseCurse but unclamped - out-of-range floats reveal a dispo misfit. */
function unparseCurseRaw(
  displayedValue: number,
  baseValue: number,
  disposition: number,
  numBuffs: number,
  numCurses: number,
  tag?: string,
  lvl: number = DEFAULT_LVL,
): number {
  const attenuation = SPECIFIC_FIT_ATTEN * disposition * BASE_DRAIN;
  // Note the swapped indexing: buffs table by curse count, curse table by buff count
  const cursesInBuffTable = NUM_BUFFS_ATTEN[Math.min(numCurses, NUM_BUFFS_ATTEN.length - 1)];
  const buffsInCurseTable =
    NUM_BUFFS_CURSE_ATTEN[Math.min(numBuffs, NUM_BUFFS_CURSE_ATTEN.length - 1)];

  // Convert displayed value to raw multiplier (absolute value)
  let value: number;
  if (tag && NON_PERCENTAGE_TAGS.has(tag)) {
    value = Math.abs(displayedValue);
  } else {
    value = Math.abs(displayedValue) / 100;
  }

  if (baseValue === 0 || attenuation === 0 || cursesInBuffTable === 0 || buffsInCurseTable === 0)
    return 0.5;

  value /= lvl + 1;
  value /= cursesInBuffTable;
  value /= buffsInCurseTable;
  value /= attenuation;
  value /= Math.abs(baseValue);
  // OCR is already absolute, so abs(baseValue) replaces division by baseValue then -1.

  return (value - 0.9) / 0.2;
}

interface ScannedStat {
  name: string;
  positive: boolean;
  displayPositive?: boolean;
  value: number | null;
  multiplier?: boolean;
}

// Sibling tags an OCR-garbled stat name can actually be ("+190.2% Critical
// Damage" on a melee is really Melee Damage). Checked by value plausibility.
const STAT_CONFUSION_SIBLINGS: Record<string, string[]> = {
  WeaponDamageAmountMod: ["WeaponMeleeDamageMod", "WeaponCritDamageMod"],
  WeaponMeleeDamageMod: ["WeaponDamageAmountMod", "WeaponCritDamageMod"],
  WeaponCritDamageMod: ["WeaponMeleeDamageMod", "WeaponDamageAmountMod"],
  WeaponCritChanceMod: ["SlideAttackCritChanceMod", "WeaponStunChanceMod"],
  SlideAttackCritChanceMod: ["WeaponCritChanceMod"],
  WeaponStunChanceMod: ["WeaponCritChanceMod"],
};

// Riven type data lists both damage tags with identical bases, but cards use one by class.
// Normalize to the card's form before checking its numeric range.
function weaponDamageTag(tag: string, isMelee: boolean): string {
  if (isMelee && tag === "WeaponDamageAmountMod") return "WeaponMeleeDamageMod";
  if (!isMelee && tag === "WeaponMeleeDamageMod") return "WeaponDamageAmountMod";
  return tag;
}

// Same tolerance as the dispo refit: display rounding can nudge a legit
// min/max roll fractionally out of range.
const CORRECTION_FIT_TOLERANCE = 0.02;
// Only rename when the parsed stat is clearly impossible, not merely marginal.
const CORRECTION_MISFIT_THRESHOLD = 0.1;

// Rename an impossible OCR stat only when exactly one confusion sibling fits.
// Keep and log uncorrectable misfits.
export function correctScannedStats(
  weaponName: string,
  stats: ScannedStat[],
): { stats: ScannedStat[]; corrections: number } {
  const baseDisposition = rivenData.getWeaponDisposition(weaponName);
  const rivenTypeKey = rivenData.resolveRivenType(weaponName);
  if (baseDisposition == null || !rivenTypeKey || stats.length === 0) {
    return { stats, corrections: 0 };
  }

  const category = rivenData.getWeaponCategory(weaponName);
  const isMelee = category === "Melee" || category === "SpaceMelee";
  const numBuffs = stats.filter((s) => s.positive).length;
  const numCurses = stats.filter((s) => !s.positive).length;
  const dispositions = [
    baseDisposition,
    ...rivenData.getFamilyVariants(weaponName).map((v) => v.disposition),
  ];

  // Best-case violation across family variants; null when the tag cannot roll
  // on this weapon at all (absent from the riven type or wrong polarity).
  const violationFor = (tag: string, stat: ScannedStat, displayedValue: number): number | null => {
    const entry = rivenData.findUpgradeEntry(rivenTypeKey, tag);
    if (!entry) return null;
    if (stat.positive ? !entry.canBeBuff : !entry.canBeCurse) return null;
    let best = Infinity;
    for (const disp of dispositions) {
      const f = stat.positive
        ? unparseBuffRaw(
            displayedValue,
            entry.baseValue,
            disp,
            numBuffs,
            numCurses,
            tag,
            DEFAULT_LVL,
          )
        : unparseCurseRaw(
            displayedValue,
            entry.baseValue,
            disp,
            numBuffs,
            numCurses,
            tag,
            DEFAULT_LVL,
          );
      best = Math.min(best, Math.max(0, f - 1) + Math.max(0, -f));
    }
    return best;
  };

  let corrections = 0;
  const corrected = stats.map((original) => {
    let stat = original;
    let tag = rivenData.statNameToTag(stat.name);
    if (!tag) return stat;

    // Categorical rename: melee cards never say "Damage", ranged never
    // "Melee Damage" - a scanned cross-form is always a misread label.
    const normalizedTag = weaponDamageTag(tag, isMelee);
    if (normalizedTag !== tag) {
      const newName = rivenData.getStatDisplayName(normalizedTag, isMelee);
      log.info(`[RivenGrade] "${stat.name}" cannot roll on "${weaponName}" - renamed "${newName}"`);
      corrections++;
      stat = { ...stat, name: newName };
      tag = normalizedTag;
    }

    if (stat.value == null || !Number.isFinite(stat.value) || stat.multiplier) return stat;
    const value = stat.value;

    const origViolation = violationFor(tag, stat, value);
    if (origViolation != null && origViolation <= CORRECTION_MISFIT_THRESHOLD) return stat;

    const siblings = STAT_CONFUSION_SIBLINGS[tag] ?? [];
    const fitTags = [
      ...new Set(siblings.map((sibling) => weaponDamageTag(sibling, isMelee))),
    ].filter((sibling) => {
      if (sibling === tag) return false;
      const v = violationFor(sibling, stat, value);
      return v != null && v <= CORRECTION_FIT_TOLERANCE;
    });

    if (fitTags.length === 1) {
      const newName = rivenData.getStatDisplayName(fitTags[0], isMelee);
      log.info(
        `[RivenGrade] "${stat.name}" ${stat.positive ? "+" : "-"}${stat.value} misfits ` +
          `"${weaponName}" - corrected to "${newName}"`,
      );
      corrections++;
      return { ...stat, name: newName };
    }

    if (origViolation != null) {
      log.warn(
        `[RivenGrade] "${stat.name}" ${stat.positive ? "+" : "-"}${stat.value} is out of ` +
          `range for "${weaponName}" (violation ${origViolation.toFixed(3)}) - kept as scanned`,
      );
    }
    return stat;
  });

  return { stats: corrected, corrections };
}

/** Scores each attribute as Decisive, Good, Bad, or NotHelping. */
type AlecaAttrGrade = "Decisive" | "Good" | "NotHelping" | "Bad";

function gradeFromGoodRolls(
  data: GoodRollData,
  goodTags: string[],
  badTags: string[],
): { positive: AlecaAttrGrade[]; negative: AlecaAttrGrade[]; overall: string } {
  const positive: AlecaAttrGrade[] = goodTags.map(() => "NotHelping");
  const negative: AlecaAttrGrade[] = badTags.map(() => "NotHelping");

  // Negative grades.
  for (let i = 0; i < badTags.length; i++) {
    const tag = badTags[i];
    if (data.acceptedBadAttrs.includes(tag)) {
      negative[i] = "Good";
    } else if (data.goodAttrs.some((g) => g.mandatory.includes(tag) || g.optional.includes(tag))) {
      negative[i] = "Bad";
    } else {
      negative[i] = "NotHelping";
    }
  }

  // Positive grades.
  for (let i = 0; i < goodTags.length; i++) {
    const tag = goodTags[i];
    if (data.goodAttrs.some((g) => g.mandatory.includes(tag))) {
      positive[i] = "Decisive";
    } else if (data.goodAttrs.some((g) => g.optional.includes(tag))) {
      positive[i] = "Good";
    } else {
      positive[i] = "NotHelping";
    }
  }

  // Does at least one full GoodRoll match? (all mandatory present, and the
  // user's positives are a subset of mandatory or optional)
  const goodSet = new Set(goodTags);
  const matches = data.goodAttrs.filter((g) => {
    if (!g.mandatory.every((m) => goodSet.has(m))) return false;
    const allowed = new Set([...g.mandatory, ...g.optional]);
    return goodTags.every((t) => allowed.has(t));
  });
  const flag = matches.length > 0;
  const num = positive.filter((p) => p === "Decisive" || p === "Good").length;
  const hasBadNeg = negative.some((n) => n === "Bad");
  const hasNotHelpingNeg = negative.some((n) => n === "NotHelping");
  const hasAnyNeg = negative.length > 0;

  // Flatten the detailed result to the 4-level UI scale already in use.
  let overall: string;
  if (hasBadNeg) {
    overall = (flag && num >= 2) || num >= 3 ? "OK" /* HasPotential */ : "Bad";
  } else if (hasNotHelpingNeg) {
    if (flag || num >= 2) overall = "Good";
    else if (num >= 1) overall = "OK"; /* HasPotential */
    else overall = "Bad";
  } else if (flag) {
    overall = num >= 2 && hasAnyNeg ? "Great" /* Perfect */ : "Good";
  } else if (num >= 2) {
    overall = "Good";
  } else if (num >= 1) {
    overall = "OK";
  } else {
    overall = "Bad";
  }
  return { positive, negative, overall };
}

/** Scores 44bananas' per-weapon good-roll data; unknown weapons return "?". */
export function computeAttributeGrade(
  stats: { name: string; positive: boolean }[],
  weaponName: string,
): string {
  const positives = stats.filter((s) => s.positive);
  const negatives = stats.filter((s) => !s.positive);

  const data = getGoodRolls(weaponName);
  if (!data) return "?";

  const goodTags = positives.map((s) => rivenData.statNameToTag(s.name) ?? s.name);
  const badTags = negatives.map((s) => rivenData.statNameToTag(s.name) ?? s.name);
  return gradeFromGoodRolls(data, goodTags, badTags).overall;
}

/** Grades OCR stats, or returns null when the weapon or riven type is unknown. */
export function gradeRiven(
  weaponName: string,
  stats: {
    name: string;
    positive: boolean;
    displayPositive?: boolean;
    value: number | null;
    multiplier?: boolean;
  }[],
): RivenGradeResult | null {
  if (!stats || stats.length === 0) return null;

  const baseDisposition = rivenData.getWeaponDisposition(weaponName);
  if (baseDisposition == null) {
    log.warn(`[RivenGrade] Weapon not found: "${weaponName}"`);
    return null;
  }

  const rivenTypeKey = rivenData.resolveRivenType(weaponName);
  if (!rivenTypeKey) {
    log.warn(`[RivenGrade] No riven type for weapon: "${weaponName}"`);
    return null;
  }

  // Count buffs and curses
  const numBuffs = stats.filter((s) => s.positive).length;
  const numCurses = stats.filter((s) => !s.positive).length;
  const assumedLevel = DEFAULT_LVL;

  // Reject impossible shapes before invalid values are clamped into valid grades.
  if (numBuffs > 3 || numCurses > 1) {
    log.warn(
      `[RivenGrade] impossible stat shape (${numBuffs} buffs / ${numCurses} curses) - skipping grade`,
    );
    return null;
  }

  // Resolve tag/entry and the numeric display value once per stat.
  const prepared = stats.map((stat) => {
    const tag = rivenData.statNameToTag(stat.name);
    const entry = tag ? rivenData.findUpgradeEntry(rivenTypeKey, tag) : null;
    let displayedValue: number | null = null;
    if (stat.value != null && Number.isFinite(stat.value)) {
      // x-multiplier format: x1.59 -> (value - 1) * 100 for positive,
      // (1 - value) * 100 for negative
      displayedValue = stat.multiplier
        ? stat.positive
          ? (stat.value - 1) * 100
          : (1 - stat.value) * 100
        : stat.value;
    }
    return { stat, tag, entry, displayedValue };
  });

  type Prepared = (typeof prepared)[number];
  const rawFloatAt = (p: Prepared, disp: number): number =>
    p.stat.positive
      ? unparseBuffRaw(
          p.displayedValue!,
          p.entry!.baseValue,
          disp,
          numBuffs,
          numCurses,
          p.tag!,
          assumedLevel,
        )
      : unparseCurseRaw(
          p.displayedValue!,
          p.entry!.baseValue,
          disp,
          numBuffs,
          numCurses,
          p.tag!,
          assumedLevel,
        );

  // The roll screen names the family but uses the linked variant's disposition.
  // Refit out-of-range values against sibling variants and choose the best match.
  let disposition = baseDisposition;
  const gradeable = prepared.filter((p) => p.tag && p.entry && p.displayedValue != null);
  if (gradeable.length > 0) {
    const violationAt = (disp: number): number =>
      gradeable.reduce((sum, p) => {
        const f = rawFloatAt(p, disp);
        return sum + Math.max(0, f - 1) + Math.max(0, -f);
      }, 0);
    const currentViolation = violationAt(disposition);
    // 0.02 tolerance: display values round to 0.1%, which can nudge a
    // legitimate min/max roll fractionally out of range.
    if (currentViolation > 0.02) {
      let best = { name: weaponName, disposition, violation: currentViolation };
      for (const variant of rivenData.getFamilyVariants(weaponName)) {
        const violation = violationAt(variant.disposition);
        const closer =
          Math.abs(variant.disposition - baseDisposition) <
          Math.abs(best.disposition - baseDisposition);
        if (violation < best.violation - 1e-9 || (violation < best.violation + 1e-9 && closer)) {
          best = { name: variant.name, disposition: variant.disposition, violation };
        }
      }
      if (best.disposition !== disposition) {
        log.info(
          `[RivenGrade] "${weaponName}" dispo misfits the rolled values - grading as "${best.name}"`,
        );
        disposition = best.disposition;
      }
    }
  }

  const gradedStats: GradedStat[] = [];
  let scoreSum = 0;
  let scoredCount = 0;

  for (const p of prepared) {
    const { stat, tag, entry } = p;
    if (!tag || !entry) {
      if (!tag) log.debug(`[RivenGrade] Unknown stat: "${stat.name}" - assigning B grade`);
      else
        log.debug(`[RivenGrade] Tag "${tag}" not in riven type ${rivenTypeKey.split("/").pop()}`);
      gradedStats.push({
        ...stat,
        grade: "B",
        rollFloat: 0.5,
      });
      scoreSum += 0; // lerp(-10, 10, 0.5) = 0
      scoredCount++;
      continue;
    }

    if (p.displayedValue != null) {
      const rollFloat = clamp01(rawFloatAt(p, disposition));
      const grade = floatToGrade(rollFloat, !stat.positive);
      const score = lerp(-10, 10, !stat.positive ? 1 - rollFloat : rollFloat);

      gradedStats.push({
        ...stat,
        grade,
        rollFloat,
      });
      scoreSum += score;
      scoredCount++;
    } else {
      // No value - can't grade, assign mid-range
      gradedStats.push({
        ...stat,
        grade: "?",
        rollFloat: 0.5,
      });
    }
  }

  // Overall grade = average of all stat scores
  let overallGrade = "?";
  if (scoredCount > 0) {
    const avgScore = scoreSum / scoredCount;
    const avgFloat = inverseLerp(-10, 10, avgScore);
    overallGrade = floatToGrade(avgFloat, false);
  }

  // Attribute-based grade (Great/Good/OK/Bad)
  const attributeGrade = computeAttributeGrade(stats, weaponName);

  return { stats: gradedStats, overallGrade, attributeGrade };
}
