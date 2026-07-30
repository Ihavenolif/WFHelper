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

  const notification = document.getElementById("notification");
  const itemThumb = document.getElementById("item-thumb");
  const tradeLabel = document.getElementById("trade-label");
  const tradeBadge = document.getElementById("trade-badge");
  const itemName = document.getElementById("item-name");
  const platAmount = document.getElementById("plat-amount");
  const partnerName = document.getElementById("partner-name");

  let dismissTimer = null;
  let fadeTimer = null;

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

    // Show with animation
    notification.classList.remove("hidden", "fade-out");

    // Reset auto-dismiss timer
    if (dismissTimer) clearTimeout(dismissTimer);
    if (fadeTimer) clearTimeout(fadeTimer);
    dismissTimer = setTimeout(function () {
      dismissTimer = null;
      notification.classList.add("fade-out");
      fadeTimer = setTimeout(function () {
        fadeTimer = null;
        notification.classList.add("hidden");
        // Notify main process we're done; preload always exposes this.
        window.tradeNotificationApi.dismiss();
      }, fadeMs);
    }, visibleMs);
  }

  // Listen for IPC events from main. The preload script is the only loader
  // that produces this window, so the bridge is always installed.
  window.tradeNotificationApi.onShow(function (payload) {
    showNotification(payload);
  });
})();
