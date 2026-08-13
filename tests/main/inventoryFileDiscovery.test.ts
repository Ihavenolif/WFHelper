import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir = "";

const chokidarMock = vi.hoisted(() => {
  const callbacks = new Map<string, (...args: unknown[]) => void>();
  const watcher = {
    close: vi.fn(),
    on: vi.fn(),
  };
  watcher.on.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
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

function writeState(inventoryPath: string, inventorySource = "json"): void {
  fs.writeFileSync(
    path.join(tmpDir, "userData", "inventory-reload-state.json"),
    JSON.stringify({ hash: "x", inventoryPath, inventorySource }),
  );
}

function writeAlecaInventory(filePath: string, inventory: unknown): void {
  const key = Buffer.from([76, 69, 79, 45, 65, 76, 69, 67, 9, 69, 79, 45, 65, 76, 69, 67]);
  const iv = Buffer.from([49, 50, 70, 71, 66, 51, 54, 45, 76, 69, 51, 45, 113, 61, 57, 0]);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    Buffer.concat([
      cipher.update(JSON.stringify({ InventoryJson: JSON.stringify(inventory) }), "utf8"),
      cipher.final(),
    ]),
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
    writeInventoryFile(
      path.join(tmpDir, "userData", "api-helper", "inventory.json"),
      now - 24 * HOUR,
    );
    const manual = writeInventoryFile(path.join(tmpDir, "downloads", "inventory_manual.json"), now);
    writeState(manual);

    const { findInventoryFile } = await loadModule();
    expect(findInventoryFile()).toBe(manual);
  });

  it("prefers a fresher helper snapshot over an older import", async () => {
    const now = Date.now();
    const helper = writeInventoryFile(
      path.join(tmpDir, "userData", "api-helper", "inventory.json"),
      now,
    );
    const manual = writeInventoryFile(
      path.join(tmpDir, "downloads", "inventory_manual.json"),
      now - 24 * HOUR,
    );
    writeState(manual);

    const { findInventoryFile } = await loadModule();
    expect(findInventoryFile()).toBe(helper);
  });

  it("uses the imported path when the helper dir is empty", async () => {
    const manual = writeInventoryFile(
      path.join(tmpDir, "documents", "inventory_backup.json"),
      Date.now(),
    );
    writeState(manual);

    const { findInventoryFile } = await loadModule();
    expect(findInventoryFile()).toBe(manual);
  });

  it("falls back to user folders when the remembered file is gone", async () => {
    writeState(path.join(tmpDir, "documents", "deleted.json"));
    const downloads = writeInventoryFile(
      path.join(tmpDir, "downloads", "inventory.json"),
      Date.now(),
    );

    const { findInventoryFile } = await loadModule();
    expect(findInventoryFile()).toBe(downloads);
  });

  it("restores a selected AlecaFrame inventory with its decoder", async () => {
    const alecaPath = path.join(tmpDir, "local", "AlecaFrame", "lastData.dat");
    writeAlecaInventory(alecaPath, { Suits: [], marker: "aleca" });
    writeValidInventory(
      path.join(tmpDir, "userData", "api-helper", "inventory.json"),
      "helper",
      Date.now(),
    );
    writeState(alecaPath, "aleca");

    const inventoryIpc = await loadModule();
    expect(inventoryIpc.loadInitialInventory()).toMatchObject({
      path: alecaPath,
      data: { marker: "aleca" },
    });
  });

  it("recovers when the selected AlecaFrame file becomes valid after startup", async () => {
    const alecaPath = path.join(tmpDir, "local", "AlecaFrame", "lastData.dat");
    fs.mkdirSync(path.dirname(alecaPath), { recursive: true });
    fs.writeFileSync(alecaPath, "garbage");
    writeValidInventory(
      path.join(tmpDir, "userData", "api-helper", "inventory.json"),
      "helper",
      Date.now(),
    );
    writeState(alecaPath, "aleca");

    const inventoryIpc = await loadModule();
    const context = (await import("../../ipc/context")).default;
    const send = vi.fn();
    context.mainWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as never;

    expect(inventoryIpc.loadInitialInventory()).toBeNull();
    expect(chokidarMock.watch).toHaveBeenCalledWith(alecaPath, expect.anything());

    writeAlecaInventory(alecaPath, { Suits: [], marker: "aleca" });
    chokidarMock.callbacks.get("change")?.();

    expect(send).toHaveBeenCalledWith(
      "inventory-updated",
      expect.objectContaining({ marker: "aleca" }),
    );
  });

  it("watches the AlecaFrame file and pushes decoded updates", async () => {
    const alecaPath = path.join(tmpDir, "local", "AlecaFrame", "lastData.dat");
    writeAlecaInventory(alecaPath, { Suits: [], marker: "aleca" });
    writeState(alecaPath, "aleca");

    const inventoryIpc = await loadModule();
    const context = (await import("../../ipc/context")).default;
    const send = vi.fn();
    context.mainWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as never;

    expect(inventoryIpc.loadInitialInventory()).toMatchObject({ path: alecaPath });
    expect(chokidarMock.watch).toHaveBeenCalledWith(alecaPath, expect.anything());

    writeAlecaInventory(alecaPath, { Suits: [], marker: "fresh" });
    chokidarMock.callbacks.get("change")?.();

    expect(send).toHaveBeenCalledWith(
      "inventory-updated",
      expect.objectContaining({ marker: "fresh" }),
    );
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

  it("reports watcher errors and re-arms the watcher", async () => {
    vi.useFakeTimers();
    const helper = writeValidInventory(
      path.join(tmpDir, "userData", "api-helper", "inventory.json"),
      "watched",
      Date.now(),
    );
    const inventoryIpc = await loadModule();
    const context = (await import("../../ipc/context")).default;
    const send = vi.fn();
    context.mainWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as never;

    inventoryIpc.watchInventoryFile(helper);
    chokidarMock.callbacks.get("error")?.(new Error("permission denied"));

    expect(send).toHaveBeenCalledWith(
      "inventory-status-updated",
      expect.objectContaining({
        path: helper,
        found: true,
        lastError: expect.objectContaining({ kind: "watch", message: "permission denied" }),
      }),
    );
    expect(chokidarMock.watcher.close).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(chokidarMock.watch).toHaveBeenCalledTimes(2);
    chokidarMock.callbacks.get("ready")?.();
    expect(send).toHaveBeenLastCalledWith(
      "inventory-status-updated",
      expect.objectContaining({ lastError: null }),
    );
    vi.useRealTimers();
  });

  it("cancels a pending watcher retry during shutdown", async () => {
    vi.useFakeTimers();
    const helper = writeValidInventory(
      path.join(tmpDir, "userData", "api-helper", "inventory.json"),
      "watched",
      Date.now(),
    );
    const inventoryIpc = await loadModule();

    inventoryIpc.watchInventoryFile(helper);
    chokidarMock.callbacks.get("error")?.(new Error("permission denied"));
    inventoryIpc.stopInventoryWatcher();
    inventoryIpc.stopInventoryWatcher();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(chokidarMock.watch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
