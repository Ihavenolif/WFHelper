import ctx from "./context";
import * as tradeNotificationIpc from "./tradeNotificationIpc";
import { withScope } from "../services/logger";
import * as tradeTracker from "../services/tradeTracker";
import * as tradeWfmMatcher from "../services/tradeWfmMatcher";
import * as wfmSession from "../services/wfmSession";
import type { ParsedLogTrade } from "../services/eeLogMonitor";
import { isTradeNotificationOverlayEnabled } from "../config/runtime/overlaySettings";
import { TRADE_RECORDED } from "../config/shared/ipcChannels";
import { summarizeMatches, summarizeTrade } from "../config/shared/tradeMatch";
import type { TradeMatchPayload, TradeNotificationStatus } from "../config/shared/tradeMatch";

const log = withScope("tradeWorkflow");

export function handleConfirmedTrade(trade: ParsedLogTrade): void {
  const event = tradeTracker.recordTradeFromLog(trade);
  if (!event) return;

  const win = ctx.mainWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send(TRADE_RECORDED, { trade: event, wfmMatches: [] });
  }

  void (async () => {
    const notify = (status: TradeNotificationStatus, match?: TradeMatchPayload | null) => {
      if (!isTradeNotificationOverlayEnabled(ctx.overlaySettings)) return;
      tradeNotificationIpc.showTradeNotification(match ?? summarizeTrade(event), status);
    };

    if (!ctx.overlaySettings.autoCloseWfmOrders || !wfmSession.getToken()) {
      notify("detected");
      return;
    }

    try {
      const matches = await tradeWfmMatcher.matchTradeToOrders(trade);
      if (matches.length === 0) {
        notify("no-match");
        return;
      }

      const closed: TradeMatchPayload[] = [];
      for (const match of matches) {
        if (await tradeWfmMatcher.closeMatchedOrder(match)) closed.push(match);
      }
      if (closed.length === 0) {
        notify("close-failed", matches[0]);
        return;
      }

      tradeTracker.markTradeWfmClosed(event.id);

      if (win && !win.isDestroyed()) {
        win.webContents.send(TRADE_RECORDED, {
          trade: { ...event, wfmClosed: true },
          wfmMatches: closed,
        });
      }

      notify("closed", summarizeMatches(closed, event.platChange));
    } catch (err) {
      log.warn("[Trade] Auto-close error:", String(err));
      notify("no-match");
    }
  })();
}
