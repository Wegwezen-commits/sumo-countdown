// streams.js — renders the "Live Streams" tab from data/streams.json.
// Every entry is rendered all the time (like videos.js), not gated behind
// a live basho — see git history / prior notes if curious why that
// changed. Per-card live/offline status (below) handles "nothing's on
// right now" per-channel instead.
//
// Live-status detection is genuinely different per platform:
//  - YouTube: checked automatically, no API key. YouTube's public oEmbed
//    endpoint (CORS-friendly, no auth) is asked about
//    https://www.youtube.com/channel/<channelId>/live — that URL redirects
//    to the current live video when the channel is live, and to the bare
//    channel page (which oEmbed can't describe as a video) otherwise. A
//    successful oEmbed response = live; a failure = offline. Known
//    community technique, not an official "is-live" API — best-effort.
//  - Twitch and "generic": there is no public, keyless way to check live
//    status OR viewer count from a browser (Twitch's real API needs an
//    app Client-ID + access token, which can't be safely held client-side
//    on a static site). By default these fall back to the "assumeLive"
//    flag in data/streams.json (manual on/off, no viewer count).
//
// OPTIONAL: VIEWER_STATS_ENDPOINT. If you deploy a small Cloudflare Worker
// (or any tiny backend) that holds a Twitch app Client-ID/token and
// exposes GET <endpoint>?platform=twitch&channel=<name> returning JSON
// { live: bool, viewers: number|null, title: string|null }, set its URL
// below and this file will use it automatically for Twitch/generic
// entries instead of "assumeLive" — real live status AND viewer counts,
// no manual toggling. Leave it "" to keep using assumeLive (default,
// works with zero setup).
const VIEWER_STATS_ENDPOINT = "";

// DEAD-CHANNEL CHECK: on every load, each enabled YouTube entry is pinged
// the same CORS-friendly way its live status is already checked, and
// hidden for this session if it 404s (very likely deleted/renamed). Same
// caveat as videos.js: can't do this for Twitch/Rumble/website entries —
// no public CORS-friendly way to ask — those still need manual review.
(function (global) {
  "use strict";

  const DATA_URL = "data/streams.json";
  const YT_OEMBED_TIMEOUT_MS = 6000;
  const REFRESH_MS = 3 * 60 * 1000; // re-check live status every 3 minutes while shown

  const STATUS_ORDER = { Active: 0, Occasional: 1, Intermittent: 2, Historical: 3 };

  let entries = null; // loaded once, cached
  let aliveIds = null; // Set — YouTube entries confirmed reachable this session
  let refreshTimer = null;
  let els = null;
  let filters = { category: "all", language: "all", liveOnly: false };
  let lastStatuses = []; // cached render input, so filter changes don't refetch

  function cacheEls() {
    if (els) return els;
    els = {
      grid: document.getElementById("streamsGrid"),
      filterBar: document.getElementById("streamsFilterBar")
    };
    return els;
  }

  async function loadData() {
    if (entries) return entries;
    try {
      const json = await SumoUtil.fetchJSON(DATA_URL);
      entries = (json.streams || []).filter((s) => !s.disabled);
    } catch (e) {
      entries = [];
    }
    return entries;
  }

  function withTimeout(promiseFactory, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return promiseFactory(controller.signal).finally(() => clearTimeout(timer));
  }

  async function checkYouTubeLive(channelId) {
    const liveUrl = `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live`;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(liveUrl)}&format=json`;
    try {
      const res = await withTimeout((signal) => fetch(oembedUrl, { signal, cache: "no-cache" }), YT_OEMBED_TIMEOUT_MS);
      if (!res.ok) return { live: false, reachable: true };
      const data = await res.json();
      return { live: true, reachable: true, title: data.title };
    } catch (e) {
      return { live: false, reachable: null }; // network hiccup — unknown, not necessarily dead
    }
  }

  // Separate, cheap "does the channel itself still exist" check (independent
  // of live status) via the channel page's own oEmbed — used for the
  // dead-channel sweep so an offline (but real) channel doesn't get hidden.
  async function checkYouTubeChannelAlive(channelId) {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/channel/${channelId}`)}&format=json`;
    try {
      const res = await withTimeout((signal) => fetch(oembedUrl, { signal, cache: "no-cache" }), YT_OEMBED_TIMEOUT_MS);
      return res.ok;
    } catch (e) {
      return true; // network hiccup / offline — don't punish the channel for it
    }
  }

  async function refreshAliveSet(data) {
    const ytEntries = data.filter((e) => e.platform === "youtube");
    const results = await Promise.all(ytEntries.map(async (e) => [e.id, await checkYouTubeChannelAlive(e.channelId)]));
    aliveIds = new Set(results.filter(([, ok]) => ok).map(([id]) => id));
  }

  async function checkViewerStats(entry) {
    if (!VIEWER_STATS_ENDPOINT) return null;
    const url = `${VIEWER_STATS_ENDPOINT}?platform=${encodeURIComponent(entry.platform)}&channel=${encodeURIComponent(entry.channelName || "")}`;
    try {
      const res = await withTimeout((signal) => fetch(url, { signal, cache: "no-cache" }), YT_OEMBED_TIMEOUT_MS);
      if (!res.ok) return null;
      return await res.json(); // { live, viewers, title }
    } catch (e) {
      return null;
    }
  }

  async function resolveStatus(entry) {
    if (entry.platform === "youtube") {
      const result = await checkYouTubeLive(entry.channelId);
      return { ...entry, live: result.live, title: result.title, viewers: null };
    }
    // Twitch / generic: use the viewer-stats worker if configured, else
    // fall back to the manual "assumeLive" flag (no viewer count).
    const stats = await checkViewerStats(entry);
    if (stats) return { ...entry, live: !!stats.live, viewers: stats.viewers ?? null, title: stats.title || null };
    return { ...entry, live: !!entry.assumeLive, viewers: null };
  }

  function embedUrlFor(entry) {
    if (entry.platform === "youtube") {
      return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(entry.channelId)}&autoplay=1`;
    }
    if (entry.platform === "twitch") {
      const parent = encodeURIComponent(window.location.hostname || "localhost");
      return `https://player.twitch.tv/?channel=${encodeURIComponent(entry.channelName)}&parent=${parent}&autoplay=true`;
    }
    return entry.embedUrl || "";
  }

  function platformLabel(platform) {
    if (platform === "youtube") return "YouTube";
    if (platform === "twitch") return "Twitch";
    if (platform === "generic") return "Web";
    return "Live";
  }

  function badgeHTML(entry) {
    const bits = [];
    if (entry.official) bits.push(`<span class="video-badge video-badge-official" data-i18n="officialBadge">Official</span>`);
    if (entry.language) bits.push(`<span class="video-badge">${entry.language === "ja" ? "日本語" : "English"}</span>`);
    return bits.join("");
  }

  function cardHTML(status) {
    const label = SumoUtil.escapeHTML(status.label || "");
    const plat = platformLabel(status.platform);
    const badges = badgeHTML(status);
    const openUrl = SumoUtil.escapeHTML(status.channelUrl || "#");
    const src = SumoUtil.escapeHTML(embedUrlFor(status));
    if (status.live) {
      const viewers = typeof status.viewers === "number"
        ? `<span class="stream-viewers">👥 ${status.viewers.toLocaleString()}</span>` : "";
      return `
        <div class="stream-card pixel-corners is-live" data-embed-src="${src}">
          <div class="stream-card-head">
            <span class="stream-platform">${plat}</span>
            <span class="live-badge stream-live-dot"><span class="dot" aria-hidden="true"></span> ${I18n.t("liveBadge")}</span>
          </div>
          <div class="stream-embed-wrap">
            <div class="stream-embed-poster">
              ${viewers}
              <button type="button" class="ghost-button stream-watch-btn" data-i18n="watchEmbedded">Watch Embedded</button>
            </div>
          </div>
          <div class="stream-card-badges">${badges}</div>
          <div class="stream-card-foot">
            <span>${label}</span>
            <a href="${openUrl}" target="_blank" rel="noopener noreferrer">${I18n.t("openOnPlatform", { platform: plat })}</a>
          </div>
        </div>`;
    }
    return `
      <div class="stream-card pixel-corners is-offline">
        <div class="stream-card-head">
          <span class="stream-platform">${plat}</span>
        </div>
        <div class="stream-offline-sign">
          <span class="stream-offline-text" data-i18n="streamOffline">OFFLINE</span>
        </div>
        <div class="stream-card-badges">${badges}</div>
        <div class="stream-card-foot">
          <span>${label}</span>
          <a href="${openUrl}" target="_blank" rel="noopener noreferrer">${I18n.t("openOnPlatform", { platform: plat })}</a>
        </div>
      </div>`;
  }

  function wireWatchButtons(container) {
    container.querySelectorAll(".stream-watch-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".stream-card");
        const src = card && card.getAttribute("data-embed-src");
        const wrap = card && card.querySelector(".stream-embed-wrap");
        if (!src || !wrap) return;
        wrap.innerHTML = `<iframe class="stream-embed" src="${src}" title="stream"
          loading="lazy" allow="autoplay; encrypted-media; picture-in-picture"
          allowfullscreen frameborder="0"></iframe>`;
      });
    });
  }

  function visibleStatuses() {
    const showInactive = !!(global.Settings && Settings.prefs.showInactiveChannels);
    return lastStatuses
      .filter((e) => showInactive || e.status !== "Historical")
      .filter((e) => e.platform !== "youtube" || !aliveIds || aliveIds.has(e.id))
      .filter((e) => filters.category === "all" || e.category === filters.category)
      .filter((e) => filters.language === "all" || e.language === filters.language)
      .filter((e) => !filters.liveOnly || e.live)
      .sort((a, b) => {
        if (!!b.live !== !!a.live) return (b.live ? 1 : 0) - (a.live ? 1 : 0);
        if (!!b.official !== !!a.official) return (b.official ? 1 : 0) - (a.official ? 1 : 0);
        const rankA = a.communityRank == null ? Infinity : a.communityRank;
        const rankB = b.communityRank == null ? Infinity : b.communityRank;
        if (rankA !== rankB) return rankA - rankB;
        const statusA = STATUS_ORDER[a.status] ?? 9;
        const statusB = STATUS_ORDER[b.status] ?? 9;
        if (statusA !== statusB) return statusA - statusB;
        return (a.label || "").localeCompare(b.label || "");
      });
  }

  function renderFilterBar(data) {
    const list = cacheEls();
    if (!list.filterBar) return;
    const categories = Array.from(new Set(data.map((e) => e.category).filter(Boolean))).sort();
    list.filterBar.innerHTML = `
      <select id="streamsFilterCategory" class="mini filter-select">
        <option value="all" data-i18n="filterAllCategories">All categories</option>
        ${categories.map((c) => `<option value="${SumoUtil.escapeHTML(c)}">${SumoUtil.escapeHTML(c)}</option>`).join("")}
      </select>
      <select id="streamsFilterLanguage" class="mini filter-select">
        <option value="all" data-i18n="filterAllLanguages">All languages</option>
        <option value="en">English</option>
        <option value="ja">日本語</option>
      </select>
      <label class="filter-checkbox">
        <input type="checkbox" id="streamsFilterLive" />
        <span data-i18n="filterLiveNow">Live now</span>
      </label>
    `;
    document.getElementById("streamsFilterCategory").addEventListener("change", (e) => { filters.category = e.target.value; renderFromCache(); });
    document.getElementById("streamsFilterLanguage").addEventListener("change", (e) => { filters.language = e.target.value; renderFromCache(); });
    document.getElementById("streamsFilterLive").addEventListener("change", (e) => { filters.liveOnly = e.target.checked; renderFromCache(); });
    if (global.I18n) I18n.applyStaticText();
  }

  function renderFromCache() {
    const list = cacheEls();
    if (!list.grid) return;
    const visible = visibleStatuses();
    list.grid.innerHTML = visible.length
      ? visible.map(cardHTML).join("")
      : `<p class="filter-empty" data-i18n="filterNoResults">No channels match these filters.</p>`;
    wireWatchButtons(list.grid);
    if (global.I18n) I18n.applyStaticText();
  }

  async function renderGrid() {
    const list = cacheEls();
    if (!list.grid) return;
    const data = await loadData();
    if (!data.length) {
      list.grid.innerHTML = "";
      return;
    }
    renderFilterBar(data);
    lastStatuses = await Promise.all(data.map(resolveStatus));
    renderFromCache();
    refreshAliveSet(data).then(renderFromCache);
  }

  function init() {
    renderGrid();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(renderGrid, REFRESH_MS);
    document.addEventListener("prefschange", (e) => {
      if (e.detail && e.detail.key === "showInactiveChannels") renderFromCache();
    });
  }

  global.Streams = { init, render: renderFromCache, refresh: renderGrid };
})(window);
