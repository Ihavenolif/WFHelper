/* Trade Notification Overlay - renderer logic */
(function () {
  "use strict";

  const WFM_ASSET_BASE = "https://warframe.market/static/assets/";
  // Fallback values used only if the main process sends a legacy payload
  // without a `timing` field. The real values come from the payload.
  const FALLBACK_VISIBLE_MS = 5000;
  const FALLBACK_FADE_MS = 400;

  const STATUS_LABELS = {
    closed: "Listing Closed",
    "no-match": "No Listing Matched",
    "close-failed": "Closing Failed",
    detected: "Trade Finished",
  };

  const REP_RESULT_LABELS = {
    sent: { text: "+1 rep sent to {partner}", cls: "ok" },
    "already-exists": { text: "Already repped {partner}", cls: "ok" },
    "user-not-found": { text: "{partner} not found on warframe.market", cls: "err" },
    failed: { text: "Sending rep failed", cls: "err" },
  };

  const notification = document.getElementById("notification");
  const itemThumb = document.getElementById("item-thumb");
  const tradeLabel = document.getElementById("trade-label");
  const tradeBadge = document.getElementById("trade-badge");
  const itemName = document.getElementById("item-name");
  const platAmount = document.getElementById("plat-amount");
  const partnerName = document.getElementById("partner-name");
  const repLine = document.getElementById("rep-line");

  let dismissTimer = null;
  let fadeTimer = null;

  function scheduleDismiss(visibleMs, fadeMs) {
    if (dismissTimer) clearTimeout(dismissTimer);
    if (fadeTimer) clearTimeout(fadeTimer);
    dismissTimer = setTimeout(function () {
      dismissTimer = null;
      notification.classList.add("fade-out");
      fadeTimer = setTimeout(function () {
        fadeTimer = null;
        notification.classList.add("hidden");
        window.tradeNotificationApi.dismiss();
      }, fadeMs);
    }, visibleMs);
  }

  function showNotification(payload) {
    if (!payload) return;
    const match = payload.match;
    const timing = payload.timing || {};
    const visibleMs = typeof timing.visibleMs === "number" ? timing.visibleMs : FALLBACK_VISIBLE_MS;
    const fadeMs = typeof timing.fadeMs === "number" ? timing.fadeMs : FALLBACK_FADE_MS;
    if (!match) return;

    if (match.itemThumb) {
      const src = match.itemThumb.startsWith("http")
        ? match.itemThumb
        : WFM_ASSET_BASE + match.itemThumb;
      itemThumb.src = src;
      itemThumb.style.display = "block";
    } else {
      itemThumb.src = "";
      itemThumb.style.display = "none";
    }

    const status = STATUS_LABELS[payload.status] ? payload.status : "detected";
    tradeLabel.textContent = STATUS_LABELS[status];
    tradeLabel.className = status === "closed" ? "closed" : "unmatched";

    const isSale = match.type === "sale";
    const isPurchase = match.type === "purchase";
    tradeBadge.textContent = isSale ? "Sale" : isPurchase ? "Purchase" : "Trade";
    tradeBadge.className = isSale ? "sale" : isPurchase ? "purchase" : "trade";

    const qty = match.quantity > 1 ? match.quantity + "× " : "";
    itemName.textContent = qty + (match.itemName || "Unknown Item");

    const showPlatinum = (isSale || isPurchase) && match.platinum > 0;
    platAmount.hidden = !showPlatinum;
    if (showPlatinum) {
      platAmount.textContent = (isSale ? "+" : "−") + match.platinum + "p";
      platAmount.className = isSale ? "positive" : "negative";
    }

    partnerName.textContent = match.partner || "";

    const rep = payload.rep;
    if (rep && rep.partner && rep.hotkey) {
      repLine.textContent = "Press " + rep.hotkey + " to +1 rep " + rep.partner;
      repLine.className = "offer";
      repLine.hidden = false;
    } else {
      repLine.textContent = "";
      repLine.hidden = true;
    }

    // Show with animation
    notification.classList.remove("hidden", "fade-out");

    scheduleDismiss(visibleMs, fadeMs);
  }

  function showRepResult(payload) {
    if (!payload) return;
    const label = REP_RESULT_LABELS[payload.result] || REP_RESULT_LABELS.failed;
    repLine.textContent = label.text.replace("{partner}", payload.partner || "");
    repLine.className = label.cls;
    repLine.hidden = false;

    notification.classList.remove("hidden", "fade-out");
    scheduleDismiss(payload.timing.visibleMs, payload.timing.fadeMs);
  }

  // Listen for IPC events from main. The preload script is the only loader
  // that produces this window, so the bridge is always installed.
  window.tradeNotificationApi.onShow(function (payload) {
    showNotification(payload);
  });

  window.tradeNotificationApi.onRepResult(function (payload) {
    showRepResult(payload);
  });
})();
