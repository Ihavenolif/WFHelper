import { describe, expect, it } from "vitest";

import { parseCircuitChoices } from "../../services/worldStateParser";

const WEEK_START = 1_784_505_600_000;
const WEEK_END = 1_785_110_400_000;

function deDate(ms: number) {
  return { $date: { $numberLong: String(ms) } };
}

const SCHEDULED = {
  EndlessXpSchedule: [
    {
      Activation: deDate(WEEK_START),
      Expiry: deDate(WEEK_END),
      CategoryChoices: [
        { Category: "EXC_NORMAL", Choices: ["Saryn", "Vauban", "Nova"] },
        { Category: "EXC_HARD", Choices: ["Lex", "Magistar", "CeramicDagger"] },
      ],
    },
  ],
};

describe("parseCircuitChoices", () => {
  it("reads the active window from EndlessXpSchedule", () => {
    expect(parseCircuitChoices(SCHEDULED, WEEK_START + 1_000)).toEqual([
      { category: "normal", choices: ["Saryn", "Vauban", "Nova"] },
      { category: "hard", choices: ["Lex", "Magistar", "Ceramic Dagger"] },
    ]);
  });

  it("ignores a window that has not started or already ended", () => {
    expect(parseCircuitChoices(SCHEDULED, WEEK_START - 1_000)).toEqual([]);
    expect(parseCircuitChoices(SCHEDULED, WEEK_END + 1_000)).toEqual([]);
  });

  it("picks the window that covers now out of several", () => {
    const twoWeeks = {
      EndlessXpSchedule: [
        {
          Activation: deDate(WEEK_START - 604_800_000),
          Expiry: deDate(WEEK_START),
          CategoryChoices: [{ Category: "EXC_NORMAL", Choices: ["Ash"] }],
        },
        ...SCHEDULED.EndlessXpSchedule,
      ],
    };
    expect(parseCircuitChoices(twoWeeks, WEEK_START + 1_000)[0].choices).toEqual([
      "Saryn",
      "Vauban",
      "Nova",
    ]);
  });

  it("still reads the legacy flat field", () => {
    const legacy = {
      EndlessXpChoices: [{ Category: "EXC_NORMAL", Choices: ["Excalibur"] }],
    };
    expect(parseCircuitChoices(legacy, WEEK_START)).toEqual([
      { category: "normal", choices: ["Excalibur"] },
    ]);
  });

  it("returns nothing when the world state carries no rotation", () => {
    expect(parseCircuitChoices({}, WEEK_START)).toEqual([]);
    expect(parseCircuitChoices(null, WEEK_START)).toEqual([]);
  });
});
