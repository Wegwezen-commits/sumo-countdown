// videos.js — renders the "Videos" tab (see index.html #videosTabPanel) from
// data/videos.json. Unlike streams.js, this is NOT gated behind a live
// basho — highlight/analysis channels have content year-round, so the tab
// always shows what it has.
//
// Each enabled entry with a channelId gets embedded as that channel's
// uploads playlist (https://www.youtube.com/embed/videoseries?list=UU...) —
// YouTube channel IDs start with "UC"; swapping that prefix for "UU" gives
// the auto-generated "all uploads" playlist ID for the same channel. That
// playlist embed always shows the channel's most recent video first and
// updates itself as they post, so there's nothing to keep in sync here.
// Entries without a channelId yet (see data/videos.json's "note" fields —
// mostly unverified handles, plus at least one channel no longer on
// YouTube at all) render as a plain "open channel" link card instead of a
// broken embed.
(function (global) {
  "use strict";

  const DATA_URL = "data/videos.json";

  let entries = null; // loaded once, cached
  let grid = null;

  function cacheEls() {
    if (!grid) grid = document.getElementById("videosGrid");
    return grid;
  }

  async function loadData() {
    if (entries) return entries;
    try {
      const json = await SumoUtil.fetchJSON(DATA_URL);
      entries = (json.videos || []).filter((v) => !v.disabled);
    } catch (e) {
      entries = [];
    }
    return entries;
  }

  function uploadsPlaylistEmbed(channelId) {
    if (!channelId || channelId.slice(0, 2) !== "UC") return "";
    const playlistId = "UU" + channelId.slice(2);
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(playlistId)}`;
  }

  function cardHTML(entry) {
    const label = SumoUtil.escapeHTML(entry.label || "");
    const channelUrl = SumoUtil.escapeHTML(entry.channelUrl || "#");
    const src = uploadsPlaylistEmbed(entry.channelId);
    if (src) {
      return `
        <div class="video-card pixel-corners">
          <div class="video-embed-wrap">
            <iframe class="video-embed" src="${src}" title="${label}"
              loading="lazy" allow="autoplay; encrypted-media; picture-in-picture"
              allowfullscreen frameborder="0"></iframe>
          </div>
          <div class="video-card-foot">
            <span class="video-card-label">${label}</span>
            <a class="video-card-link" href="${channelUrl}" target="_blank" rel="noopener noreferrer" data-i18n="openChannel">Open channel</a>
          </div>
        </div>`;
    }
    // No verified channelId yet — a link-out card instead of a broken embed.
    return `
      <a class="video-card video-card-linkonly pixel-corners" href="${channelUrl}" target="_blank" rel="noopener noreferrer">
        <div class="video-card-linkonly-body">
          <span class="video-card-label">${label}</span>
          <span class="video-card-link" data-i18n="openChannel">Open channel</span>
        </div>
      </a>`;
  }

  async function render() {
    const list = cacheEls();
    if (!list) return;
    const data = await loadData();
    if (!data.length) {
      list.innerHTML = "";
      return;
    }
    list.innerHTML = data.map(cardHTML).join("");
  }

  function init() {
    render();
  }

  global.Videos = { init, render };
})(window);
