/** Riven formula constants shared by grading and fingerprints. */

export const NUM_BUFFS_ATTEN = [0, 1, 0.66000003, 0.5, 0.40000001, 0.34999999];

/** Curse-specific attenuation indexed by number of buffs (NOT curses). */
export const NUM_BUFFS_CURSE_ATTEN = [0, 1, 0.33000001, 0.5, 1.25, 1.5];

export const SPECIFIC_FIT_ATTEN = 1.5;
export const BASE_DRAIN = 10;

/** Stats displayed as multipliers or fixed precision instead of percentages. */
export const NON_PERCENTAGE_TAGS = new Set([
  "WeaponFactionDamageGrineer",
  "WeaponFactionDamageCorpus",
  "WeaponFactionDamageInfested",
  "WeaponMeleeFactionDamageGrineer",
  "WeaponMeleeFactionDamageCorpus",
  "WeaponMeleeFactionDamageInfested",
  "WeaponMeleeComboInitialBonusMod",
  "ComboDurationMod",
  "WeaponMeleeRangeIncMod",
  // Metres, like melee range - the card reads "+3.7 Punch Through", no percent.
  "WeaponPunctureDepthMod",
]);
