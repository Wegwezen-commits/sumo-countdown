// settings.js — the single gear icon's panel: dark mode, sakura, audio,
// compact mode, language, timezone, large-display (TV) mode. All prefs
// are stored in localStorage via SumoUtil.storage.
(function (global) {
  "use strict";

  const DEFAULTS = {
    theme: "auto",       // "auto" | "light" | "dark"
    sakura: true,
    audio: false,
    music: false,
    volume: 60,
    compact: false,
    ultra: false,
    tv: false,
    timezone: "auto",
    contrast: "normal"
  };

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

    resolvedTheme() {
      if (this.prefs.theme === "light") return "light";
      if (this.prefs.theme === "dark") return "dark";
      return this.isJapanNight() ? "dark" : "light";
    },

    apply() {
      const root = document.documentElement;
      root.setAttribute("data-theme", this.resolvedTheme());
      document.body.setAttribute("data-compact", String(!!this.prefs.compact));
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
})(window);
