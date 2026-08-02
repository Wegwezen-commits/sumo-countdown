// settings.js — the single gear icon's panel: dark mode, sakura, audio,
// compact mode, language, timezone, large-display (TV) mode. All prefs
// are stored in localStorage via SumoUtil.storage.
(function (global) {
  "use strict";

  const DEFAULTS = {
    theme: "auto-device",       // "auto" | "auto-device" | "light" | "dark"
    sakura: true,
    audio: false,
    music: false,
    volume: 60,
    compact: false,
    compactAuto: true,
    ultra: false,
    tv: false,
    timezone: "auto",
    contrast: "normal",
    showInactiveChannels: false,
    excludedNewsSources: [],
    notifications: false
  };

  function isMobileViewport() {
    try { return window.matchMedia("(max-width: 767px)").matches; }
    catch (e) { return false; }
  }

  const Settings = {
    prefs: { ...DEFAULTS },

    load() {
      this.prefs = { ...DEFAULTS, ...SumoUtil.storage.get("prefs", {}) };
      return this.prefs;
    },

    save() { SumoUtil.storage.set("prefs", this.prefs); },

    set(key, value) {
      this.prefs[key] = value;
      this.save();
      this.apply();
      document.dispatchEvent(new CustomEvent("prefschange", { detail: { key, value } }));
    },

    isJapanNight() {
      // "Automatic, based on Japan time" — treat 19:00–06:59 JST as dark.
      try {
        const jstHour = Number(new Intl.DateTimeFormat("en-US", {
          hour: "numeric", hour12: false, timeZone: "Asia/Tokyo"
        }).format(new Date()));
        return jstHour >= 19 || jstHour < 7;
      } catch (e) { return false; }
    },

    prefersDarkDevice() {
      try { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
      catch (e) { return false; }
    },

    resolvedTheme() {
      if (this.prefs.theme === "light") return "light";
      if (this.prefs.theme === "dark") return "dark";
      if (this.prefs.theme === "auto-device") return this.prefersDarkDevice() ? "dark" : "light";
      return this.isJapanNight() ? "dark" : "light"; // "auto" — JST-based
    },

    // compactAuto (default true) means "follow the device": compact mode
    // tracks the same <=767px breakpoint responsive.css already uses for
    // phone layout, re-evaluated on every load/resize. The moment the
    // visitor explicitly flips the "Compact mode" checkbox in settings,
    // compactAuto is set to false and their explicit choice (prefs.compact)
    // takes over permanently — "auto on mobile unless they switch it off".
    resolvedCompact() {
      if (!this.prefs.compactAuto) return !!this.prefs.compact;
      return isMobileViewport();
    },

    apply() {
      const root = document.documentElement;
      root.setAttribute("data-theme", this.resolvedTheme());
      document.body.setAttribute("data-compact", String(this.resolvedCompact()));
      document.body.setAttribute("data-ultra", String(!!this.prefs.ultra));
      root.setAttribute("data-tv", String(!!this.prefs.tv));
      root.setAttribute("data-contrast", this.prefs.contrast);
      const sakuraLayer = document.getElementById("sakuraLayer");
      if (sakuraLayer) sakuraLayer.classList.toggle("hidden", !this.prefs.sakura);
    },

    effectiveTimezone() {
      if (this.prefs.timezone && this.prefs.timezone !== "auto") return this.prefs.timezone;
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
      catch (e) { return "UTC"; }
    }
  };

  global.Settings = Settings;

  // Re-apply dark-mode-by-JST every 10 minutes in case "auto" crosses the boundary
  setInterval(() => { if (Settings.prefs.theme === "auto") Settings.apply(); }, 10 * 60 * 1000);

  // "auto-device" should react immediately when the OS/browser theme flips,
  // rather than waiting on the JST poll above (which only matters for "auto").
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (Settings.prefs.theme === "auto-device") Settings.apply();
    });
  } catch (e) { /* matchMedia change listener unsupported — auto-device just won't live-update */ }
  try {
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      if (!Settings.prefs.compactAuto) return; // user has an explicit choice — don't override it
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => Settings.apply(), 150);
    });
  } catch (e) { /* no-op */ }
})(window);
