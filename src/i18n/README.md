# Translations

`en.json` is the source of truth. Every other file is a translation of it and may
be partial: a missing key falls back to the English text at lookup time, so a
half-finished locale still ships a working UI.

## Adding a language

1. Copy `en.json` to `<code>.json` (an ISO 639-1 code, e.g. `zh` or `fr`) and
   translate the values. Never change a key.
2. In `src/lib/i18n.ts`, add the code to `LocaleCode`, add an entry to
   `LOCALE_OPTIONS` with the language's own name (`Deutsch`, not `German`), and
   add one line to `LOADERS`.
3. In `ipc/overlayI18n.ts`, add the same file to `DICTIONARIES` so the in-game
   overlays follow the language too. They are plain HTML windows with no store
   access, so the main process resolves their text and pushes it to them.

That is the whole change. Each locale is bundled as its own chunk and only the
active one is ever loaded, so adding a language does not grow the app for
everyone else.

## House rules

- **Placeholders keep their names.** `{count}`, `{item}` and friends are filled
  in by the app; you may reorder them in the sentence, but not rename or drop
  them. A test enforces this.
- **`common.whisperBuy` / `common.whisperSell` stay English.** They are pasted
  into warframe.market trade chat and read by other players.
- **Leave a key out rather than copying the English.** Proper nouns and trade
  shorthand (`WTB R0`, relic tiers, riven grade letters) are already exempt.
- **Capitalisation belongs to CSS.** Write labels in normal sentence or title
  case; the UI uppercases what it needs to.
- **`...` not `…`** — plain ASCII dots.

## Warframe vocabulary

Digital Extremes ships its own translations for game terms. The dependency
`warframe-public-export-plus` contains `dict.<lang>.json` for de, en, es, fr, it,
ja, ko, pl, pt, ru, tc, th, tr, uk and zh, keyed by `/Lotus/Language/...` paths.
Joining `dict.en.json` to your language on the key gives the word the game itself
uses, which is what players expect to read.

Matching it is the default, not a rule. `tests/main/i18nGameTerms.test.ts` holds
a table of terms; set `ownChoice` on a row to deliberately use a different word,
and the test then checks you use _that_ word consistently instead.
