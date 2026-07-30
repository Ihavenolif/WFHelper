import { loadItemPrice, loadItemPriceBySlug } from "./priceLoader.js";

interface PriceState {
  text: string;
  slug: string | null;
}

export function createPriceLoader(assign: (state: PriceState) => void): {
  clear: () => void;
  load: (
    name: string,
    lookup: Record<string, { url_name: string }>,
    isTradable: boolean,
    options?: { fallbackName?: string; fallbackTradable?: boolean; preferredSlug?: string | null },
  ) => Promise<void>;
} {
  let token = 0;

  return {
    clear(): void {
      token++;
      assign({ text: "", slug: null });
    },
    async load(
      name: string,
      lookup: Record<string, { url_name: string }>,
      isTradable: boolean,
      options: {
        fallbackName?: string;
        fallbackTradable?: boolean;
        preferredSlug?: string | null;
      } = {},
    ): Promise<void> {
      const currentToken = ++token;
      assign({ text: "Loading price...", slug: null });

      // A hydrated market slug beats name resolution - some items trade under
      // a different WFM name (e.g. "Ambassador Receiver Blueprint" is
      // ambassador_receiver on WFM).
      if (options.preferredSlug) {
        const bySlug = await loadItemPriceBySlug(options.preferredSlug);
        if (currentToken !== token) return;
        if (bySlug) {
          assign(bySlug);
          return;
        }
      }

      let result = await loadItemPrice(name, lookup, isTradable);
      if (!result.slug && options.fallbackName) {
        result = await loadItemPrice(
          options.fallbackName,
          lookup,
          options.fallbackTradable ?? isTradable,
        );
      }
      if (currentToken !== token) return;
      assign({ text: result.text, slug: result.slug });
    },
  };
}
