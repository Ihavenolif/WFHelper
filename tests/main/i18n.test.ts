import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import de from "../../src/i18n/de.json";
import { en } from "../../src/i18n/en";

const SRC = path.resolve(__dirname, "../../src");

// warframe.market whispers are sent to other players, so they must stay English.
const ENGLISH_ONLY = ["common.whisperBuy", "common.whisperSell"];

// Trade shorthand, grade letters and relic tier names read the same everywhere,
// so de.json leaves them out and the English fallback serves them.
const LANGUAGE_NEUTRAL = /^(appearance\.label\.grade|inventory\.wt[bs]|relics\.tier\.)/;

// Same text today, but each names a distinct UI role and must stay free to diverge.
const ALLOWED_TWINS = new Set(["setup.step.finish"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "i18n") sourceFiles(full, out);
    } else if (/\.(ts|svelte)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// {plat} vs {platinum} hid two copies of one sentence, so names are erased first.
const normalise = (value: string): string => value.trim().replace(/\{\w+\}/g, "{}");

const placeholders = (value: string): string[] =>
  [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

describe("i18n dictionaries", () => {
  it("keeps German placeholders identical to English", () => {
    const mismatched = Object.entries(de)
      .filter(([key, value]) => {
        const source = en[key as keyof typeof en];
        return source !== undefined && placeholders(source).join() !== placeholders(value).join();
      })
      .map(([key]) => key);

    expect(mismatched).toEqual([]);
  });

  it("has no German entry for strings sent to other players", () => {
    for (const key of ENGLISH_ONLY) {
      expect(en).toHaveProperty(key);
      expect(de).not.toHaveProperty(key);
    }
  });

  it("has no translated key English does not define", () => {
    // A JSON catalogue cannot be typechecked against MessageKey the way the old
    // .ts one was, so a typo in a German key would otherwise go unnoticed.
    const unknown = Object.keys(de).filter((key) => !(key in en));

    expect(unknown).toEqual([]);
  });

  it("translates every key German is expected to carry", () => {
    const untranslated = Object.keys(en).filter(
      (key) => !(key in de) && !ENGLISH_ONLY.includes(key) && !LANGUAGE_NEUTRAL.test(key),
    );

    expect(untranslated).toEqual([]);
  });

  it("spells ellipses as three ASCII dots", () => {
    const unicode = [...Object.entries(en), ...Object.entries(de)]
      .filter(([, value]) => value.includes("…"))
      .map(([key]) => key);

    expect(unicode).toEqual([]);
  });

  it("has no duplicate values outside the shared namespace", () => {
    // Two keys collide only when both languages agree; a case or wording split
    // that German distinguishes (Kauf vs Kaufen) is a real difference.
    const byValue = new Map<string, string[]>();
    for (const [key, value] of Object.entries(en)) {
      if (ENGLISH_ONLY.includes(key) || ALLOWED_TWINS.has(key)) continue;
      const pair = normalise(value) + "\u0000" + normalise(de[key as keyof typeof de] ?? "");
      byValue.set(pair, [...(byValue.get(pair) ?? []), key]);
    }
    const duplicated = [...byValue.values()]
      .filter((keys) => keys.length > 1)
      .map((keys) => keys.join(" = "));

    expect(duplicated).toEqual([]);
  });

  it("is fully referenced by the app", () => {
    const blob = sourceFiles(SRC)
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    const unused = Object.keys(en).filter((key) => {
      if (blob.includes(`"${key}"`) || blob.includes(`'${key}'`)) return false;
      // Keys built as `prefix.${value}` only ever appear as their prefix.
      const prefix = key.slice(0, key.lastIndexOf(".") + 1);
      return !blob.includes(`\`${prefix}\${`);
    });

    expect(unused).toEqual([]);
  });
});
