import { describe, expect, it, vi } from "vitest";

import { readGameAuthzWin } from "../../services/gameMemoryWin";

const ACCOUNT_ID = "0123456789abcdef01234567";
const AUTHZ = `?accountId=${ACCOUNT_ID}&nonce=1712345678901`;
const REGION_SIZE = 128n;

function nativeFn(implementation: (...args: unknown[]) => unknown) {
  return Object.assign(vi.fn(implementation), { async: vi.fn() });
}

describe("Windows game-memory scan", () => {
  it("continues to a valid singleton beyond the former aggregate byte limit", async () => {
    const openProcess = nativeFn((access: unknown) => (access === 0x1000 ? 1 : 2));
    const closeHandle = nativeFn(() => 1);
    const getLastError = nativeFn(() => 0);
    const enumProcesses = nativeFn((pids: unknown, _size: unknown, used: unknown) => {
      (pids as Buffer).writeUInt32LE(42, 0);
      (used as Buffer).writeUInt32LE(4, 0);
      return 1;
    });
    const queryImageName = nativeFn(
      (_handle: unknown, _flags: unknown, output: unknown, size: unknown) => {
        const imagePath = "C:\\Games\\Warframe.x64.exe";
        Buffer.from(imagePath, "utf16le").copy(output as Buffer);
        (size as Buffer).writeUInt32LE(imagePath.length, 0);
        return 1;
      },
    );
    const virtualQuery = nativeFn(
      (_handle: unknown, address: unknown, output: unknown, _size: unknown) => {
        const base = address as bigint;
        if (base !== 0n && base !== REGION_SIZE) return 0;
        const mbi = output as Buffer;
        mbi.fill(0);
        mbi.writeBigUInt64LE(base, 0);
        mbi.writeBigUInt64LE(REGION_SIZE, 24);
        mbi.writeUInt32LE(0x1000, 32);
        mbi.writeUInt32LE(0x04, 36);
        return 48;
      },
    );
    const readMemory = nativeFn(() => 0);
    readMemory.async.mockImplementation((...args: unknown[]) => {
      const address = args[1] as bigint;
      const output = args[2] as Buffer;
      const bytesRead = args[4] as Buffer;
      const callback = args[5] as (error: Error | null, ok: number) => void;
      output.fill(0);
      if (address === REGION_SIZE) output.write(AUTHZ, 0, "latin1");
      const reported = address === 0n ? 9n * 1024n * 1024n * 1024n : REGION_SIZE;
      bytesRead.writeBigUInt64LE(reported, 0);
      callback(null, 1);
    });

    const result = await readGameAuthzWin({
      OpenProcess: openProcess,
      CloseHandle: closeHandle,
      GetLastError: getLastError,
      VirtualQueryEx: virtualQuery,
      ReadProcessMemory: readMemory,
      EnumProcesses: enumProcesses,
      QueryFullProcessImageNameW: queryImageName,
    } as never);

    expect(result).toEqual({ authz: AUTHZ, reason: "ok-1x" });
    expect(readMemory.async).toHaveBeenCalledTimes(2);
  });
});
