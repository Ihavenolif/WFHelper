import { normalizeErrorMessage } from "../config/shared/errors";
import { normalizeWfmHoldMinutes, wfmStatusCanExpire, type WfmStatus } from "../config/shared/wfm";
import { withScope } from "./logger";
import * as wfmSession from "./wfmSession";

const log = withScope("wfmPresence");

export interface WfmPresenceState {
  status: WfmStatus | null;
  /** Epoch ms the current status drops to invisible; null while it is held indefinitely. */
  expiresAt: number | null;
  /** True while the status is driven by Warframe running rather than by the user. */
  autoActive: boolean;
}

let _status: WfmStatus | null = null;
let _expiresAt: number | null = null;
let _holdTimer: ReturnType<typeof setTimeout> | null = null;
let _autoEnabled = false;
let _holdMinutes = 0;
let _gameOpen = false;
let _autoActive = false;
// Status to put back when the game closes; null when we never captured one.
let _preAutoStatus: WfmStatus | null = null;
let _onChange: ((state: WfmPresenceState) => void) | null = null;

export function getState(): WfmPresenceState {
  return { status: _status, expiresAt: _expiresAt, autoActive: _autoActive };
}

function _emit(): void {
  try {
    _onChange?.(getState());
  } catch (err) {
    log.warn("[WFMPresence] onChange callback threw:", normalizeErrorMessage(err));
  }
}

function _clearHold(): void {
  if (_holdTimer) clearTimeout(_holdTimer);
  _holdTimer = null;
  _expiresAt = null;
}

/** WFM expires the status itself; this only mirrors the deadline locally so the
 * countdown and the buttons settle without waiting for the next server push. */
function _trackDeadline(statusUntil: string | null): void {
  if (_holdTimer) clearTimeout(_holdTimer);
  _holdTimer = null;
  const deadline = statusUntil ? Date.parse(statusUntil) : NaN;
  if (!Number.isFinite(deadline)) {
    _expiresAt = null;
    return;
  }

  _expiresAt = deadline;
  _holdTimer = setTimeout(
    () => {
      _holdTimer = null;
      _expiresAt = null;
      _status = "invisible";
      log.info("[WFMPresence] Hold elapsed - WFM dropped the status");
      _emit();
    },
    Math.max(0, deadline - Date.now()),
  );
  const timerRef = _holdTimer as { unref?: () => void };
  if (typeof timerRef.unref === "function") timerRef.unref();
}

/** Seconds of hold to ask WFM for. Auto-driven presence is bounded by the game
 * running instead, so it goes up without an expiry. */
function _durationFor(status: WfmStatus, auto: boolean): number | null {
  if (auto || !_holdMinutes || !wfmStatusCanExpire(status)) return null;
  return _holdMinutes * 60;
}

/** Send a status to WFM and record it as the one we want the account to hold. */
async function _push(status: WfmStatus, auto = false): Promise<boolean> {
  if (!wfmSession.getToken()) return false;
  try {
    const result = await wfmSession.setStatus(status, _durationFor(status, auto));
    _status = status;
    _trackDeadline(result.statusUntil);
    _emit();
    return true;
  } catch (err) {
    log.warn(`[WFMPresence] Failed to set status ${status}:`, normalizeErrorMessage(err));
    return false;
  }
}

export function configure(handlers: { onChange?: (state: WfmPresenceState) => void }): void {
  _onChange = handlers.onChange ?? null;
}

/** Push the persisted settings in; called on boot and on every settings save. */
export function setOptions(options: { autoIngameEnabled: boolean; holdMinutes: unknown }): void {
  const holdMinutes = normalizeWfmHoldMinutes(options.holdMinutes);
  const holdChanged = holdMinutes !== _holdMinutes;
  const autoChanged = options.autoIngameEnabled !== _autoEnabled;
  _holdMinutes = holdMinutes;
  _autoEnabled = options.autoIngameEnabled;

  // A new duration only takes effect by re-sending the status, same as the site.
  if (holdChanged && _status && wfmStatusCanExpire(_status) && !_autoActive) {
    void _push(_status);
  }
  // Toggling mid-session must catch an already-running game, and turning it off
  // must not strand the account on "ingame".
  if (autoChanged) void syncGameRunning(_gameOpen);
  if (holdChanged || autoChanged) _emit();
}

/** Re-evaluate the auto rule against the last known game state (e.g. after sign-in). */
export function resync(): void {
  void syncGameRunning(_gameOpen);
}

/** Seed the current status from WFM so the UI reflects reality after a restart.
 * The deadline arrives separately, on the socket's status push. */
export async function refreshFromServer(): Promise<void> {
  const status = await wfmSession.getPublicStatus();
  if (!status || _status) return;
  _status = status;
  _emit();
}

/** WFM announced our status - on sign-in, or after a change made elsewhere.
 * This is the authoritative source for the expiry WFM is counting down. */
export function applyServerStatus(payload: unknown): void {
  const record = (payload ?? {}) as { status?: unknown; statusUntil?: unknown };
  const status = String(record.status ?? "").toLowerCase();
  if (status !== "online" && status !== "ingame" && status !== "invisible") return;

  _status = status;
  _trackDeadline(typeof record.statusUntil === "string" ? record.statusUntil : null);
  _emit();
}

/** User picked a status: it wins over the auto rule until the game state changes. */
export async function setManualStatus(status: WfmStatus): Promise<void> {
  _autoActive = false;
  _preAutoStatus = null;
  const applied = await _push(status);
  if (!applied) throw new Error("Not logged in to Warframe.market.");
}

/** Warframe started or stopped. Edge-triggered by the main-process status poll. */
export async function syncGameRunning(isOpen: boolean): Promise<void> {
  _gameOpen = isOpen;
  if (!wfmSession.getToken()) return;

  if (isOpen && _autoEnabled && !_autoActive) {
    // An "ingame" here is a stale echo of a previous run's push, not a restore target.
    _preAutoStatus = _status === "ingame" ? null : _status;
    _autoActive = true;
    log.info("[WFMPresence] Warframe running - setting status to ingame");
    if (!(await _push("ingame", true))) _autoActive = false;
    return;
  }

  if ((!isOpen || !_autoEnabled) && _autoActive) {
    _autoActive = false;
    // Unknown prior status stays hidden rather than guessing someone visible.
    const restore = _preAutoStatus ?? "invisible";
    _preAutoStatus = null;
    log.info(`[WFMPresence] Auto status ended - restoring status to ${restore}`);
    await _push(restore);
  }
}

export function reset(): void {
  _clearHold();
  _status = null;
  _autoActive = false;
  _preAutoStatus = null;
  _emit();
}
