import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import runtimeAssets from "./runtime-assets.cjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredAssets = runtimeAssets.onnxAssets.map((name) => `resources/${name}`);

const missing = requiredAssets.filter((relativePath) => !existsSync(path.join(root, relativePath)));

if (missing.length > 0) {
  console.error("Missing required Riven OCR runtime asset files:");
  for (const relativePath of missing) {
    console.error(`- ${relativePath}`);
  }
  console.error(
    "Release packaging is blocked so the installer cannot ship with unavailable Riven OCR.",
  );
  process.exit(1);
}

console.log("Riven OCR runtime resource files verified.");
