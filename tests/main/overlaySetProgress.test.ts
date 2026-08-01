import { describe, expect, it, vi } from "vitest";

import { RELIC_REWARD_ITEMS } from "../../config/shared/ipcChannels";
import { createOverlayScanController } from "../../ipc/overlay/scan";

const PARENT = "/Lotus/Powersuits/Odalisk/ProteaPrime";
const RECIPES = "/Lotus/Types/Recipes/WarframeRecipes";
const CHASSIS = `${RECIPES}/ProteaPrimeChassisComponent`;

// The set lists parts as ...Component; the inventory holds the ...Blueprint recipes.
const ITEM_DB: Record<string, Record<string, unknown>> = {
  [CHASSIS]: { uniqueName: CHASSIS, name: "Protea Prime Chassis Blueprint", componentOf: PARENT },
  [PARENT]: {
    uniqueName: PARENT,
    name: "Protea Prime",
    components: [
      { name: "Blueprint", uniqueName: `${RECIPES}/ProteaPrimeBlueprint`, itemCount: 1 },
      { name: "Chassis", uniqueName: CHASSIS, itemCount: 1 },
      { name: "Neuroptics", uniqueName: `${RECIPES}/ProteaPrimeHelmetComponent`, itemCount: 1 },
      { name: "Systems", uniqueName: `${RECIPES}/ProteaPrimeSystemsComponent`, itemCount: 1 },
      {
        name: "Orokin Cell",
        uniqueName: "/Lotus/Types/Items/MiscItems/OrokinCell",
        itemCount: 5,
        tradable: false,
      },
    ],
  },
};

vi.mock("../../services/itemDatabase", () => ({
  lookupItem: (uniqueName: string) => ITEM_DB[uniqueName] || null,
  lookupItemByNameOrSlug: (name: string) =>
    Object.values(ITEM_DB).find((entry) => entry.name === name) || null,
  isReusableBlueprint: () => false,
}));

const noop = () => {};

async function scanWithInventory(recipes: Array<{ ItemType: string; ItemCount: number }>) {
  const events: Array<{ channel: string; payload: unknown }> = [];

  const controller = createOverlayScanController({
    log: { info: noop, warn: noop, error: noop },
    rewardScanner: {
      scanRewardsDetailed: async () => ({
        items: [{ name: "Protea Prime Chassis Blueprint" }],
        meta: null,
      }),
    },
    ctx: {
      overlaySettings: {},
      overlayWindow: null,
      currentInventoryData: { MiscItems: [], Recipes: recipes },
    },
    windows: {
      setAnchorMeta: noop,
      getAnchorMeta: () => null,
      positionOverlayWindow: noop,
      sendOverlayEvent: (channel: string, payload?: unknown) => events.push({ channel, payload }),
      scheduleOverlayAutoHide: noop,
      clearOverlayAutoHideTimer: noop,
      createOverlayWindow: noop,
    },
  });

  await controller.dispatchRewardScan("manual");
  const items = events.find((event) => event.channel === RELIC_REWARD_ITEMS)?.payload;
  return (Array.isArray(items) ? items[0] : null) as Record<string, unknown> | null;
}

describe("overlay set progress", () => {
  it("counts set parts the inventory holds under their blueprint names", async () => {
    const item = await scanWithInventory([
      { ItemType: `${RECIPES}/ProteaPrimeBlueprint`, ItemCount: 11 },
      { ItemType: `${RECIPES}/ProteaPrimeChassisBlueprint`, ItemCount: 5 },
      { ItemType: `${RECIPES}/ProteaPrimeHelmetBlueprint`, ItemCount: 2 },
    ]);

    const parts = item?.setParts as Array<{ ownedCount: number }>;

    expect(item?.partOwnedCount).toBe(5);
    expect(item?.setOwnedCount).toBe(3);
    expect(item?.setRequiredCount).toBe(4);
    expect(parts.map((part) => part.ownedCount)).toEqual([11, 5, 2, 0]);
  });

  it("leaves genuinely missing parts at zero", async () => {
    const item = await scanWithInventory([
      { ItemType: `${RECIPES}/ProteaPrimeChassisBlueprint`, ItemCount: 1 },
    ]);

    expect(item?.setOwnedCount).toBe(1);
    expect(item?.completeSetCount).toBe(0);
  });
});
