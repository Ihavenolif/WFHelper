import { dialog } from "electron";
import type { IpcMainInvokeEvent } from "electron";

import ctx from "./context";

interface TradeMutationConfirmation {
  title: string;
  message: string;
  detail?: string;
}

// One approval covers the whole session: the gate exists so a compromised
// renderer can't mutate the WFM account without a user-visible prompt, and a
// single prompt preserves that while keeping bulk price edits usable.
let sessionApproved = false;

export async function confirmTradeMutation(
  event: IpcMainInvokeEvent,
  confirmation: TradeMutationConfirmation,
): Promise<boolean> {
  const win = ctx.mainWindow;
  if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id || !win.isFocused()) {
    return false;
  }
  if (sessionApproved) return true;

  const result = await dialog.showMessageBox(win, {
    type: "warning",
    title: confirmation.title,
    message: confirmation.message,
    detail: [
      confirmation.detail,
      "Allowing covers all Warframe Market changes until WFHelper is closed.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    buttons: ["Cancel", "Allow for this session"],
    cancelId: 0,
    defaultId: 0,
    noLink: true,
  });

  if (result.response !== 1) return false;
  sessionApproved = true;
  return true;
}

export function tradeMutationDenied(): { error: string } {
  return { error: "Trade action was not confirmed." };
}

export const __test__ = {
  resetSessionApprovalForTest(): void {
    sessionApproved = false;
  },
};
