import { derived, writable, type Readable } from "svelte/store";
import { locale } from "./i18n.js";
import { send } from "./ipc.js";
import { GAME_LOCALE_UPDATED } from "../../config/shared/ipcChannels.js";

// DE publishes an item name dictionary per client language, so game names need no
// human translation. Kept separate from the UI language because traders read and
// type English item names no matter what language the rest of the app is in.
type GameLanguageCode =
  | "en"
  | "de"
  | "es"
  | "fr"
  | "it"
  | "ja"
  | "ko"
  | "pl"
  | "pt"
  | "ru"
  | "tc"
  | "th"
  | "tr"
  | "uk"
  | "zh";

/** "auto" tracks the display language and falls back to English when unbundled. */
export type GameLanguageChoice = "auto" | GameLanguageCode;

export const GAME_LANGUAGE_OPTIONS: ReadonlyArray<{ code: GameLanguageCode; label: string }> = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "pl", label: "Polski" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "tc", label: "繁體中文" },
  { code: "th", label: "ไทย" },
  { code: "tr", label: "Türkçe" },
  { code: "uk", label: "Українська" },
  { code: "zh", label: "简体中文" },
];

const STORAGE_KEY = "game-language";

function isGameLanguageCode(value: string | null): value is GameLanguageCode {
  return value != null && GAME_LANGUAGE_OPTIONS.some((option) => option.code === value);
}

function readStoredChoice(): GameLanguageChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "auto" || isGameLanguageCode(stored)) return stored;
  } catch {
    // no localStorage (tests, hardened webview)
  }
  return "auto";
}

const choiceStore = writable<GameLanguageChoice>(readStoredChoice());

/** Read-only so setGameLanguage stays the only writer that persists. */
export const gameLanguage: Readable<GameLanguageChoice> = { subscribe: choiceStore.subscribe };

const effectiveGameLanguage: Readable<GameLanguageCode> = derived(
  [choiceStore, locale],
  ([$choice, $locale]) => {
    if ($choice !== "auto") return $choice;
    return isGameLanguageCode($locale) ? $locale : "en";
  },
);

export function setGameLanguage(choice: GameLanguageChoice): void {
  choiceStore.set(choice);
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // no localStorage (tests, hardened webview)
  }
}

// Main owns the name tables, so it only ever needs the resolved code. It replies
// with item-db-updated, which is what actually repaints the names.
effectiveGameLanguage.subscribe((code) => {
  if (typeof window === "undefined") return;
  if (typeof window.api?.updateGameLocale !== "function") return;
  send(GAME_LOCALE_UPDATED, code);
});
