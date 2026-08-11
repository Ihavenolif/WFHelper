import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { mainWindow } from "./mainWindow";

interface ElectronTestHarnessOptions {
  storage?: Record<string, string>;
  inventory?: unknown;
  onPage?: (page: Page) => void | Promise<void>;
}

export interface ElectronTestHarness {
  app: ElectronApplication;
  page: Page;
  sandboxDir: string;
  helperDir: string;
}

export async function launchElectronTestHarness(
  prefix: string,
  options: ElectronTestHarnessOptions = {},
): Promise<ElectronTestHarness> {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const localAppData = path.join(sandboxDir, "local");
  const userData = path.join(sandboxDir, "user-data");
  const helperDir = path.join(userData, "api-helper");
  fs.mkdirSync(localAppData, { recursive: true });
  fs.mkdirSync(helperDir, { recursive: true });
  fs.writeFileSync(
    path.join(helperDir, "inventory.json"),
    JSON.stringify(options.inventory ?? { Suits: [] }),
  );

  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.WFHELPER_DISABLE_KEYBOARD_HOOK = "1";
  env.LOCALAPPDATA = localAppData;
  env.WFHELPER_USER_DATA = userData;

  const app = await electron.launch({ args: ["--no-sandbox", "."], env });
  const page = await mainWindow(app);
  await options.onPage?.(page);
  await expect(page.locator("#app")).toBeVisible({ timeout: 90_000 });
  await page.evaluate(
    (storage) => {
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
    },
    {
      "setup-completed-v2": "1",
      "feature-tour-done": "1",
      ...options.storage,
    },
  );
  await page.reload();
  await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });

  return { app, page, sandboxDir, helperDir };
}

export function writeHarnessInventory(harness: ElectronTestHarness, inventory: unknown): void {
  fs.writeFileSync(path.join(harness.helperDir, "inventory.json"), JSON.stringify(inventory));
}

export async function closeElectronTestHarness(
  harness: ElectronTestHarness | undefined,
): Promise<void> {
  if (!harness) return;
  try {
    await harness.app.close();
  } finally {
    fs.rmSync(harness.sandboxDir, { recursive: true, force: true });
  }
}
