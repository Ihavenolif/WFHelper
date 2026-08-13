/** Shared error-message normalizer (main, IPC, renderer, worker). */

/** Accepts duck-typed errors because IPC and Worker errors may cross realms. */
export function normalizeErrorMessage(err: unknown, fallback: string = "Unknown error"): string {
  if (
    err &&
    typeof err === "object" &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    const message = (err as { message: string }).message.trim();
    if (message) return message;
  }
  if (typeof err === "string" && err.trim()) {
    return err.trim();
  }
  return fallback;
}
