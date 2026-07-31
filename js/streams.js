// streams.js — renders the "Live Streams" panel from data/streams.json.
// The panel only shows real content while a basho is live (Schedule.getLive);
// otherwise it collapses to a "back for the next basho" message — see
// render() below.
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
//    flag in data/streams.json instead — see that file's _readme.
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
      panel: document.getElementById("streamsPanel"),
      grid: document.getElementById("streamsGrid"),
      offlineMsg: document.getElementById("streamsBackMessage")
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

  function showBackMessage() {
    const list = cacheEls();
    if (!list.panel) return;
    list.panel.classList.add("streams-idle");
    if (list.grid) list.grid.innerHTML = "";
    if (list.offlineMsg) list.offlineMsg.classList.remove("hidden");
  }

  function showLive() {
    const list = cacheEls();
    if (!list.panel) return;
    list.panel.classList.remove("streams-idle");
    if (list.offlineMsg) list.offlineMsg.classList.add("hidden");
    renderGrid();
  }

  async function render(now) {
    const list = cacheEls();
    if (!list.panel) return;
    const liveBasho = Schedule && typeof Schedule.getLive === "function" ? Schedule.getLive(now || new Date()) : null;
    if (liveBasho) showLive(); else showBackMessage();
  }

  function init() {
    render(new Date());
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => render(new Date()), REFRESH_MS);
  }

  global.Streams = { init, render };
})(window);
