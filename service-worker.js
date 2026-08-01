// service-worker.js — app-shell caching so the site works offline.
// HTML/CSS/JS/JSON go network-first (fall back to cache offline) so a
// fixed deploy is never masked by a stale cached copy of the code
// itself; images/audio (which rarely change) stay cache-first for
// speed and offline reliability.
const CACHE_VERSION = "sumo-countdown-v20-filters-banzuke-newsprefs";
const NETWORK_FIRST_EXT = [".html", ".js", ".css", ".json"];
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/main.css",
  "./css/themes.css",
  "./css/animations.css",
  "./css/responsive.css",
  "./css/tvmode.css",
  "./js/util.js",
  "./js/language.js",
  "./js/settings.js",
  "./js/schedule.js",
  "./js/venue.js",
  "./js/live.js",
  "./js/animations.js",
  "./js/audio.js",
  "./js/countdown.js",
  "./js/hero.js",
  "./js/news.js",
  "./js/streams.js",
  "./js/videos.js",
  "./js/watch-tabs.js",
  "./js/pwa.js",
  "./js/app.js",
  "./data/schedule.json",
  "./data/venues.json",
  "./data/champions.json",
  "./data/translations.json",
  "./data/news-sources.json",
  "./data/streams.json",
  "./data/videos.json",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/pixel/hero-static.png",
  "./assets/pixel/hero-idle-sheet.png",
  "./assets/pixel/hero-celebrate.png",
  "./assets/pixel/loading-sheet.png",
  "./assets/pixel/champion-medallion.png",
  "./assets/pixel/particle-sakura.png",
  "./assets/pixel/particle-leaf.png",
  "./assets/pixel/particle-leaf-summer.png",
  "./assets/pixel/particle-snow.png",
  "./assets/pixel/venue-ryogoku.png",
  "./assets/pixel/venue-ryogoku-night.png",
  "./assets/pixel/venue-osaka.png",
  "./assets/pixel/venue-osaka-night.png",
  "./assets/pixel/venue-nagoya.png",
  "./assets/pixel/venue-nagoya-night.png",
  "./assets/pixel/venue-fukuoka.png",
  "./assets/pixel/venue-fukuoka-night.png",
  "./assets/audio/idle.ogg",
  "./assets/audio/countdown.ogg",
  "./assets/audio/live.ogg",
  "./assets/audio/finalDay.ogg",
  "./assets/audio/victory.ogg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isNetworkFirst(url) {
  if (url.pathname === "/" || url.pathname.endsWith("/")) return true;
  return NETWORK_FIRST_EXT.some((ext) => url.pathname.endsWith(ext));
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Only manage same-origin requests here. Cross-origin calls (Google
  // Fonts, the news-aggregator's CORS proxies) should just hit the
  // network normally — the news panel already has its own localStorage
  // cache with a real TTL; caching opaque cross-origin responses here
  // would make headlines look permanently stuck instead.
  if (url.origin !== self.location.origin) return;

  if (isNetworkFirst(url)) {
    // Network-first: always try to get the latest code/data; only fall
    // back to whatever's cached if the network is unavailable (offline).
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for media (images/audio/fonts): instant + offline-safe,
  // with a background revalidation so next load picks up any change.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
