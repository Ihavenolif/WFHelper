import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import de from "../../src/i18n/de.json";
import { en } from "../../src/i18n/en";

// The package blocks deep imports through "exports", so read the files directly.
const DICT_DIR = path.resolve(__dirname, "../../node_modules/warframe-public-export-plus");

function officialDict(locale: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(DICT_DIR, `dict.${locale}.json`), "utf8"));
}

type Term = {
  /** The English word as it appears in our own copy. */
  en: string;
  /** The German we use. `stem` covers its inflected forms. */
  de: string;
  stem?: string;
  /** Only for plurals the default pattern cannot reach, such as Bounties. */
  enPattern?: RegExp;
  /** Set when we knowingly differ from Digital Extremes, with the reason. */
  ownChoice?: string;
};

const englishPattern = (term: Term): RegExp =>
  term.enPattern ?? new RegExp(`\\b${term.en}(s|es)?\\b`, "i");

// Digital Extremes ships German for most of these in
// warframe-public-export-plus/dict.de.json. Matching it is the default because
// it is what a German player reads in the game, but it is not binding: set
// ownChoice to overrule it, and the test then holds you to your word instead.
const TERMS: Term[] = [
  { en: "Arbitration", de: "Arbitration", ownChoice: "German players say the English word" },
  { en: "Relic", de: "Relikt" },
  { en: "Orokin Ducats", de: "Orokin Dukaten" },
  { en: "Rifle", de: "Gewehr" },
  { en: "Shotgun", de: "Schrot" },
  { en: "Melee", de: "Nahkampf" },
  { en: "Vitus Essence", de: "Vitus-Essenz" },
  { en: "The Circuit", de: "Der Rundkurs", stem: "Rundkurs" },
  { en: "Riven", de: "Riven" },
  { en: "Kuva", de: "Kuva" },
  { en: "Endo", de: "Endo" },
  { en: "Nightwave", de: "Nightwave" },
  { en: "Railjack", de: "Railjack" },
  { en: "Cetus", de: "Cetus" },
  { en: "Duviri", de: "Duviri" },
];

// Words DE only writes inside longer phrases, so they cannot be pinned against
// the export; the consistency check below is what keeps them honest.
const UNPINNED: Term[] = [
  { en: "Foundry", de: "Schmiede" },
  { en: "Platinum", de: "Platinum" },
  { en: "Ducats", de: "Dukaten" },
  { en: "Fissure", de: "Riss" },
  { en: "Bounty", de: "Auftrag", stem: "Auftr", enPattern: /\bBount(y|ies)\b/i },
  { en: "Invasion", de: "Invasion" },
  { en: "Mastery", de: "Meisterschaft" },
  { en: "Arcane", de: "Arkana", stem: "Arkan" },
  { en: "Veiled", de: "Verschleiert", stem: "erschleiert" },
  { en: "Credits", de: "Credits" },
];

function shippedGerman(term: Term): Set<string> {
  const officialEn = officialDict("en");
  const officialDe = officialDict("de");
  const needle = term.en.toLowerCase();
  const shipped = new Set<string>();
  for (const [key, value] of Object.entries(officialEn)) {
    if (typeof value === "string" && value.trim().toLowerCase() === needle && officialDe[key]) {
      shipped.add(officialDe[key].trim());
    }
  }
  return shipped;
}

describe("german game terminology", () => {
  it("matches the game's own German unless a term says otherwise", () => {
    const wrong: string[] = [];

    for (const term of TERMS) {
      const shipped = shippedGerman(term);
      if (term.ownChoice) {
        if (shipped.has(term.de)) {
          wrong.push(`${term.en}: ownChoice "${term.ownChoice}" is stale, DE now agrees with us`);
        }
      } else if (shipped.size === 0) {
        wrong.push(`${term.en}: gone from the DE export, move it to UNPINNED or re-pin it`);
      } else if (!shipped.has(term.de)) {
        wrong.push(`${term.en}: we use "${term.de}", DE uses ${[...shipped].join(" / ")}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it("uses each term the same way everywhere", () => {
    // Preference-neutral: whatever word a term settles on, every German string
    // whose English mentions that term has to use it. Half-migrated wording is
    // the failure this catches, not disagreement with Digital Extremes.
    const inconsistent: string[] = [];

    for (const term of [...TERMS, ...UNPINNED]) {
      const mentions = englishPattern(term);
      const stem = (term.stem ?? term.de).toLowerCase();
      for (const [key, value] of Object.entries(en)) {
        const german = de[key as keyof typeof de];
        if (german === undefined || !mentions.test(value)) continue;
        if (!german.toLowerCase().includes(stem)) {
          inconsistent.push(`${key}: English says ${term.en}, German drops "${term.de}"`);
        }
      }
    }

    expect(inconsistent).toEqual([]);
  });
});
