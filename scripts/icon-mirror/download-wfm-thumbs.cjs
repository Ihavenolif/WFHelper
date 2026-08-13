// Electron clears WFM's browser challenge before fetching thumbnails in-page.
// wfm-state.json avoids downloads unless the source URL or local file changes.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const outputRoot = path.join(repoRoot, ".icon-mirror");
const publicRoot = path.join(outputRoot, "public");
const manifestPath = path.join(publicRoot, "manifest.json");
const statePath = path.join(outputRoot, "wfm-state.json");
const failuresPath = path.join(outputRoot, "wfm-download-failures.json");

const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.ICON_MIRROR_CONCURRENCY) || 4));
const CHALLENGE_TIMEOUT_MS = 120_000;
const SHOW_WINDOW_AFTER_MS = 15_000;

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function sniffImageExt(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return ".png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return ".webp";
  }
  return null;
}

async function earnClearance(win, part) {
  await win.loadURL("https://warframe.market/");
  const startedAt = Date.now();
  while (Date.now() - startedAt < CHALLENGE_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (win.isDestroyed()) return false;
    const cookies = await part.cookies.get({ domain: ".warframe.market" });
    const title = win.webContents.getTitle();
    if (cookies.some((c) => c.name === "JWT") && !/moment/i.test(title)) return true;
    // Managed challenges self-solve in seconds; interactive ones need a human.
    if (Date.now() - startedAt > SHOW_WINDOW_AFTER_MS && !win.isVisible()) {
      console.log("[wfm-thumbs] challenge needs interaction - showing window");
      win.show();
    }
  }
  return false;
}

async function fetchThumb(win, sourceUrl) {
  const result = await win.webContents.executeJavaScript(`
    fetch(${JSON.stringify(sourceUrl)}, { credentials: "include" }).then(async (res) => {
      if (!res.ok) return { status: res.status };
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return { status: res.status, base64: btoa(binary) };
    })
  `);
  if (result.status !== 200 || !result.base64) {
    return { ok: false, reason: `HTTP ${result.status}` };
  }
  const bytes = Buffer.from(result.base64, "base64");
  const ext = sniffImageExt(bytes);
  if (!ext) return { ok: false, reason: "payload is not a PNG/WEBP image" };
  if (!sourceUrl.toLowerCase().endsWith(ext)) {
    return { ok: false, reason: `payload is ${ext} but source URL is not` };
  }
  return { ok: true, bytes };
}

app.whenReady().then(async () => {
  const manifest = readJson(manifestPath, null);
  if (!manifest) {
    console.error(`[wfm-thumbs] missing ${manifestPath} - run icons:manifest first`);
    app.exit(1);
    return;
  }
  const entries = (manifest.entries || []).filter((e) => e.mirrorPath?.startsWith("wfm/"));
  const state = readJson(statePath, {});
  const pending = entries.filter((entry) => {
    const targetPath = path.join(publicRoot, entry.mirrorPath);
    return (
      state[entry.mirrorPath] !== entry.sourceUrl ||
      !fs.existsSync(targetPath) ||
      fs.statSync(targetPath).size === 0
    );
  });
  console.log(`[wfm-thumbs] ${entries.length} entries, ${pending.length} to download`);
  if (pending.length === 0) {
    app.exit(0);
    return;
  }

  // Throwaway profile: clearance is cheap to re-earn and a stale one 403s.
  app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "wfm-mirror-sync-")));
  const part = session.fromPartition("wfm-mirror-sync");
  const win = new BrowserWindow({
    width: 480,
    height: 640,
    show: false,
    title: "warframe.market thumb sync",
    autoHideMenuBar: true,
    webPreferences: { partition: "wfm-mirror-sync", sandbox: true, contextIsolation: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (!(await earnClearance(win, part))) {
    console.error("[wfm-thumbs] could not pass the Cloudflare challenge");
    app.exit(1);
    return;
  }
  if (win.isVisible()) win.hide();

  const failures = [];
  let downloaded = 0;
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < pending.length) {
      const entry = pending[nextIndex++];
      try {
        const result = await fetchThumb(win, entry.sourceUrl);
        if (!result.ok) {
          failures.push({ ...entry, reason: result.reason });
          continue;
        }
        const targetPath = path.join(publicRoot, entry.mirrorPath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, result.bytes);
        state[entry.mirrorPath] = entry.sourceUrl;
        downloaded++;
        if (downloaded % 250 === 0) {
          console.log(`[wfm-thumbs] ${downloaded}/${pending.length} downloaded`);
        }
      } catch (error) {
        failures.push({ ...entry, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  fs.writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`);
  console.log(`[wfm-thumbs] complete: ${downloaded} downloaded, ${failures.length} failed`);
  const failed = failures.length > 0 && process.env.ICON_MIRROR_ALLOW_FAILURES !== "1";
  if (failed) console.error(`[wfm-thumbs] failures written to ${failuresPath}`);
  app.exit(failed ? 1 : 0);
});
