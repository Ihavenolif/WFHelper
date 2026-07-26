import type { ElectronApplication, Page } from "@playwright/test";

const MAIN_RENDERER_URL = "renderer/dist/index.html";

/** Pick the app's own window out of every open window, by URL. */
export function findMainWindow<T extends { url: () => string }>(app: {
  windows: () => T[];
}): T | null {
  return app.windows().find((win) => win.url().includes(MAIN_RENDERER_URL)) ?? null;
}

/**
 * firstWindow() is a race: the planner overlay pre-warms 4s after launch, so on a
 * cold runner it can attach first and every #app assertion then fails.
 */
export async function mainWindow(app: ElectronApplication, timeoutMs = 60_000): Promise<Page> {
  await app.firstWindow();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = findMainWindow(app);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("main renderer window never attached");
}
