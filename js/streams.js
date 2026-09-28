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
// { exists: bool, live: bool, viewers: number|null, title: string|null },
// set its URL below and this file will use it automatically for Twitch/
// generic entries instead of "assumeLive" — real live status, viewer
// counts, AND dead-channel detection (see "exists"), no manual toggling.
// Leave it "" to keep using assumeLive (default, works with zero setup,
// but no viewer counts and no Twitch dead-channel detection).
const VIEWER_STATS_ENDPOINT = "https://sumo-viewer-stats.veeken-joost.workers.dev";

// HLS (.m3u8) PLAYBACK — platform "hls" entries play natively in a <video>
// element (hls.js, vendored in js/vendor/, everywhere except Apple Safari
// which plays HLS itself). Two browser rules matter here:
//  - MIXED CONTENT: this site is served over https, so a plain http://
//    stream URL is blocked outright. Same for CORS: hls.js fetches the
//    playlist/segments with XHR, so the origin must send CORS headers.
//  - Fix for both: deploy workers/hls-proxy.js (see its header comment)
//    and put its URL below. Entries with an http:// hlsUrl (or with
//    "useProxy": true) are routed through it. Leave "" to disable — such
//    entries then render a "needs proxy" card instead of a broken player.
const HLS_PROXY_ENDPOINT = "https://hls-proxy.veeken-joost.workers.dev/";
const HLS_LIB_URL = "js/vendor/hls.light.min.js";
const HLS_PROBE_TIMEOUT_MS = 12000; // stream servers are often slower than YouTube's oEmbed

// DEAD-CHANNEL CHECK: on every load, each enabled YouTube entry is pinged
// the same CORS-friendly way its live status is already checked, and
// hidden for this session if it 404s (very likely deleted/renamed).
// Twitch entries get the same treatment IF VIEWER_STATS_ENDPOINT is
// configured (see its "exists" field above) — that Worker holds real
// Twitch credentials, so it can actually ask Twitch whether the channel
// exists, which a browser can't do directly. Without that endpoint
// configured, Twitch/generic/Rumble/website entries still can't be
// checked at all and need manual review.
(function (global) {
  "use strict";

  const DATA_URL = "data/streams.json";
  const YT_OEMBED_TIMEOUT_MS = 6000;
  const REFRESH_MS = 3 * 60 * 1000; // re-check live status every 3 minutes while shown

  const STATUS_ORDER = { Active: 0, Occasional: 1, Intermittent: 2, Historical: 3 };

  const LIVE_ONLY_KEY = "streamsLiveOnlyFilter";
  const CATEGORY_KEY = "streamsCategoryFilter";
  const LANGUAGE_KEY = "streamsLanguageFilter";

  let entries = null; // loaded once, cached
  let aliveIds = null; // Set — entries (YouTube + Twitch) confirmed reachable this session; null until the first check completes
  let refreshTimer = null;
  let els = null;
  // liveOnly defaults to true — only show currently-live streams by
  // default (offline cards used to clutter the tab most of the time,
  // since most channels aren't live most hours of the day). The "Live
  // now" checkbox below is really an "include offline too" toggle in
  // practice; persisted so the choice sticks across visits.
  let filters = {
    category: SumoUtil.storage.get(CATEGORY_KEY, "all"),
    language: SumoUtil.storage.get(LANGUAGE_KEY, "all"),
    liveOnly: SumoUtil.storage.get(LIVE_ONLY_KEY, true)
  };
  let lastStatuses = []; // cached render input, so filter changes don't refetch
  const hlsInstances = new Set(); // live hls.js players, destroyed before any re-render so nothing leaks

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

  // Combines YouTube's own dead-channel check (a dedicated oEmbed ping)
  // with Twitch's, which piggybacks on the viewer-stats worker instead of
  // a separate request — see VIEWER_STATS_ENDPOINT's v2 "exists" field.
  // `statuses` is `lastStatuses` — already has that field for any Twitch
  // entry once resolveStatus() has run once.
  async function refreshAliveSet(statuses) {
    const ytEntries = statuses.filter((e) => e.platform === "youtube");
    const ytResults = await Promise.all(ytEntries.map(async (e) => [e.id, await checkYouTubeChannelAlive(e.channelId)]));
    const dead = new Set(ytResults.filter(([, ok]) => !ok).map(([id]) => id));
    // Twitch: only mark dead if the worker positively said exists:false.
    // No worker configured, or the check failed for that entry -> exists
    // is undefined -> treated as alive (same permissive default as
    // before this existed), since "unknown" shouldn't hide a channel.
    statuses.forEach((e) => { if (e.platform === "twitch" && e.exists === false) dead.add(e.id); });
    aliveIds = new Set(statuses.map((e) => e.id).filter((id) => !dead.has(id)));
  }

  async function checkViewerStats(entry) {
    if (!VIEWER_STATS_ENDPOINT) return null;
    const url = `${VIEWER_STATS_ENDPOINT}?platform=${encodeURIComponent(entry.platform)}&channel=${encodeURIComponent(entry.channelName || "")}`;
    try {
      const res = await withTimeout((signal) => fetch(url, { signal, cache: "no-cache" }), YT_OEMBED_TIMEOUT_MS);
      if (!res.ok) return null;
      return await res.json(); // { exists, live, viewers, title }
    } catch (e) {
      return null;
    }
  }

  // HLS entries: probe the (possibly proxied) playlist itself. A valid
  // #EXTM3U body = live; anything else (CORS block, 4xx/5xx, timeout,
  // no proxy for an http:// source) = offline, which is also exactly
  // when playback would fail, so the card never promises a dead player.
  async function checkHlsLive(src, label) {
    if (!src) return false;
    try {
      const res = await withTimeout((signal) => fetch(src, { signal, cache: "no-cache" }), HLS_PROBE_TIMEOUT_MS);
      if (!res.ok) {
        console.warn(`[streams] ${label}: playlist probe got HTTP ${res.status} from ${src}`);
        return false;
      }
      const ok = (await res.text()).trimStart().startsWith("#EXTM3U");
      if (!ok) console.warn(`[streams] ${label}: response wasn't an HLS playlist (${src})`);
      return ok;
    } catch (e) {
      console.warn(`[streams] ${label}: playlist probe failed (${e && e.name}: ${e && e.message}) — CORS block, timeout or network error. URL: ${src}`);
      return false;
    }
  }

  async function resolveStatus(entry) {
    if (entry.platform === "hls") {
      const src = hlsSourceFor(entry);
      // "assumeLive": true skips trusting the probe (same manual override
      // Twitch entries use) — the player then reports any real error.
      const live = (await checkHlsLive(src, entry.label)) || (!!src && entry.assumeLive === true);
      return { ...entry, live, viewers: null, needsProxy: !src };
    }
    if (entry.platform === "youtube") {
      const result = await checkYouTubeLive(entry.channelId);
      return { ...entry, live: result.live, title: result.title, viewers: null };
    }
    // Twitch / generic: use the viewer-stats worker if configured, else
    // fall back to the manual "assumeLive" flag (no viewer count, and
    // `exists` stays undefined — see refreshAliveSet for what that means).
    const stats = await checkViewerStats(entry);
    if (stats) return { ...entry, live: !!stats.live, viewers: stats.viewers ?? null, title: stats.title || null, exists: stats.exists };
    return { ...entry, live: !!entry.assumeLive, viewers: null };
  }

  // Resolves the URL the <video> should actually load. "" = can't be
  // played from this page (http:// source, https site, no proxy set).
  function hlsSourceFor(entry) {
    const raw = entry.hlsUrl || "";
    if (!raw) return "";
    const insecure = /^http:\/\//i.test(raw) && window.location.protocol === "https:";
    if (insecure || entry.useProxy) {
      return HLS_PROXY_ENDPOINT ? `${HLS_PROXY_ENDPOINT}?url=${encodeURIComponent(raw)}` : "";
    }
    return raw;
  }

  function embedUrlFor(entry) {
    if (entry.platform === "hls") return hlsSourceFor(entry);
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
    if (platform === "hls") return "HLS";
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
    if (status.needsProxy) {
      return `
      <div class="stream-card pixel-corners is-offline">
        <div class="stream-card-head">
          <span class="stream-platform">${plat}</span>
        </div>
        <div class="stream-offline-sign">
          <span class="stream-offline-text stream-needs-proxy" data-i18n="streamNeedsProxy">Can't play here</span>
        </div>
        <div class="stream-card-badges">${badges}</div>
        <div class="stream-card-foot">
          <span>${label}</span>
        </div>
      </div>`;
    }
    if (status.live) {
      const viewers = typeof status.viewers === "number"
        ? `<span class="stream-viewers">👥 ${status.viewers.toLocaleString()}</span>` : "";
      return `
        <div class="stream-card pixel-corners is-live" data-embed-src="${src}" data-embed-kind="${status.platform === "hls" ? "hls" : "iframe"}">
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
            ${status.channelUrl ? `<a href="${openUrl}" target="_blank" rel="noopener noreferrer">${I18n.t("openOnPlatform", { platform: plat })}</a>` : ""}
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

  // Set once the person clicks "Watch Embedded" on any card, and never
  // cleared again this session — see renderGrid() below for why. A false
  // positive here (still "active" after they've actually stopped
  // watching) just means other, unwatched cards' live/viewer-count
  // status goes a bit stale for the rest of the session, which is a far
  // smaller problem than resetting whatever they're actually watching.
  let embedActive = false;

  // ---- HLS player -------------------------------------------------------
  let hlsLibPromise = null;
  function loadHlsLib() {
    if (global.Hls) return Promise.resolve(global.Hls);
    if (!hlsLibPromise) {
      hlsLibPromise = new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = HLS_LIB_URL;
        tag.onload = () => resolve(global.Hls);
        tag.onerror = () => { hlsLibPromise = null; reject(new Error("hls.js failed to load")); };
        document.head.appendChild(tag);
      });
    }
    return hlsLibPromise;
  }

  // Apple Safari (macOS + every iOS browser/PWA) plays HLS natively, which
  // also gives AirPlay and lock-screen controls — prefer that there.
  function prefersNativeHls(video) {
    const isSafari = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
    return isSafari && !!video.canPlayType("application/vnd.apple.mpegurl");
  }

  function showPlayerError(wrap) {
    const msg = document.createElement("div");
    msg.className = "stream-embed-error";
    msg.textContent = global.I18n ? I18n.t("streamPlayError") : "Stream unavailable right now.";
    wrap.appendChild(msg);
  }

  function startPlayback(video) {
    const p = video.play();
    if (p && p.catch) {
      // Unmuted autoplay can still be refused (e.g. some PWA/webview
      // contexts). Fall back to muted rather than a dead first frame; the
      // native controls let the person unmute.
      p.catch(() => { video.muted = true; video.play().catch(() => {}); });
    }
  }

  async function mountHls(wrap, src) {
    destroyHls();
    wrap.innerHTML = `<video class="stream-embed stream-video" controls playsinline
      webkit-playsinline preload="auto"></video>`;
    const video = wrap.querySelector("video");
    try {
      if (prefersNativeHls(video)) {
        video.src = src;
        video.addEventListener("error", () => showPlayerError(wrap), { once: true });
        startPlayback(video);
        return;
      }
      const Hls = await loadHlsLib();
      if (!Hls.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = src; startPlayback(video); return; }
        throw new Error("HLS unsupported");
      }
      const hls = new Hls({ lowLatencyMode: false, liveSyncDurationCount: 3, maxBufferLength: 30 });
      hlsInstances.add(hls);
      let netRetries = 0;
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && netRetries++ < 3) {
          setTimeout(() => hls.startLoad(), 1000 * netRetries);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && netRetries++ < 3) {
          hls.recoverMediaError();
        } else {
          hls.destroy();
          hlsInstances.delete(hls);
          showPlayerError(wrap);
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => startPlayback(video));
      hls.loadSource(src);
      hls.attachMedia(video);
    } catch (e) {
      showPlayerError(wrap);
    }
  }

  function destroyHls() {
    hlsInstances.forEach((h) => { try { h.destroy(); } catch (e) { /* already gone */ } });
    hlsInstances.clear();
  }
  window.addEventListener("pagehide", destroyHls);

  function wireWatchButtons(container) {
    container.querySelectorAll(".stream-watch-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".stream-card");
        const src = card && card.getAttribute("data-embed-src");
        const wrap = card && card.querySelector(".stream-embed-wrap");
        if (!src || !wrap) return;
        if (card.getAttribute("data-embed-kind") === "hls") {
          mountHls(wrap, src);
          embedActive = true;
          return;
        }
        wrap.innerHTML = `<iframe class="stream-embed" src="${src}" title="stream"
          loading="lazy" allow="autoplay; encrypted-media; picture-in-picture"
          allowfullscreen frameborder="0"></iframe>`;
        embedActive = true;
      });
    });
  }

  function visibleStatuses() {
    const showInactive = !!(global.Settings && Settings.prefs.showInactiveChannels);
    return lastStatuses
      .filter((e) => showInactive || e.status !== "Historical")
      .filter((e) => !aliveIds || aliveIds.has(e.id))
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
        ${categories.map((c) => `<option value="${SumoUtil.escapeHTML(c)}" ${c === filters.category ? "selected" : ""}>${SumoUtil.escapeHTML(c)}</option>`).join("")}
      </select>
      <select id="streamsFilterLanguage" class="mini filter-select">
        <option value="all" data-i18n="filterAllLanguages">All languages</option>
        <option value="en" ${filters.language === "en" ? "selected" : ""}>English</option>
        <option value="ja" ${filters.language === "ja" ? "selected" : ""}>日本語</option>
      </select>
      <label class="filter-checkbox">
        <input type="checkbox" id="streamsFilterLive" ${filters.liveOnly ? "checked" : ""} />
        <span data-i18n="filterLiveNow">Live now</span>
      </label>
    `;
    document.getElementById("streamsFilterCategory").addEventListener("change", (e) => {
      filters.category = e.target.value;
      SumoUtil.storage.set(CATEGORY_KEY, filters.category);
      renderFromCache();
    });
    document.getElementById("streamsFilterLanguage").addEventListener("change", (e) => {
      filters.language = e.target.value;
      SumoUtil.storage.set(LANGUAGE_KEY, filters.language);
      renderFromCache();
    });
    document.getElementById("streamsFilterLive").addEventListener("change", (e) => {
      filters.liveOnly = e.target.checked;
      SumoUtil.storage.set(LIVE_ONLY_KEY, filters.liveOnly);
      renderFromCache();
    });
    if (global.I18n) I18n.applyStaticText();
  }

  function renderFromCache() {
    const list = cacheEls();
    if (!list.grid) return;
    const visible = visibleStatuses();
    destroyHls();
    list.grid.innerHTML = visible.length
      ? visible.map(cardHTML).join("")
      : `<p class="filter-empty" data-i18n="filterNoResults">No channels match these filters.</p>`;
    wireWatchButtons(list.grid);
    if (global.I18n) I18n.applyStaticText();
  }

  async function renderGrid() {
    const list = cacheEls();
    if (!list.grid) return;
    if (embedActive) return; // don't rebuild and reset whatever's currently playing — see the flag's own comment above
    const data = await loadData();
    if (!data.length) {
      list.grid.innerHTML = "";
      return;
    }
    renderFilterBar(data);
    lastStatuses = await Promise.all(data.map(resolveStatus));
    renderFromCache();
    refreshAliveSet(lastStatuses).then(renderFromCache);
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
