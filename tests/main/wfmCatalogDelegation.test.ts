import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("wfmCatalog item lookups", () => {
  it("loads and exposes name/url/renderer mapping", async () => {
    const wfmClient = await import("../../services/wfmClient");
    vi.spyOn(wfmClient, "requestV2").mockResolvedValue({
      data: {
        items: [
          {
            id: "wf-item-id",
            slug: "ash_prime_set",
            i18n: {
              en: {
                itemName: "Ash Prime Set",
                thumb: "thumb/ash.png",
                icon: "icon/ash.png",
              },
            },
          },
        ],
      },
    });

    const wfmCatalog = await import("../../services/wfmCatalog");

    await expect(wfmCatalog.ensureLoaded()).resolves.toBe(1);
    expect(wfmCatalog.isLoaded()).toBe(true);

    expect(wfmCatalog.lookupByName("Ash Prime Set")).toMatchObject({
      url_name: "ash_prime_set",
      item_name: "Ash Prime Set",
      thumb: "https://warframe.market/static/assets/thumb/ash.png",
      icon: "https://warframe.market/static/assets/icon/ash.png",
    });

    expect(wfmCatalog.lookupByName("Ash Prime")).toMatchObject({
      url_name: "ash_prime_set",
    });

    expect(wfmCatalog.getRendererLookup()["ash prime set"]).toMatchObject({
      url_name: "ash_prime_set",
      item_name: "Ash Prime Set",
    });
  });

  it("does not latch an empty catalog and recovers on a later retry", async () => {
    vi.useFakeTimers();
    const wfmClient = await import("../../services/wfmClient");
    const request = vi.spyOn(wfmClient, "requestV2").mockRejectedValue(new Error("timeout"));
    const wfmCatalog = await import("../../services/wfmCatalog");

    await expect(wfmCatalog.ensureLoaded()).rejects.toThrow("no items");
    expect(wfmCatalog.isLoaded()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);

    // Within the failure cooldown: rejects fast without another network call.
    await expect(wfmCatalog.ensureLoaded()).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(16_000);
    request.mockResolvedValue({
      data: { items: [{ id: "wf-item-id", slug: "ash_prime_set" }] },
    });
    await expect(wfmCatalog.ensureLoaded()).resolves.toBe(1);
    expect(wfmCatalog.isLoaded()).toBe(true);
  });

  it("caches one valid set response under every member slug", async () => {
    const wfmClient = await import("../../services/wfmClient");
    const request = vi.spyOn(wfmClient, "requestV2").mockResolvedValue({
      data: {
        items: [
          { slug: "akbronco_prime_set", setRoot: true },
          { slug: "akbronco_prime_blueprint", setRoot: false, quantityInSet: 1 },
          { slug: "bronco_prime_set", setRoot: false, quantityInSet: 2 },
        ],
      },
    });
    const wfmCatalog = await import("../../services/wfmCatalog");

    const first = await wfmCatalog.resolveSetMembership("akbronco_prime_blueprint");
    const second = await wfmCatalog.resolveSetMembership("bronco_prime_set");

    expect(first).toEqual({
      kind: "set",
      setSlug: "akbronco_prime_set",
      parts: [
        { slug: "akbronco_prime_blueprint", quantityInSet: 1 },
        { slug: "bronco_prime_set", quantityInSet: 2 },
      ],
    });
    expect(second).toEqual(first);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not cache malformed set quantities", async () => {
    const wfmClient = await import("../../services/wfmClient");
    const request = vi.spyOn(wfmClient, "requestV2").mockResolvedValue({
      data: {
        items: [
          { slug: "broken_set", setRoot: true },
          { slug: "broken_blueprint", setRoot: false, quantityInSet: 1 },
          { slug: "broken_part", setRoot: false },
        ],
      },
    });
    const wfmCatalog = await import("../../services/wfmCatalog");

    await expect(wfmCatalog.resolveSetMembership("broken_part")).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(wfmCatalog.resolveSetMembership("broken_part")).resolves.toEqual({
      kind: "unavailable",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("caches a 404 as a non-set item", async () => {
    const wfmClient = await import("../../services/wfmClient");
    const request = vi
      .spyOn(wfmClient, "requestV2")
      .mockRejectedValue(new wfmClient.WfmApiError("not found", "WFM_API_ERROR", 404));
    const wfmCatalog = await import("../../services/wfmCatalog");

    await expect(wfmCatalog.resolveSetMembership("forma_blueprint")).resolves.toEqual({
      kind: "not-set",
    });
    await expect(wfmCatalog.resolveSetMembership("forma_blueprint")).resolves.toEqual({
      kind: "not-set",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
