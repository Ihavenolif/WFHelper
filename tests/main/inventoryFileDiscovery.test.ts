import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir = "";

const chokidarMock = vi.hoisted(() => {
  const callbacks = new Map<string, () => void>();
  const watcher = {
    close: vi.fn(),
    on: vi.fn(),
  };
  watcher.on.mockImplementation((event: string, callback: () => void) => {
    callbacks.set(event, callback);
    return watcher;
  });
  return {
    callbacks,
    watch: vi.fn(() => watcher),
    watcher,
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(tmpDir, name),
    isPackaged: true,
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  },
  ipcMain: { handle: vi.fn() },
}));

vi.mock("chokidar", () => ({
  default: { watch: chokidarMock.watch },
}));

const HOUR = 60 * 60 * 1000;

function writeInventoryFile(filePath: string, mtimeMs: number): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "{}");
  fs.utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
  return filePath;
}

function writeValidInventory(filePath: string, marker: string, mtimeMs: number): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ Suits: [], marker }));
  fs.utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
  return filePath;
}

function writeState(inventoryPath: string): void {
  fs.writeFileSync(
    path.join(tmpDir, "userData", "inventory-reload-state.json"),
    JSON.stringify({ hash: "x", reloadAt: 0, inventoryPath }),
  );
}

async function loadModule(): Promise<typeof import("../../ipc/inventoryIpc")> {
  vi.resetModules();
  return import("../../ipc/inventoryIpc");
}

describe("findInventoryFile", () => {
  beforeEach(() => {
    chokidarMock.callbacks.clear();
    chokidarMock.watch.mockClear();
    chokidarMock.watcher.close.mockClear();
    chokidarMock.watcher.on.mockClear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-inv-"));
    for (const dir of ["userData", "downloads", "desktop", "documents", "home"]) {
      fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prefers a fresher manual import over a stale helper snapshot", async () => {
    const now = Date.now();
    writeInventoryFile(path.join(tmpDir, "userData", "api-helper", "inventory.json"), now - 24 * HOUR);
    const manual = writeInventoryFile(path.join(tmpDir, "downloads", "inventory_manual.json"), now);
    writeState(manual);

    const { findInventoryFile } = await loadModule();
    expect(findInventoryFile()).toBe(manual);
  });

  it("prefers a fresher helper snapshot over an older import", async () => {
    const now = Date.now();
    const helper = writeInventoryFile(path.join(tmpDir, "userData", "api-helper", "inventory.json"), now);
    const manual = writeInventoryFile(path.join(tmpDir, "downloads", "inventory_manual.json"), now - 24 * HOUR);
    writeState(manual);

    const { findInventoryFile } = await loadModule();
    expect(findInventoryFile()).toBe(helper);
  });

  it("uses the imported path when the helper dir is empty", async () => {
    const manual = writeInventoryFile(path.join(tmpDir, "documents", "inventory_backup.json"), Date.now());
    writeState(manual);

    const { findInventoryFile } = await loadModule();
    expect(findInventoryFile()).toBe(manual);
  });

  it("falls back to user folders when the remembered file is gone", async () => {
    writeState(path.join(tmpDir, "documents", "deleted.json"));
    const downloads = writeInventoryFile(path.join(tmpDir, "downloads", "inventory.json"), Date.now());

    const { findInventoryFile } = await loadModule();
    expect(findInventoryFile()).toBe(downloads);
  });

  it("accepts changed helper contents immediately after the startup read", async () => {
    const now = Date.now();
    const helper = writeValidInventory(
      path.join(tmpDir, "userData", "api-helper", "inventory.json"),
      "startup",
      now - 60_000,
    );
    const inventoryIpc = await loadModule();
    const listener = vi.fn();
    inventoryIpc.addInventoryListener(listener);

    expect(inventoryIpc.readInventory(helper)).toMatchObject({ marker: "startup" });
    inventoryIpc.watchInventoryFile(helper);

    writeValidInventory(helper, "fresh", now);
    chokidarMock.callbacks.get("change")?.();

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ marker: "fresh" }));
    expect(inventoryIpc.getLoadedInventoryModifiedAt()).toBeCloseTo(now, -2);
  });

  it("keeps the loaded timestamp when a replacement payload is invalid", async () => {
    const now = Date.now();
    const startupMtime = now - 60_000;
    const helper = writeValidInventory(
      path.join(tmpDir, "userData", "api-helper", "inventory.json"),
      "startup",
      startupMtime,
    );
    const inventoryIpc = await loadModule();

    inventoryIpc.readInventory(helper);
    inventoryIpc.watchInventoryFile(helper);
    fs.writeFileSync(helper, "{invalid");
    fs.utimesSync(helper, now / 1000, now / 1000);
    chokidarMock.callbacks.get("change")?.();

    expect(inventoryIpc.getLoadedInventoryModifiedAt()).toBeCloseTo(startupMtime, -2);
  });

  it("deduplicates identical rewrites while advancing their accepted timestamp", async () => {
    const now = Date.now();
    const helper = writeValidInventory(
      path.join(tmpDir, "userData", "api-helper", "inventory.json"),
      "same",
      now - 60_000,
    );
    const inventoryIpc = await loadModule();
    const listener = vi.fn();
    inventoryIpc.addInventoryListener(listener);

    inventoryIpc.readInventory(helper);
    inventoryIpc.watchInventoryFile(helper);
    writeValidInventory(helper, "same", now);
    chokidarMock.callbacks.get("change")?.();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(inventoryIpc.getLoadedInventoryModifiedAt()).toBeCloseTo(now, -2);
  });
});
