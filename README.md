# Sumo Basho Countdown

A static, dependency-free countdown to the next Grand Sumo Tournament
(Honbasho). Built to be hosted free on GitHub Pages and embedded in
Google Sites via an `<iframe>`.

## Highlights

- **Upgraded procedural pixel art** — every visual (hero rikishi, the
  four tournament venues in day + night, weather particles, the app
  icon, loading spinner, champion medallion) is still original,
  license-free, geometrically-generated pixel art (see
  `assets/pixel/`, produced from the build scripts in this session's
  notes below) — now on a bigger design grid with real 3–4 tone
  shading ramps, rim-light/AO accents, and one shared ~40-colour
  palette across every asset so they read as one coherent world. The
  hero has an 8-frame idle animation (breathe, blink, weight shift,
  plus swaying sign-ropes as secondary motion) instead of 3 near-static
  frames. **This is a deliberate, hand-tuned upgrade to the procedural
  approach, not AI-generated or hand-painted art** — no image-generation
  tool was available in this build environment, so see "Known
  limitations" below for exactly where this still falls short of true
  HD-2D/hand-animated quality.
- **Hero sign overlay** — the LED-style flip-clock countdown is an
  HTML/CSS layer positioned over the blank sign baked into the pixel
  rikishi sprite, not part of the artwork, so it stays perfectly
  aligned at every size from 320px phones to 4K/ultrawide displays
  (see the comment above `.hero-overlay` in `css/main.css`). The sign's
  position is pixel-identical across all 8 animation frames.
- **Animated hero + venue backdrop** — the rikishi idles (breathe/blink/
  weight-shift/rope-sway) via a stepped CSS sprite-sheet animation,
  celebrates at zero, and the backdrop behind him automatically shows
  the current or next tournament's host arena — each of the four
  venues now has a genuinely distinct silhouette (Ryōgoku's low
  traditional hall, Osaka's barrel-vault modern gym, Nagoya's angular
  Kengo-Kuma-style timber-clad IG Arena, Fukuoka's domed convention
  centre) — swapping a day/night variant (stars + moon vs. sun + clouds)
  based on Japan time.
- **Live Basho Mode** — while a tournament is running, the hero swaps to
  a pulsing `LIVE` badge, shows *Day X of 15*, and re-targets the clock
  at Senshūraku instead of the next Day One.
- **Seasonal themes** — spring/summer/autumn/winter accent palettes and
  a lightweight sakura-petal layer (CSS-animated `<span>` elements, no
  canvas), capped at 18 particles so it never costs meaningful
  performance.
- **Composed soundtrack, real instrument samples** — `assets/audio/`
  holds five pre-rendered, actually-composed tracks (idle, countdown,
  live, finalDay-with-a-half-step-key-shift, and a one-shot victory
  fanfare), all built around one recurring 5-note motif on the A "yo"
  (Japanese pentatonic-adjacent) scale so the whole soundtrack feels
  like one piece. Composed as MIDI and rendered through FluidSynth with
  real GM instrument samples (koto, shakuhachi, shamisen, taiko drum,
  kalimba, harp), then mastered (synthetic reverb, soft compression,
  normalization) and loop-crossfaded for seamless looping, transcoded
  to small OGG files (113–222 KB each). `js/audio.js` crossfades
  between states with Web Audio gain nodes and still synthesizes the
  short one-shot SFX (tachiai clap, dohyo thud, crowd swell) live, as
  before. Both music and SFX are off by default, independently
  toggleable, share one master-volume slider, and only unlock after the
  first tap/click/keypress per browser autoplay rules.
- **i18n** — English, 日本語, and Nederlands, switchable without a
  reload (`data/translations.json`).
- **Dark mode** — automatic based on Japan time (19:00–07:00 JST), with
  a manual override that's remembered.
- **TV mode** — one toggle hides everything but a huge countdown, for
  leaving on a television or a dashboard display.
- **PWA** — installable, works offline via `service-worker.js` (now
  also caching the composed-music OGG files), shows an update banner
  when a new version has been fetched in the background.
- **Real weekly data sync** — `scripts/check_schedule.py` now actually
  queries the free, third-party **sumo-api.com** community API for
  official basho dates/results and merges confirmed entries into
  `data/schedule.json`, on top of `js/schedule.js`'s never-ending
  generated placeholder schedule for anything beyond the last confirmed
  tournament. See "Known limitations" for what this pipeline does and
  doesn't guarantee.

## Project structure

```
sumo-countdown/
├── index.html
├── css/           main.css, themes.css, animations.css, responsive.css, tvmode.css
├── js/            util, language, settings, schedule, venue, live, animations, audio, countdown, pwa, app
├── assets/        pixel/ (generated pixel-art PNGs), audio/ (composed OGG tracks), icons/ (PWA icons)
├── data/          schedule.json, venues.json, champions.json, translations.json
├── scripts/       check_schedule.py (real sumo-api.com sync), test_check_schedule.py,
│                  fixtures/ (saved sample API response for offline tests)
├── manifest.json, service-worker.js, robots.txt, sitemap.xml
└── .github/workflows/update_schedule.yml
```

The pixel-art and music *build* scripts (the Python generators that
produced everything in `assets/pixel/` and `assets/audio/`) are not
shipped in this ZIP, same as last session — only their output is. If
you want to regenerate or tweak the art/music yourself, the palette,
composition, and mastering choices are all documented in the "Known
limitations" notes below so you know what to change and why.

## Embedding in Google Sites

1. Host the folder on GitHub Pages (Settings → Pages → deploy from
   `main`).
2. In Google Sites, add an **Embed** block → **By URL** → paste the
   Pages URL.
3. The layout is mobile-first and has no fixed pixel widths, so it
   resizes cleanly inside the Sites iframe.

## Known limitations / what to double-check before relying on this

**Art (Workstream A)**
- **No image-generation tool was available in this build environment**,
  so this pass took the documented fallback: genuinely improving the
  procedural approach rather than faking AI-art quality. Concretely:
  the design grid doubled (96×128 → 192×256 for the hero, and finer
  detail on the venues), every surface now has 3–4 tone shading ramps
  plus a rim-light/AO pass, the idle animation grew from 3 to 8 frames
  with real secondary motion (the sign's hanging ropes sway out of
  phase), and every asset now draws from one ~40-colour shared palette
  instead of each image inventing its own colours.
- **It is still not hand-animated HD-2D-tier art.** Proportions are
  deliberately kept chibi/blocky (a conscious choice, not a limitation
  of the tooling — see the comment in `generate_hero.py`), silhouettes
  are built from rectangles/simple polygons rather than painted
  curves, and there's no per-pixel hand-touch-up. If you get access to
  an image-generation tool later, the contract in `assets/pixel/` (file
  names, frame-sheet layout, `hero-meta.json`'s sign-box percentages)
  is designed so you can swap in AI-generated or commissioned art
  without touching any CSS/JS, as long as you keep the same file names
  and the sign box's relative position.
- Sourcing a CC0 asset pack instead was considered and intentionally
  not done — reskinning someone else's character/building silhouettes
  well enough to look coherent is itself a real art job, and doing it
  poorly would be worse than a clean, consistent procedural set.

**Music (Workstream B)**
- The five tracks are a **confident, cohesive, real-instrument-sample
  soundtrack** (FluidSynth + the FluidR3_GM soundfont's koto,
  shakuhachi, shamisen, taiko, kalimba, and harp/strings patches) —
  genuinely composed (a real chord progression and a motif that
  recurs, varied, across every state), not generative/random, and a big
  step up from the previous session's live Web Audio sequencer.
- It is **not** licensed orchestral or live-instrument work, and a
  professional game composer would still call it a demo/sketch rather
  than a final soundtrack — the samples are a general-purpose GM
  soundfont, not bespoke-recorded instruments, and the mastering
  (reverb, compression) is a simple offline DSP pass, not a mixing
  engineer's work.
- Loops are crossfaded at the loop point for a seamless repeat; the
  victory fanfare is deliberately a one-shot, not a loop.

**Weekly data sync (Workstream C)**
- `scripts/check_schedule.py` now does a **real fetch**: it queries
  `https://www.sumo-api.com/api/basho/:bashoId` (a free, actively
  maintained, but **unofficial, volunteer-run** community API built
  from JSA data — not an official JSA feed) for every basho slot from
  last year through 2 years out, and only ever *adds new entries or
  upgrades an existing generated placeholder to official* — it never
  deletes or silently overwrites an already-official entry, and it
  refuses any diff that looks implausible (wrong-length basho, a date
  more than 2 years out).
- The exact response shape was confirmed only at a "here's roughly what
  the fields look like" level from public docs/examples at build time,
  since sumo-api.com's schema isn't formally versioned — parsing is
  written defensively (`_extract_basho_fields()` tries several
  plausible key names) so a shape drift degrades to "skip this entry,
  log it," not a crash or corrupted data. **Re-verify against a live
  run** once you have this deployed with real network access, since
  this sandbox's network egress doesn't allow reaching sumo-api.com to
  test the live path end-to-end (confirmed: requests correctly fail
  closed and no-op rather than corrupting `schedule.json`).
- `scripts/test_check_schedule.py` covers the parsing/merge logic
  against a saved fixture response, so CI validates the pipeline's
  logic without depending on the API being reachable or unchanged at
  test time — but a fixture test can't catch a real schema change,
  only confirm the code behaves correctly against the schema it
  expects.
- This is real automation, not a hardened production data pipeline: if
  sumo-api.com goes down, rate-limits, or changes shape, the Action
  degrades to "no-op that week" rather than breaking the site — but
  nobody is monitoring that on your behalf.
- 2026 dates already in `data/schedule.json` are seeded from public
  JSA-sourced reporting as of July 2026; everything after that is
  either the generated placeholder or whatever the weekly sync has
  since confirmed.

## Local development

No build step for the site itself. Serve the folder with any static
server, e.g.:

```
python3 -m http.server 8080
```

then open `http://localhost:8080`.

To run the schedule-sync pipeline's offline tests (no network needed):

```
python3 scripts/test_check_schedule.py
```

To actually run the real fetch against sumo-api.com (needs network):

```
python3 scripts/check_schedule.py
```
