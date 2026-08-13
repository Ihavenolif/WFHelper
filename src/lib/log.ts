// Development logs to the console. Production forwards warnings and errors to
// the main-process file logger and suppresses lower levels.

const isDev = import.meta.env.MODE === "development";

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function sendToMain(message: string, ...args: unknown[]): void {
  try {
    (window as { api?: { logWarn?: (m: string, ...a: unknown[]) => void } }).api?.logWarn?.(
      message,
      ...args,
    );
  } catch {
    // non-fatal - if IPC isn't ready, skip silently
  }
}

export const log = {
  info(message: string, ...args: unknown[]): void {
    if (isDev) {
      console.log(`[${timestamp()}] ${message}`, ...args);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (isDev) {
      console.warn(`[${timestamp()}] ${message}`, ...args);
    } else {
      sendToMain(message, ...args);
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (isDev) {
      console.error(`[${timestamp()}] ${message}`, ...args);
    } else {
      sendToMain(message, ...args);
    }
  },
} as const;
