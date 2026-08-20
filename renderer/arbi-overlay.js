let _runId = null;
let _summary = null;

function t(key, params) {
  return window.overlayI18n.t(key, params);
}

function el(id) {
  return document.getElementById(id);
}

function formatDuration(totalSeconds) {
  const duration = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function missionLabel(data) {
  if (data.missionType === "defense") return t("arbi.type.defense");
  if (data.missionType === "interception") return t("arbi.type.interception");
  const raw = typeof data.missionTypeRaw === "string" ? data.missionTypeRaw : "";
  // Anything else is the game's own MT_ enum, which only exists in English.
  return raw
    ? raw
        .replace(/^MT_/, "")
        .toLowerCase()
        .replace(/(^|_)\w/g, (c) => c.replace("_", " ").toUpperCase())
    : t("overlay.arbi.missionFallback");
}

function renderSummary() {
  const data = _summary;
  if (!data) return;

  el("run-node").textContent = data.node || t("overlay.arbi.unknownNode");
  const rotations = t("overlay.arbi.rotations", { count: Number(data.rotations) || 0 });
  el("run-meta").textContent =
    `${missionLabel(data)} · ${formatDuration(data.durationSec)} · ${rotations}`;

  const mean = Number(data.expectedVitusMean);
  const std = Number(data.expectedVitusStd);
  const vitusEl = el("kpi-vitus");
  vitusEl.textContent = "";
  const locale = window.overlayI18n.getLocale();
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  vitusEl.appendChild(
    document.createTextNode(Number.isFinite(mean) ? mean.toLocaleString(locale, oneDecimal) : "-"),
  );
  if (Number.isFinite(std) && std > 0) {
    const sub = document.createElement("span");
    sub.className = "kpi-sub";
    sub.textContent = ` ±${std.toLocaleString(locale, oneDecimal)}`;
    vitusEl.appendChild(sub);
  }

  el("kpi-drones").textContent = (Number(data.drones) || 0).toLocaleString(locale);
  el("kpi-kills").textContent = (Number(data.totalEnemies) || 0).toLocaleString(locale);

  const pct = Number(data.pctTimeAt15Plus);
  el("kpi-saturation").textContent = Number.isFinite(pct)
    ? `${pct.toLocaleString(locale, oneDecimal)}%`
    : "-";
}

function onSummaryData(data) {
  if (!data || typeof data !== "object") return;
  _runId = typeof data.id === "string" ? data.id : null;
  _summary = data;
  renderSummary();
}

document.addEventListener("DOMContentLoaded", () => {
  let bootstrapped = false;
  const finishBootstrap = (loaded) => {
    if (!loaded || bootstrapped) return;
    bootstrapped = true;
    window.arbiSummary.ready();
  };
  window.overlayTheme.loadThemeFromStorageFallback();
  void window.arbiSummary
    .getThemeVars()
    .then(window.overlayTheme.applyThemeVars)
    .catch(() => {
      // best effort, storage fallback already applied
    });

  el("btn-close").addEventListener("click", () => window.arbiSummary.close());
  el("btn-details").addEventListener("click", () => {
    if (_runId) window.arbiSummary.openDetails(_runId);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") window.arbiSummary.close();
  });

  window.installOverlayDrag({
    isInteractive: () => true,
    moveBy: (dx, dy) => window.arbiSummary.moveBy(dx, dy),
  });

  window.arbiSummary.onData(onSummaryData);
  window.arbiSummary.onThemeVars(window.overlayTheme.applyThemeVars);
  window.arbiSummary.onMessages((messages) => finishBootstrap(window.overlayI18n.apply(messages)));
  // Header and KPI values are rebuilt from the stored run on a language change.
  window.overlayI18n.onApply(renderSummary);
  void window.overlayI18n.load(() => window.arbiSummary.getMessages()).then(finishBootstrap);
});
