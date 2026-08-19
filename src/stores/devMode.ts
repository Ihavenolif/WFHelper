import { readable, writable } from "svelte/store";

import { invoke } from "../lib/ipc.js";

/** True on unpackaged builds; gates diagnostic-only UI (dev rail, icon audits). */
let devModeActive = import.meta.env.DEV;

export const devMode = readable(devModeActive, (set) => {
  invoke("getAppRuntimeInfo")
    .then((info) => {
      devModeActive = !info.isPackaged;
      set(devModeActive);
    })
    .catch(() => set(devModeActive));
});

/** Item names whose image degraded to a fallback or placeholder (dev icon audit). */
export const degradedIcons = writable<ReadonlySet<string>>(new Set());

export function reportDegradedIcon(name: string): void {
  if (!devModeActive) return;
  degradedIcons.update((set) => (set.has(name) ? set : new Set(set).add(name)));
}
