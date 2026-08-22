import { get, writable } from "svelte/store";
import type { AppUpdateState } from "../types/ipc.js";
import { tr } from "../lib/i18n.js";
import { addToast } from "./toasts.js";

const DEFAULT_APP_UPDATE_STATE: AppUpdateState = {
  status: "idle",
  timestamp: Date.now(),
};

export const appUpdateState = writable<AppUpdateState>(DEFAULT_APP_UPDATE_STATE);

let lastNotifiedUpdateStatus = "";

/** Apply update state, toast when the status actually changed. */
export function applyUpdateState(state: AppUpdateState, showToast: boolean): void {
  appUpdateState.set(state);
  if (!showToast || state.status === lastNotifiedUpdateStatus) return;
  lastNotifiedUpdateStatus = state.status;

  // available/downloaded need no toast - the status-bar pill shows both states.
  if (state.status === "error") {
    // A toast is a snapshot, so resolving the language once at fire time is fine.
    const t = get(tr);
    addToast({
      level: "error",
      title: t("update.errorTitle"),
      message: state.message || t("update.checkFailed"),
    });
  }
}
