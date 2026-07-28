// util.js — small shared helpers, no dependencies.
(function (global) {
  "use strict";

  function pad(n) { return String(n).padStart(2, "0"); }

  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

  const STORAGE_PREFIX = "sumoCountdown:";
  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); }
      catch (e) { /* storage unavailable — fail silently */ }
    }
  };

  function formatDateRange(startISO, endISO, locale) {
    try {
      const start = new Date(startISO + "T00:00:00Z");
      const end = new Date(endISO + "T00:00:00Z");
      const opts = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };
      const startStr = start.toLocaleDateString(locale, opts);
      const endStr = end.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
      return `${endStr.split(" ").slice(0,2).join(" ")}–${start.getDate() === end.getDate() ? "" : ""}${startStr}`;
    } catch (e) {
      return `${startISO} – ${endISO}`;
    }
  }

  // Simpler, safer date-range formatter: "11–25 Jan 2026"
  function formatRange(startISO, endISO, locale) {
    const start = new Date(startISO + "T00:00:00Z");
    const end = new Date(endISO + "T00:00:00Z");
    const monthFmt = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
    if (sameMonth) {
      return `${start.getUTCDate()}–${end.getUTCDate()} ${monthFmt.format(start)} ${end.getUTCFullYear()}`;
    }
    return `${start.getUTCDate()} ${monthFmt.format(start)} – ${end.getUTCDate()} ${monthFmt.format(end)} ${end.getUTCFullYear()}`;
  }

  function daysBetween(aISO, bDate) {
    const a = new Date(aISO + "T00:00:00Z").getTime();
    const b = Date.UTC(bDate.getUTCFullYear(), bDate.getUTCMonth(), bDate.getUTCDate());
    return Math.round((a - b) / 86400000);
  }

  function fetchJSON(path) {
    return fetch(path, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
      return r.json();
    });
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  global.SumoUtil = { pad, clamp, storage, formatRange, daysBetween, fetchJSON, debounce };
})(window);
