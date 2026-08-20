import { contextBridge, ipcRenderer } from "electron";
import type {
  TradeNotificationShowPayload,
  TradeRepResultPayload,
} from "./ipc/tradeNotificationIpc";
import { onIpcData } from "./ipc/preloadListeners";
import { installOverlayContentVisibility } from "./ipc/overlayContentVisibility";
import {
  TRADE_NOTIFICATION_SHOW,
  TRADE_NOTIFICATION_DISMISS,
  TRADE_NOTIFICATION_REP_RESULT,
  OVERLAY_GET_MESSAGES,
  OVERLAY_MESSAGES,
  OVERLAY_THEME_VARS,
} from "./config/shared/ipcChannels";

export type { TradeNotificationShowPayload, TradeRepResultPayload };

installOverlayContentVisibility(ipcRenderer);

contextBridge.exposeInMainWorld("tradeNotificationApi", {
  onShow: (callback: (payload: TradeNotificationShowPayload) => void) => {
    return onIpcData(ipcRenderer, TRADE_NOTIFICATION_SHOW, callback);
  },

  onRepResult: (callback: (payload: TradeRepResultPayload) => void) => {
    return onIpcData(ipcRenderer, TRADE_NOTIFICATION_REP_RESULT, callback);
  },

  dismiss: () => {
    ipcRenderer.send(TRADE_NOTIFICATION_DISMISS);
  },

  onThemeVars: (callback: (vars: Record<string, string>) => void) => {
    return onIpcData(ipcRenderer, OVERLAY_THEME_VARS, callback);
  },

  getMessages: () => ipcRenderer.invoke(OVERLAY_GET_MESSAGES),

  onMessages: (callback: (messages: Record<string, string>) => void) => {
    return onIpcData(ipcRenderer, OVERLAY_MESSAGES, callback);
  },
});
