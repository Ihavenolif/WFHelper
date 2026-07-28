import { describe, expect, it } from "vitest";

import { formatWfmAssetUrl, wfmThumbMirrorPath } from "../../config/shared/wfm";

describe("wfmThumbMirrorPath", () => {
  it("strips the content hash so keys survive WFM re-exports", () => {
    expect(
      wfmThumbMirrorPath(
        "https://warframe.market/static/assets/items/images/en/thumbs/astral_bond.2fc6548b626af779f232d8f23f701dbb.128x128.png",
      ),
    ).toBe("wfm/items/images/en/thumbs/astral_bond.128x128.png");
  });

  it("keys hashless thumb URLs unchanged", () => {
    expect(
      wfmThumbMirrorPath(
        "https://warframe.market/static/assets/items/images/en/thumbs/latron_prime_riven_mod.png",
      ),
    ).toBe("wfm/items/images/en/thumbs/latron_prime_riven_mod.png");
  });

  it("ignores non-thumb assets and non-asset paths", () => {
    expect(
      wfmThumbMirrorPath(
        "https://warframe.market/static/assets/items/images/en/astral_bond.2fc6548b626af779f232d8f23f701dbb.png",
      ),
    ).toBeNull();
    expect(wfmThumbMirrorPath("https://warframe.market/profile/somebody")).toBeNull();
    expect(wfmThumbMirrorPath("not a url")).toBeNull();
  });
});

describe("formatWfmAssetUrl", () => {
  it("serves thumbs from the mirror", () => {
    expect(
      formatWfmAssetUrl(
        "items/images/en/thumbs/astral_bond.2fc6548b626af779f232d8f23f701dbb.128x128.png",
      ),
    ).toBe("https://assets.wfhelper.com/wfm/items/images/en/thumbs/astral_bond.128x128.png");
  });

  it("leaves non-thumb WFM assets and foreign hosts alone", () => {
    expect(
      formatWfmAssetUrl("items/images/en/astral_bond.2fc6548b626af779f232d8f23f701dbb.png"),
    ).toBe(
      "https://warframe.market/static/assets/items/images/en/astral_bond.2fc6548b626af779f232d8f23f701dbb.png",
    );
    expect(formatWfmAssetUrl("https://example.com/thumbs/x.png")).toBe(
      "https://example.com/thumbs/x.png",
    );
    expect(formatWfmAssetUrl("   ")).toBeNull();
    expect(formatWfmAssetUrl(null)).toBeNull();
  });
});
