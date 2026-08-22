import path from "node:path";

import { app } from "electron";

// Static import, not a late `require`: vitest mocks electron through the ESM
// import, and callers guard their own no-electron paths before calling in.
export function userDataPath(...segments: string[]): string {
  return path.join(app.getPath("userData"), ...segments);
}
