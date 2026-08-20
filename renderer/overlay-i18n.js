(function () {
  let messages = {};
  let locale = "en";
  const listeners = new Set();

  function interpolate(template, params) {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      const value = params[name];
      return value == null ? match : String(value);
    });
  }

  // Falls back to the key so a message the main process never sent shows up in
  // a screenshot instead of silently blanking the panel.
  function t(key, params) {
    const template = messages[key];
    return typeof template === "string" ? interpolate(template, params) : key;
  }

  function applyMarkup() {
    for (const node of document.querySelectorAll("[data-i18n]")) {
      const value = messages[node.getAttribute("data-i18n")];
      if (typeof value === "string") node.textContent = value;
    }
    for (const node of document.querySelectorAll("[data-i18n-title]")) {
      const value = messages[node.getAttribute("data-i18n-title")];
      if (typeof value === "string") node.title = value;
    }
  }

  function apply(next) {
    if (!next || typeof next !== "object") return false;
    const nextMessages = next.messages;
    if (!nextMessages || typeof nextMessages !== "object") return false;
    messages = nextMessages;
    if (typeof next.locale === "string" && next.locale) locale = next.locale;
    document.documentElement.lang = locale;
    applyMarkup();
    for (const listener of listeners) listener();
    return true;
  }

  /** Re-runs cb on every language change so text built in JS follows along. */
  function onApply(cb) {
    listeners.add(cb);
  }

  // Overlays wait on this before their first paint, so no panel ever flashes
  // untranslated keys.
  function load(fetchMessages) {
    return Promise.resolve()
      .then(fetchMessages)
      .then(apply)
      .catch(function () {
        return false;
      });
  }

  function getLocale() {
    return locale;
  }

  window.overlayI18n = { t, apply, onApply, load, getLocale };
})();
