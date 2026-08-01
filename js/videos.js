// videos.js — renders the "Videos" tab (see index.html #videosTabPanel) from
// data/videos.json. Not gated behind a live basho — highlight/analysis
// channels have content year-round.
//
// Each enabled entry with a channelId gets embedded as that channel's
// uploads playlist (https://www.youtube.com/embed/videoseries?list=UU...) —
// YouTube channel IDs start with "UC"; swapping that prefix for "UU" gives
// the auto-generated "all uploads" playlist ID for the same channel, which
// always shows the most recent video first and updates itself as they
// post. Entries without a channelId yet render as a plain "open channel"
// link card instead of a broken embed (see data/videos.json's notes for
// which, and why).
//
// FILTERING/SORTING: there's no analytics source behind "ReliabilityScore"/
// "DiscoveryScore" as concepts, so this doesn't fabricate numbers for them.
// Instead it sorts on the real fields data/videos.json actually has —
// official (desc), communityRank (asc, unranked last), status (Active >
// Occasional > Intermittent > Historical) — which approximates the same
// intent (official + well-established + currently active first).
//
// INACTIVE CHANNELS: entries with status "Historical" are hidden unless
// Settings.prefs.showInactiveChannels is on (Settings > Show inactive
// channels). This is separate from "disabled" in the JSON, which is a
// hard, non-toggleable gate for unverified/non-embeddable entries.
//
// DEAD-CHANNEL CHECK: on every load, each enabled YouTube entry's uploads
// playlist is pinged via YouTube's public oEmbed endpoint (same
// CORS-friendly, keyless mechanism streams.js uses for live-detection). If
// it 404s, the channel is very likely deleted/renamed, so it's hidden for
// this session rather than shown as a broken embed. This can't run for
// Twitch/Rumble/website entries — no public CORS-friendly way to ask — so
// those still need periodic manual review of data/videos.json.
(function (global) {
  "use strict";

  const DATA_URL = "data/videos.json";
  const OEMBED_TIMEOUT_MS = 6000;

  const STATUS_ORDER = { Active: 0, Occasional: 1, Intermittent: 2, Historical: 3 };

  let allEntries = null; // everything from the JSON, disabled ones already dropped
  let aliveIds = null;   // Set of ids confirmed reachable this session (null = not checked yet)
  let grid = null, filterBar = null;
  let filters = { category: "all", language: "all", official: false, platform: "all" };

  function cacheEls() {
    if (!grid) grid = document.getElementById("videosGrid");
    if (!filterBar) filterBar = document.getElementById("videosFilterBar");
    return grid;
  }

  async function loadData() {
    if (allEntries) return allEntries;
    try {
      const json = await SumoUtil.fetchJSON(DATA_URL);
      allEntries = (json.videos || []).filter((v) => !v.disabled);
    } catch (e) {
      allEntries = [];
    }
    return allEntries;
  }

  function uploadsPlaylistId(channelId) {
    if (!channelId || channelId.slice(0, 2) !== "UC") return null;
    return "UU" + channelId.slice(2);
  }

  function uploadsPlaylistEmbed(channelId) {
    const playlistId = uploadsPlaylistId(channelId);
    return playlistId ? `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(playlistId)}` : "";
  }

  function withTimeout(promiseFactory, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return promiseFactory(controller.signal).finally(() => clearTimeout(timer));
  }

  // Returns true if the channel's uploads playlist still resolves.
  // Entries without a channelId (link-only cards) are never checked/hidden
  // this way — there's nothing to ping.
  async function checkAlive(entry) {
    const playlistId = uploadsPlaylistId(entry.channelId);
    if (!playlistId) return true;
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/playlist?list=${playlistId}`)}&format=json`;
    try {
      const res = await withTimeout((signal) => fetch(url, { signal, cache: "no-cache" }), OEMBED_TIMEOUT_MS);
      return res.ok;
    } catch (e) {
      return true; // network hiccup / offline — don't punish the channel for it
    }
  }

  async function refreshAliveSet(entries) {
    const results = await Promise.all(entries.map(async (e) => [e.id, await checkAlive(e)]));
    aliveIds = new Set(results.filter(([, ok]) => ok).map(([id]) => id));
  }

  function visibleEntries() {
    const showInactive = !!(global.Settings && Settings.prefs.showInactiveChannels);
    return (allEntries || [])
      .filter((e) => showInactive || e.status !== "Historical")
      .filter((e) => !aliveIds || aliveIds.has(e.id))
      .filter((e) => filters.category === "all" || e.category === filters.category)
      .filter((e) => filters.language === "all" || e.language === filters.language)
      .filter((e) => filters.platform === "all" || (e.channelUrl || "").includes(filters.platform))
      .filter((e) => !filters.official || e.official)
      .sort((a, b) => {
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

  function badgeHTML(entry) {
    const bits = [];
    if (entry.official) bits.push(`<span class="video-badge video-badge-official" data-i18n="officialBadge">Official</span>`);
    if (entry.category) bits.push(`<span class="video-badge">${SumoUtil.escapeHTML(entry.category)}</span>`);
    if (entry.language) bits.push(`<span class="video-badge">${entry.language === "ja" ? "日本語" : "EN"}</span>`);
    return bits.join("");
  }

  function cardHTML(entry) {
    const label = SumoUtil.escapeHTML(entry.label || "");
    const channelUrl = SumoUtil.escapeHTML(entry.channelUrl || "#");
    const contentType = SumoUtil.escapeHTML(entry.contentType || "");
    const src = uploadsPlaylistEmbed(entry.channelId);
    const badges = badgeHTML(entry);
    if (src) {
      return `
        <div class="video-card pixel-corners">
          <div class="video-embed-wrap">
            <iframe class="video-embed" src="${src}" title="${label}"
              loading="lazy" allow="autoplay; encrypted-media; picture-in-picture"
              allowfullscreen frameborder="0"></iframe>
          </div>
          <div class="video-card-badges">${badges}</div>
          <div class="video-card-foot">
            <span class="video-card-label">${label}${contentType ? ` <span class="video-card-subtitle">— ${contentType}</span>` : ""}</span>
            <a class="video-card-link" href="${channelUrl}" target="_blank" rel="noopener noreferrer" data-i18n="openChannel">Open channel</a>
          </div>
        </div>`;
    }
    return `
      <a class="video-card video-card-linkonly pixel-corners" href="${channelUrl}" target="_blank" rel="noopener noreferrer">
        <div class="video-card-badges">${badges}</div>
        <div class="video-card-linkonly-body">
          <span class="video-card-label">${label}</span>
          <span class="video-card-link" data-i18n="openChannel">Open channel</span>
        </div>
      </a>`;
  }

  function renderFilterBar() {
    if (!filterBar || !allEntries) return;
    const categories = Array.from(new Set(allEntries.map((e) => e.category).filter(Boolean))).sort();
    filterBar.innerHTML = `
      <select id="videosFilterCategory" class="mini filter-select">
        <option value="all" data-i18n="filterAllCategories">All categories</option>
        ${categories.map((c) => `<option value="${SumoUtil.escapeHTML(c)}">${SumoUtil.escapeHTML(c)}</option>`).join("")}
      </select>
      <select id="videosFilterLanguage" class="mini filter-select">
        <option value="all" data-i18n="filterAllLanguages">All languages</option>
        <option value="en">English</option>
        <option value="ja">日本語</option>
      </select>
      <label class="filter-checkbox">
        <input type="checkbox" id="videosFilterOfficial" />
        <span data-i18n="filterOfficialOnly">Official only</span>
      </label>
    `;
    document.getElementById("videosFilterCategory").addEventListener("change", (e) => { filters.category = e.target.value; render(); });
    document.getElementById("videosFilterLanguage").addEventListener("change", (e) => { filters.language = e.target.value; render(); });
    document.getElementById("videosFilterOfficial").addEventListener("change", (e) => { filters.official = e.target.checked; render(); });
    if (global.I18n) I18n.applyStaticText();
  }

  function render() {
    if (!cacheEls()) return;
    const visible = visibleEntries();
    if (!visible.length) {
      grid.innerHTML = `<p class="filter-empty" data-i18n="filterNoResults">No channels match these filters.</p>`;
    } else {
      grid.innerHTML = visible.map(cardHTML).join("");
    }
    if (global.I18n) I18n.applyStaticText();
  }

  async function init() {
    cacheEls();
    await loadData();
    renderFilterBar();
    render(); // show something immediately, before the dead-channel check finishes
    refreshAliveSet(allEntries).then(render);
    document.addEventListener("prefschange", (e) => {
      if (e.detail && e.detail.key === "showInactiveChannels") render();
    });
  }

  global.Videos = { init, render };
})(window);
