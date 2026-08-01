// streams.js — renders the "Live Streams" tab from data/streams.json.
// Every entry is rendered all the time (like videos.js) — this used to be
// gated behind Schedule.getLive() (basho in progress), on the assumption
// that these channels only have anything worth showing during a live
// tournament. That assumption doesn't hold: some of these channels (e.g.
// Twitch streamers running reruns/replays between tournaments) are
// genuinely online outside honbasho, and — more importantly — the
// basho-gate was suppressing the *entire* panel including YouTube entries'
// real, automatic live-detection below, so an actual live stream (say, an
// amateur tournament or exhibition match outside the regular calendar)
// would never show just because our own schedule didn't know about it.
// Per-card live/offline status already handles "nothing's on right now"
// correctly (see cardHTML's is-offline branch) — no need for a second,
// coarser gate on top of it.
//
// Live-status detection is genuinely different per platform:
//  - YouTube: checked automatically, no API key. YouTube's public oEmbed
//    endpoint (CORS-friendly, no auth) is asked about
//    https://www.youtube.com/channel/<channelId>/live — that URL redirects
//    to the current live video when the channel is live, and to the bare
//    channel page (which oEmbed can't describe as a video) otherwise. A
//    successful oEmbed response = live; a failure = offline. This is a
//    known community technique, not an official "is-live" API, so treat
//    it as best-effort — if YouTube ever changes this redirect behaviour,
//    entries will just fall back to showing as offline.
//  - Twitch and "generic": there is no public, keyless way to check live
//    status from a browser (Twitch's real status API needs an app
//    Client-ID + access token, which can't be safely held client-side on
//    a static site). These platforms are controlled by the "assumeLive"
//    flag in data/streams.json instead — see that file's _readme. Since
//    this tab is no longer basho-gated, it's fine (and expected) to flip
//    assumeLive:true for a channel that's running reruns between
//    tournaments too, not just for actual live bouts.
(function (global) {
  "use strict";

  const DATA_URL = "data/streams.json";
  const YT_OEMBED_TIMEOUT_MS = 6000;
  const REFRESH_MS = 3 * 60 * 1000; // re-check live status every 3 minutes while shown

  let entries = null; // loaded once, cached
  let refreshTimer = null;
  let els = null;

  function cacheEls() {
    if (els) return els;
    els = {
      grid: document.getElementById("streamsGrid")
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

  async function checkYouTubeLive(channelId) {
    const liveUrl = `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live`;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(liveUrl)}&format=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), YT_OEMBED_TIMEOUT_MS);
    try {
      const res = await fetch(oembedUrl, { signal: controller.signal, cache: "no-cache" });
      if (!res.ok) return { live: false };
      const data = await res.json();
      return { live: true, title: data.title, thumbnail: data.thumbnail_url };
    } catch (e) {
      return { live: false };
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveStatus(entry) {
    if (entry.platform === "youtube") {
      const result = await checkYouTubeLive(entry.channelId);
      return { ...entry, live: result.live, title: result.title };
    }
    // Twitch / generic: no keyless live-check available — see file header.
    return { ...entry, live: !!entry.assumeLive };
  }

  function embedUrlFor(entry) {
    if (entry.platform === "youtube") {
      return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(entry.channelId)}&autoplay=0`;
    }
    if (entry.platform === "twitch") {
      const parent = encodeURIComponent(window.location.hostname || "localhost");
      return `https://player.twitch.tv/?channel=${encodeURIComponent(entry.channelName)}&parent=${parent}&autoplay=false`;
    }
    return entry.embedUrl || "";
  }

  function platformLabel(platform) {
    if (platform === "youtube") return "YouTube";
    if (platform === "twitch") return "Twitch";
    return "Live";
  }

  function cardHTML(status) {
    const label = SumoUtil.escapeHTML(status.label || "");
    const plat = platformLabel(status.platform);
    if (status.live) {
      const src = embedUrlFor(status);
      return `
        <div class="stream-card pixel-corners is-live">
          <div class="stream-card-head">
            <span class="stream-platform">${plat}</span>
            <span class="live-badge stream-live-dot"><span class="dot" aria-hidden="true"></span> ${I18n.t("liveBadge")}</span>
          </div>
          <div class="stream-embed-wrap">
            <iframe class="stream-embed" src="${src}" title="${label}"
              loading="lazy" allow="autoplay; encrypted-media; picture-in-picture"
              allowfullscreen frameborder="0"></iframe>
          </div>
          <div class="stream-card-foot">${label}</div>
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
        <div class="stream-card-foot">${label}</div>
      </div>`;
  }

  async function renderGrid() {
    const list = cacheEls();
    if (!list.grid) return;
    const data = await loadData();
    if (!data.length) {
      list.grid.innerHTML = "";
      return;
    }
    const statuses = await Promise.all(data.map(resolveStatus));
    list.grid.innerHTML = statuses.map(cardHTML).join("");
  }

  function init() {
    renderGrid();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(renderGrid, REFRESH_MS);
  }

  global.Streams = { init, render: renderGrid };
})(window);
