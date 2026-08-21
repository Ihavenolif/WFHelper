(function () {
  let messages = {};
  let locale = "en";
  let pushed = false;
  const listeners = new Set();
  // invoke rejects when no handler is registered, but hangs if main never answers.
  const LOAD_TIMEOUT_MS = 4000;

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

  function applyMessages(next) {
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

  function apply(next) {
    if (!applyMessages(next)) return false;
    pushed = true;
    return true;
  }

  /** Re-runs cb on every language change so text built in JS follows along. */
  function onApply(cb) {
    listeners.add(cb);
  }

  // Overlays wait on this before their first paint, so no panel ever flashes
  // untranslated keys. It resolves true even when the pull fails or never
  // answers: the authored English markup beats a panel that never opens.
  function load(fetchMessages) {
    return new Promise(function (resolve) {
      let settled = false;
      function done() {
        if (settled) return;
        settled = true;
        resolve(true);
      }
      const timer = setTimeout(done, LOAD_TIMEOUT_MS);
      Promise.resolve()
        .then(fetchMessages)
        .then(function (next) {
          // A language change that landed while this was in flight is newer.
          if (!pushed) applyMessages(next);
        })
        .catch(function () {})
        .then(function () {
          clearTimeout(timer);
          done();
        });
    });
  }

  function getLocale() {
    return locale;
  }

  window.overlayI18n = { t, apply, onApply, load, getLocale };
})();
