import { masteryXpToRank } from "../../config/shared/masteryXp.js";

export function masteryProjectionSubtext(
  currentRank: number,
  totalXp: number,
  readyXp: number,
): string | null {
  if (!Number.isFinite(totalXp) || !Number.isFinite(readyXp) || readyXp <= 0) return null;

  const bankedRank = Math.max(currentRank, masteryXpToRank(totalXp));
  const projectedRank = Math.max(bankedRank, masteryXpToRank(totalXp + readyXp));
  const formattedReadyXp = readyXp.toLocaleString();

  if (projectedRank > bankedRank) {
    const bankedPrefix = bankedRank > currentRank ? `Banked XP supports MR ${bankedRank} · ` : "";
    return `${bankedPrefix}Foundry raises potential to MR ${projectedRank} (+${formattedReadyXp} XP)`;
  }

  if (bankedRank > currentRank) {
    return `Banked XP supports MR ${bankedRank} · ${formattedReadyXp} XP ready in Foundry`;
  }

  return `${formattedReadyXp} XP ready in Foundry`;
}
