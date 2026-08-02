// news.js — aggregates recent English-language sumo coverage (Tachiai and
// a couple of other sources) directly in the browser, no server required.
//
// This is a static site, so we can't do the fetching server-side; most
// news sites don't send CORS headers, so a direct fetch() of their RSS
// feed from a GitHub Pages origin will usually be blocked by the browser.
// We work around that with a couple of public, read-only CORS proxies,
// tried in order, each with its own timeout. If every source and every
// proxy fails (offline, proxy down, feed moved), the panel falls back to
// a curated list of direct links so the section never just breaks.
//
// Only headlines, source, date and an outbound link are shown — no
// article text is copied in, by design.
(function (global) {
  "use strict";

  const CACHE_KEY = "newsCache";
  const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
  const FETCH_TIMEOUT_MS = 8000;
  const MAX_ITEMS = 9;

  const PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`
  ];

  function withTimeout(promise, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { controller, promise: promise(controller.signal).finally(() => clearTimeout(timer)) };
  }

  async function fetchText(url) {
    const { promise } = withTimeout((signal) => fetch(url, { signal, cache: "no-cache" }), FETCH_TIMEOUT_MS);
    const res = await promise;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async function fetchFeedXML(feedUrl) {
    // Try direct first (works if the source ever adds CORS headers), then
    // each proxy in turn.
    const attempts = [feedUrl, ...PROXIES.map((build) => build(feedUrl))];
    let lastErr = null;
    for (const url of attempts) {
      try {
        const text = await fetchText(url);
        const doc = new DOMParser().parseFromString(text, "application/xml");
        if (doc.querySelector("parsererror")) throw new Error("parse error");
        return doc;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("all sources failed");
  }

  function textOf(node, selector) {
    const el = node.querySelector(selector);
    return el ? el.textContent.trim() : "";
  }

  function parseEntries(doc, sourceName, sourceId) {
    const items = [];
    // RSS 2.0
    doc.querySelectorAll("item").forEach((item) => {
      const title = textOf(item, "title");
      const link = textOf(item, "link");
      const pub = textOf(item, "pubDate");
      const date = pub ? new Date(pub) : null;
      if (title && link) items.push({ title, link, date, source: sourceName, sourceId });
    });
    // Atom (e.g. Reddit)
    if (!items.length) {
      doc.querySelectorAll("entry").forEach((entry) => {
        const title = textOf(entry, "title");
        const linkEl = entry.querySelector("link[href]");
        const link = linkEl ? linkEl.getAttribute("href") : "";
        const updated = textOf(entry, "updated") || textOf(entry, "published");
        const date = updated ? new Date(updated) : null;
        if (title && link) items.push({ title, link, date, source: sourceName, sourceId });
      });
    }
    return items;
  }

  function timeAgo(date, lang) {
    if (!date || isNaN(date.getTime())) return "";
    const diffMs = Date.now() - date.getTime();
    const mins = Math.round(diffMs / 60000);
    const rtf = (typeof Intl !== "undefined" && Intl.RelativeTimeFormat)
      ? new Intl.RelativeTimeFormat(lang, { numeric: "auto" }) : null;
    if (!rtf) return date.toLocaleDateString();
    if (mins < 60) return rtf.format(-mins, "minute");
    const hours = Math.round(mins / 60);
    if (hours < 24) return rtf.format(-hours, "hour");
    const days = Math.round(hours / 24);
    if (days < 30) return rtf.format(-days, "day");
    const months = Math.round(days / 30);
    return rtf.format(-months, "month");
  }

  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function renderItems(container, items) {
    if (!items.length) { container.innerHTML = ""; return; }
    container.innerHTML = items.map((it) => `
      <a class="news-item" href="${escapeHTML(it.link)}" target="_blank" rel="noopener noreferrer">
        <span class="news-source">${escapeHTML(it.source)}</span>
        <span class="news-title">${escapeHTML(it.title)}</span>
        <span class="news-time">${escapeHTML(timeAgo(it.date, (global.I18n && I18n.locale()) || "en"))}</span>
      </a>`).join("");
  }

  function renderCuratedLinks(container, links) {
    if (!container) return;
    container.innerHTML = links.map((l) =>
      `<a href="${escapeHTML(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(l.name)} ↗</a>`
    ).join("");
  }

  async function loadFromCache() {
    const cached = SumoUtil.storage.get(CACHE_KEY, null);
    if (!cached || !Array.isArray(cached.items)) return null;
    if (Date.now() - cached.at > CACHE_TTL_MS) return null;
    return cached.items.map((it) => ({ ...it, date: it.date ? new Date(it.date) : null }));
  }

  function saveToCache(items) {
    SumoUtil.storage.set(CACHE_KEY, { at: Date.now(), items });
  }

  async function fetchAll(sources) {
    const results = await Promise.allSettled(
      sources.map((s) => fetchFeedXML(s.feedUrl).then((doc) => parseEntries(doc, s.name, s.id)))
    );
    let items = [];
    let anyOk = false;
    results.forEach((r) => {
      if (r.status === "fulfilled") { anyOk = true; items = items.concat(r.value); }
    });
    if (!anyOk) throw new Error("all feeds failed");
    items.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
    return items; // NOT sliced here — exclusion filtering happens after this, at render time
  }

  let rawItems = []; // everything fetched/cached, before source-exclusion filtering
  let sourceList = []; // config.feeds, for building the toggle checkboxes
  let lastStatus = { kind: "loading", cachedAt: null }; // for re-translating the status line on language change

  function excludedSources() {
    return (global.Settings && Settings.prefs.excludedNewsSources) || [];
  }

  function filteredItems() {
    const excluded = excludedSources();
    return rawItems.filter((it) => !it.sourceId || !excluded.includes(it.sourceId)).slice(0, MAX_ITEMS);
  }

  function setStatus(kind, cachedAt) {
    lastStatus = { kind, cachedAt: cachedAt || null };
    const status = document.getElementById("newsUpdated");
    if (!status) return;
    if (kind === "loading") status.textContent = I18n.t("newsLoading");
    else if (kind === "live") status.textContent = I18n.t("newsLive");
    else if (kind === "offline") status.textContent = I18n.t("newsOffline");
    else if (kind === "unavailable") status.textContent = I18n.t("newsUnavailable");
    else if (kind === "cached") status.textContent = I18n.t("newsUpdated", { time: timeAgo(new Date(lastStatus.cachedAt || Date.now()), I18n.locale()) });
  }

  function renderSourceToggles() {
    const container = document.getElementById("newsSourceToggles");
    if (!container || !sourceList.length) return;
    const excluded = excludedSources();
    container.innerHTML = sourceList.map((s) => `
      <label class="filter-checkbox news-source-toggle">
        <input type="checkbox" data-source-id="${SumoUtil.escapeHTML(s.id)}" ${excluded.includes(s.id) ? "" : "checked"} />
        <span>${SumoUtil.escapeHTML(s.name)}</span>
      </label>`).join("");
    container.querySelectorAll("input[data-source-id]").forEach((input) => {
      input.addEventListener("change", () => {
        const id = input.getAttribute("data-source-id");
        const current = excludedSources();
        const next = input.checked ? current.filter((x) => x !== id) : [...current, id];
        Settings.set("excludedNewsSources", next);
        renderItems(document.getElementById("newsList"), filteredItems());
      });
    });
  }

  const News = {
    async init() {
      const list = document.getElementById("newsList");
      const status = document.getElementById("newsUpdated");
      const sourcesEl = document.getElementById("newsSources");
      if (!list) return;
      setStatus("loading");

      let config;
      try { config = await SumoUtil.fetchJSON("data/news-sources.json"); }
      catch (e) { config = { feeds: [], curatedLinks: [] }; }

      sourceList = config.feeds || [];
      renderSourceToggles();
      renderCuratedLinks(sourcesEl, config.curatedLinks || []);

      const cached = await loadFromCache();
      if (cached && cached.length) {
        rawItems = cached;
        renderItems(list, filteredItems());
        setStatus("cached", SumoUtil.storage.get(CACHE_KEY, { at: Date.now() }).at);
      }

      if (!config.feeds || !config.feeds.length) {
        if (!cached) this.showUnavailable();
        return;
      }

      try {
        const items = await fetchAll(config.feeds);
        if (items.length) {
          rawItems = items;
          renderItems(list, filteredItems());
          saveToCache(items.map((it) => ({ ...it, date: it.date ? it.date.toISOString() : null })));
          setStatus("live");
        } else if (!cached) {
          this.showUnavailable();
        }
      } catch (e) {
        if (!cached) this.showUnavailable();
        else setStatus("offline");
      }

      document.addEventListener("prefschange", (e) => {
        if (e.detail && e.detail.key === "excludedNewsSources") renderItems(list, filteredItems());
      });
    },

    // Cheap re-render for language changes — no network, just re-applies
    // the current language to already-fetched items and the status line.
    // (Doesn't re-run the source-toggle checkboxes; their labels are
    // channel names, not translated strings, so there's nothing to redo.)
    render() {
      const list = document.getElementById("newsList");
      if (list && rawItems.length) renderItems(list, filteredItems());
      setStatus(lastStatus.kind, lastStatus.cachedAt);
    },

    showUnavailable() {
      const list = document.getElementById("newsList");
      setStatus("unavailable");
      if (list) list.innerHTML = "";
    }
  };

  global.News = News;
})(window);
