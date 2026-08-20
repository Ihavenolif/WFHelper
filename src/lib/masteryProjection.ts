import { masteryXpToRank } from "../../config/shared/masteryXp.js";
import type { MessageKey } from "./i18n.js";

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function masteryProjectionSubtext(
  t: Translate,
  currentRank: number,
  totalXp: number,
  readyXp: number,
  locale: string,
): string | null {
  if (!Number.isFinite(totalXp) || !Number.isFinite(readyXp) || readyXp <= 0) return null;

  const bankedRank = Math.max(currentRank, masteryXpToRank(totalXp));
  const projectedRank = Math.max(bankedRank, masteryXpToRank(totalXp + readyXp));
  const formattedReadyXp = readyXp.toLocaleString(locale);
  const banked =
    bankedRank > currentRank ? t("mastery.projection.banked", { rank: bankedRank }) : null;

  if (projectedRank > bankedRank) {
    const raised = t("mastery.projection.foundryRaises", {
      rank: projectedRank,
      xp: formattedReadyXp,
    });
    return banked ? `${banked} · ${raised}` : raised;
  }

  const ready = t("mastery.projection.readyInFoundry", { xp: formattedReadyXp });
  return banked ? `${banked} · ${ready}` : ready;
}
