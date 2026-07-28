import { normalizeForSlug } from "./textNormalize";

/**
 * Shared Warframe Market constants and helpers (headers, asset URLs, slug
 * normalization) used by main-process, renderer, and the worker.
 */

/** Warframe.market user presence status. */
export type WfmStatus = "online" | "ingame" | "invisible";

/**
 * Standard request headers for the warframe.market v1 API.
 *
 * Individual callers may spread these and add extras (e.g. `User-Agent`).
 */
export const WFM_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  Platform: "pc",
  Language: "en",
  Crossplay: "true",
  Accept: "application/json",
});

/** Base URL for warframe.market static assets (icons, thumbnails). */
const WFM_ASSET_BASE = "https://warframe.market/static/assets/";

// Env access must survive the renderer bundle, where node globals don't exist.
function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

const ICON_MIRROR_BASE = readEnv("WFHELPER_ICON_MIRROR_URL") || "https://assets.wfhelper.com";

/**
 * Mirror key for a WFM thumb URL: the asset path with content-hash segments
 * stripped, so the key survives WFM re-exports and the mirror updates in
 * place. Returns null for non-thumb assets (icons, avatars stay upstream).
 */
export function wfmThumbMirrorPath(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const assetPath = pathname.replace(/^\/static\/assets\//, "");
  if (assetPath === pathname || !/(?:^|\/)thumbs\//.test(assetPath)) return null;

  const segments = assetPath.split("/");
  const filename = segments.pop() || "";
  const kept = filename.split(".").filter((part) => !/^[0-9a-f]{32}$/i.test(part));
  return `wfm/${[...segments, kept.join(".")].join("/")}`;
}

/** Normalize a WFM asset path to an absolute URL, thumbs via the WFHelper mirror. */
export function formatWfmAssetUrl(path: unknown): string | null {
  if (typeof path !== "string" || !path.trim()) return null;
  const trimmed = path.trim();
  const absolute = /^https?:\/\//i.test(trimmed) ? trimmed : `${WFM_ASSET_BASE}${trimmed}`;
  if (!absolute.startsWith(WFM_ASSET_BASE)) return absolute;
  if (readEnv("WFHELPER_ICON_MIRROR_DISABLED") === "1") {
    return absolute;
  }
  // WFM gates /static/assets behind a Cloudflare challenge, which blocks
  // renderer <img> loads outright - serve thumbs from our own mirror.
  const mirrorPath = wfmThumbMirrorPath(absolute);
  return mirrorPath ? `${ICON_MIRROR_BASE}/${mirrorPath}` : absolute;
}

export function titleFromSlug(slug: string): string {
  return String(slug)
    .replace(/_/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

// Slug normalizer for WFM URLs - see normalizeForSlug for the semantics.
export { normalizeForSlug as normalizeWfmSlug } from "./textNormalize";

export function normalizeWfmSlugKey(value: unknown): string {
  return normalizeForSlug(typeof value === "string" ? value : null) ?? "";
}
