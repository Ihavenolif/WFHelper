// Builds src/data/itemNames/<locale>.json from the DE export tables the app
// already reads. Shipping the package's own 4-6MB dict.<lang>.json is out of
// the question, so keep only the display-name keys those tables reference.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const pepDir = path.join(repoRoot, "node_modules", "warframe-public-export-plus");
const outDir = path.join(repoRoot, "src", "data", "itemNames");

// The export tables the app resolves display names from. ExportRecipes and
// ExportRewards are left out on purpose: they hold no /Lotus/Language values,
// their names come from the resultType they point at. ExportCustoms and
// ExportFlavour stay out too, cosmetics alone cost another 7.8MB.
const SOURCES = [
  "ExportUpgrades",
  "ExportArcanes",
  "ExportWarframes",
  "ExportSentinels",
  "ExportWeapons",
  "ExportRailjackWeapons",
  "ExportResources",
  "ExportRelics",
  "ExportKeys",
  "ExportGear",
  "ExportDrones",
  "ExportFusionBundles",
  "ExportRegions",
  "ExportMissionTypes",
];

const LANGUAGE_PREFIX = "/Lotus/Language/";

// Names only. Descriptions are 4x the bytes for text no list or search shows,
// and riven names are assembled from locTag plus prefixTag plus suffixTag.
const NAME_FIELDS = new Set([
  "name",
  "systemName",
  "missionName",
  "stateName",
  "locTag",
  "prefixTag",
  "suffixTag",
  "title",
  "tag",
]);

function readPep(file) {
  const full = path.join(pepDir, file);
  if (!fs.existsSync(full)) throw new Error(`${file} is missing from ${pepDir}`);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

// Arcane tags sit inside upgradeEntries arrays and missions inside regions, so
// the walk stays recursive and carries the owning field across array hops.
function collectNameKeys(node, field, into) {
  if (typeof node === "string") {
    if (NAME_FIELDS.has(field) && node.startsWith(LANGUAGE_PREFIX)) into.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectNameKeys(item, field, into);
    return;
  }
  if (node && typeof node === "object") {
    for (const [name, value] of Object.entries(node)) collectNameKeys(value, name, into);
  }
}

const keys = new Set();
for (const source of SOURCES) {
  const before = keys.size;
  collectNameKeys(readPep(`${source}.json`), "", keys);
  console.log(`${source}: ${keys.size - before} new name keys`);
}
if (keys.size === 0) throw new Error("no name keys harvested, refusing to overwrite");

// Plain code-unit sort, not localeCompare: the output has to be byte-stable
// whatever locale the build machine runs in.
const sortedKeys = [...keys].sort();

const locales = fs
  .readdirSync(pepDir)
  .map((file) => /^dict\.([a-z]+)\.json$/.exec(file))
  .filter(Boolean)
  .map((match) => match[1])
  .sort();
if (!locales.includes("en")) throw new Error(`no dict.en.json in ${pepDir}`);

const english = readPep("dict.en.json");
fs.mkdirSync(outDir, { recursive: true });

let totalBytes = 0;
for (const locale of locales) {
  const dict = locale === "en" ? english : readPep(`dict.${locale}.json`);
  const names = {};
  for (const key of sortedKeys) {
    const value = dict[key];
    if (typeof value !== "string") continue;
    // The app already falls back to English, so a copy of it is pure weight.
    if (locale !== "en" && value === english[key]) continue;
    names[key] = value;
  }
  // Two-space JSON so `pnpm run format` leaves the generated files alone.
  const body = `${JSON.stringify(names, null, 2)}\n`;
  fs.writeFileSync(path.join(outDir, `${locale}.json`), body);
  const bytes = Buffer.byteLength(body, "utf8");
  totalBytes += bytes;
  console.log(
    `${locale}: ${Object.keys(names).length} keys, ${(bytes / 1024).toFixed(1)} KB -> ` +
      path.relative(repoRoot, path.join(outDir, `${locale}.json`)).replace(/\\/g, "/"),
  );
}

console.log(
  `${sortedKeys.length} harvested name keys across ${locales.length} locales, ` +
    `${(totalBytes / 1024 / 1024).toFixed(2)} MB total`,
);
