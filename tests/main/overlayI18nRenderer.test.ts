import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

interface OverlayI18nApi {
  load: (fetchMessages: () => Promise<unknown>) => Promise<boolean>;
  t: (key: string) => string;
}

function loadRendererHelper() {
  const node = {
    textContent: "English default",
    title: "English title",
    getAttribute: (name: string) => (name === "data-i18n" ? "test.label" : "test.title"),
  };
  const document = {
    documentElement: { lang: "en" },
    querySelectorAll: (selector: string) =>
      selector === "[data-i18n]" || selector === "[data-i18n-title]" ? [node] : [],
  };
  const window = {} as { overlayI18n?: OverlayI18nApi };
  const source = fs.readFileSync(path.resolve(__dirname, "../../renderer/overlay-i18n.js"), "utf8");

  runInNewContext(source, { document, Promise, Set, String, window });
  return { api: window.overlayI18n!, document, node };
}

describe("overlay renderer messages", () => {
  it("keeps the English markup when loading messages fails", async () => {
    const { api, node } = loadRendererHelper();

    await expect(api.load(() => Promise.reject(new Error("unavailable")))).resolves.toBe(false);
    expect(node.textContent).toBe("English default");
    expect(node.title).toBe("English title");
  });

  it("applies a localized bundle and its locale", async () => {
    const { api, document, node } = loadRendererHelper();

    await expect(
      api.load(() =>
        Promise.resolve({
          locale: "de",
          messages: { "test.label": "Deutsch", "test.title": "Deutscher Titel" },
        }),
      ),
    ).resolves.toBe(true);
    expect(node.textContent).toBe("Deutsch");
    expect(node.title).toBe("Deutscher Titel");
    expect(document.documentElement.lang).toBe("de");
    expect(api.t("test.label")).toBe("Deutsch");
  });
});
