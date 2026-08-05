// sumoapi.js — thin client for sumo-api.com (https://www.sumo-api.com),
// a free, independently-run public API for real sumo data (not affiliated
// with the JSA). Confirmed to support cross-origin browser fetches (CORS)
// before wiring this in. Used for two things this site couldn't show
// before: the actual banzuke rank list (js/app.js's Banzuke panel), and
// the day's torikumi/bout list (js/torikumi.js).
//
// bashoId format for this API is "YYYYMM" (e.g. "202609"), not this app's
// own "YYYY-MM" id (e.g. "2026-09") — toApiBashoId() converts.
//
// Caching: short-TTL (see CACHE_TTL_MS) via SumoUtil.storage, same pattern
// as js/news.js. This data can change during a live basho (new torikumi
// posted, results coming in through the evening JST), so the TTL is much
// shorter than, say, the schedule cache — but still long enough that
// re-opening the app a few times in a row doesn't hammer someone else's
// free API.
(function (global) {
  "use strict";

  const API_BASE = "https://www.sumo-api.com/api";
  const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
  const FETCH_TIMEOUT_MS = 8000;

  function toApiBashoId(appBashoId) {
    return (appBashoId || "").replace("-", "");
  }

  function cacheKey(path) { return `sumoapi:${path}`; }

  function withTimeout(promiseFactory, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return promiseFactory(controller.signal).finally(() => clearTimeout(timer));
  }

  async function getJSON(path) {
    const key = cacheKey(path);
    const cached = SumoUtil.storage.get(key, null);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

    try {
      const res = await withTimeout(
        (signal) => fetch(`${API_BASE}${path}`, { signal, cache: "no-cache" }),
        FETCH_TIMEOUT_MS
      );
      if (!res.ok) throw new Error(`sumo-api ${path} -> ${res.status}`);
      const data = await res.json();
      SumoUtil.storage.set(key, { data, at: Date.now() });
      return data;
    } catch (e) {
      // Serve a stale cache entry over a hard failure, if one exists —
      // better a slightly old banzuke/torikumi than none at all.
      if (cached) return cached.data;
      throw e;
    }
  }

  const SumoAPI = {
    toApiBashoId,

    // { bashoId, division, east: [{ rikishiID, shikonaEn, rank, rankValue, record: [...] }], west: [...] }
    async getBanzuke(appBashoId, division) {
      return getJSON(`/basho/${toApiBashoId(appBashoId)}/banzuke/${division || "Makuuchi"}`);
    },

    // { date, division, day, torikumi: [{ east, west, eastShikona, westShikona, kimarite, winnerEn, ... }] }
    async getTorikumi(appBashoId, division, day) {
      return getJSON(`/basho/${toApiBashoId(appBashoId)}/torikumi/${division || "Makuuchi"}/${day}`);
    },

    // Tournament results — yusho (championship) winners per division and
    // special prizes (sansho). FIELD NAMES NOT INDEPENDENTLY CONFIRMED —
    // I couldn't get a live sample of this specific endpoint's shape while
    // building this (only that it exists and returns "yusho winners,
    // special prizes", per a third-party app's own README). js/previousbasho.js
    // tries several plausible key names defensively; verify against a
    // real response (browser devtools Network tab) if the display looks
    // wrong once deployed.
    async getBashoResult(appBashoId) {
      return getJSON(`/basho/${toApiBashoId(appBashoId)}`);
    },

    // Single rikishi's profile — used for the tap-a-name popup (see
    // js/rikishi.js). Shape per that same third-party app plus sumo-api's
    // own guide: { rikishiID, shikonaEn, shikonaJp, currentRank, heya,
    // height, weight, birthDate, debut, ... } — also best-effort on the
    // less-central fields.
    async getRikishi(rikishiId) {
      return getJSON(`/rikishi/${encodeURIComponent(rikishiId)}`);
    }
  };

  global.SumoAPI = SumoAPI;
})(window);
