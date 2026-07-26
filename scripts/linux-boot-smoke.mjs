import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { _electron as electron } from "@playwright/test";

const MAIN_RENDERER_URL = "renderer/dist/index.html";
const WINDOW_TIMEOUT_MS = 90_000;
const SETTLE_MS = 5_000;

// Regressions owned by the app.
const FATAL_PATTERNS = [
  { re: /ERR_FILE_NOT_FOUND/i, why: "a window loaded a path that does not exist" },
  { re: /spawn\s+powershell/i, why: "a Windows-only binary was spawned" },
  { re: /ENOENT.*\.(exe|ps1|dll)\b/i, why: "a Windows-only file was opened" },
];

// Missing runner dependencies are advisory.
const ENVIRONMENT_PATTERNS = [
  /Missing X server/i,
  /cannot open display/i,
  /error while loading shared libraries/i,
  /libgbm|libnss3|libgtk|libasound/i,
  /Failed to connect to the bus/i,
];

function warn(message) {
  console.log(`::warning title=Linux boot smoke::${message}`);
}

function isEnvironmentFailure(text) {
  return ENVIRONMENT_PATTERNS.some((re) => re.test(text));
}

async function findMainWindow(app) {
  const deadline = Date.now() + WINDOW_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const found = app.windows().find((win) => win.url().includes(MAIN_RENDERER_URL));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-linux-boot-"));
const messages = [];
let app;

try {
  app = await electron.launch({
    args: ["--no-sandbox", "--disable-gpu", "."],
    env: {
      ...process.env,
      WFHELPER_DISABLE_KEYBOARD_HOOK: "1",
      WFHELPER_USER_DATA: path.join(sandboxDir, "user-data"),
      WF_DISABLE_AUTO_UPDATE: "1",
    },
  });
} catch (err) {
  const text = String(err?.message || err);
  if (isEnvironmentFailure(text)) {
    warn(`skipped, the runner could not start Electron: ${text.split("\n")[0]}`);
    process.exit(0);
  }
  console.error(`Electron failed to launch: ${text}`);
  process.exit(1);
}

app.process().stderr?.on("data", (chunk) => messages.push(String(chunk)));
app.on("window", (win) => {
  win.on("console", (msg) => {
    if (msg.type() === "error") messages.push(msg.text());
  });
  win.on("pageerror", (err) => messages.push(String(err?.message || err)));
});

const page = await findMainWindow(app);
if (!page) {
  const urls = app.windows().map((win) => win.url());
  console.error(`No window loaded ${MAIN_RENDERER_URL}. Open windows: ${JSON.stringify(urls)}`);
  console.error(messages.join("\n").slice(-4000));
  await app.close();
  process.exit(1);
}

// Capture delayed startup failures.
await page.waitForSelector("#app", { timeout: WINDOW_TIMEOUT_MS });
await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

const log = messages.join("\n");
const hits = FATAL_PATTERNS.filter(({ re }) => re.test(log));

await app.close();
fs.rmSync(sandboxDir, { recursive: true, force: true });

if (hits.length > 0) {
  for (const { why, re } of hits) {
    console.error(`Linux boot: ${why} (${re})`);
  }
  console.error(log.slice(-4000));
  process.exit(1);
}

console.log("Linux boot smoke OK: main window rendered, no platform errors.");
