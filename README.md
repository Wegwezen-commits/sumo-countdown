# Sumo Countdown

A static, dependency-free companion site for Grand Sumo Tournaments
(Honbasho) — countdown, banzuke, torikumi, livestreams & video channels,
news, and previous-basho results, all in one place. Hosted free on
GitHub Pages.

## Features

- **Live countdown** to the next Honbasho, with day/night hero art tied
  to Japan time and a Live Basho mode (day-of-15 tracker) while a
  tournament is running.
- **Banzuke** — countdown to the rank list's release, then the real
  East/West Makuuchi rank list once it's out, with a division dropdown
  (Makuuchi through Jonokuchi).
- **Torikumi** — today's bout list during a live basho, division
  selectable, winner + technique shown once results are in.
- **Watch Sumo** — a tabbed panel for Live Streams (YouTube/Twitch, with
  real live-status and viewer counts) and Video Channels (auto-updating
  embeds of community-recommended highlight/analysis channels), both
  filterable by category/language/official, with dead-channel
  auto-detection.
- **Previous Basho** — venue, dates, and (when available) the real
  yusho winner and special prizes for the last tournament.
- **Rikishi profiles** — tap a wrestler's name in Banzuke or Torikumi
  for a quick profile popup.
- **Sumo News** — aggregated headlines from Tachiai, The Japan Times,
  and r/Sumo, with per-source filtering.
- **Notifications** — local (foreground) alerts for banzuke release,
  basho start, and each day's torikumi going up.
- **i18n** — English, 日本語, and Nederlands, switchable without a reload.
- **Dark mode**, **TV mode**, seasonal particle themes, composed
  soundtrack + SFX (off by default), and a full **PWA** (installable,
  offline-capable).

## External data & services

This is a static site with no backend of its own, so a few things lean
on outside services:

- **[sumo-api.com](https://www.sumo-api.com)** — a free, independently
  run community API — provides banzuke, torikumi, and basho-result data
  (`js/sumoapi.js`). If you rely on this site, consider
  [supporting it](https://ko-fi.com/sumoapi).
- **A small Cloudflare Worker** (script not included in this repo —
  deploy separately) proxies two things a static site can't do safely
  or reliably on its own: Twitch live-status/viewer-count lookups
  (needs an app secret, can't live client-side) and RSS/Atom feed
  fetches for the News panel (most feed hosts don't send CORS headers).
  Configure its URL in `js/streams.js` (`VIEWER_STATS_ENDPOINT`) and
  `js/news.js` (`NEWS_PROXY_ENDPOINT`). Without it, Twitch entries fall
  back to a manual `assumeLive` flag in `data/streams.json` (no viewer
  counts), and news falls back to third-party public CORS proxies
  (less reliable).
- **YouTube's public oEmbed endpoint** — used to auto-detect live status
  and dead/deleted channels for YouTube entries, no API key needed.

## Project structure

```
sumo-countdown/
├── index.html
├── css/      main.css, themes.css, animations.css, responsive.css, tvmode.css
├── js/       util, language, settings, schedule, venue, live, sumoapi,
│             banzuke, torikumi, previousbasho, rikishi, animations, audio,
│             countdown, hero, news, streams, videos, watch-tabs, notify,
│             pwa, app
├── assets/   pixel/ (art), audio/ (composed tracks), icons/ (PWA icons)
├── data/     schedule.json, venues.json, champions.json, translations.json,
│             news-sources.json, streams.json, videos.json
├── scripts/  check_schedule.py + test (schedule sync), check-channel-health.mjs
│             (dead-channel sweep), last-health-check.json (keepalive record)
├── manifest.json, service-worker.js, robots.txt, sitemap.xml
└── .github/workflows/  update_schedule.yml, channel-health-check.yml
```

## Local development

No build step. Serve the folder with any static server:

```
python3 -m http.server 8080
```

then open `http://localhost:8080`.

Schedule-sync pipeline (offline tests, no network):

```
python3 scripts/test_check_schedule.py
```

Run it for real against sumo-api.com (needs network):

```
python3 scripts/check_schedule.py
```

Channel health check (needs network):

```
node scripts/check-channel-health.mjs
```
