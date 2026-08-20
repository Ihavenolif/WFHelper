import fs from "node:fs";

import { writeFileAtomicSync } from "./atomicFile";
import { withScope } from "./logger";
import { userDataPath } from "./userDataPath";

const log = withScope("jsonCache");

interface JsonCache<T> {
  read(): T | null;
  write(payload: T): void;
}

// `revive` owns shape validation; an unreadable file and a failed write both
// degrade so a corrupt cache never blocks a rebuild from source.
export function createJsonCache<T>(
  filename: string,
  revive: (parsed: unknown) => T | null,
): JsonCache<T> {
  const cachePath = (): string => userDataPath(filename);

  return {
    read(): T | null {
      try {
        return revive(JSON.parse(fs.readFileSync(cachePath(), "utf8")));
      } catch {
        return null;
      }
    },
    write(payload: T): void {
      try {
        writeFileAtomicSync(cachePath(), JSON.stringify(payload));
      } catch (err) {
        log.warn(`Failed to write ${filename}`, err);
      }
    },
  };
}
