// youtube-live.js — tiny Cloudflare Worker: "is this YouTube channel live right now?"
// Used by js/streams.js (YT_LIVE_ENDPOINT). No API key needed.
//
// GET <worker>?channelId=UCxxxxxxxx
//  -> { exists, live, videoId, title, embeddable }
// GET <worker>?channelId=UC…&debug=1
//  -> same, plus what the page looked like (open it in a browser to diagnose).
// GET <worker>?platform=kick&channel=<slug>
//  -> Kick live status (see kickStatus below).
//
// ALSO: JSA bout videos for the Torikumi panel (js/torikumi.js, CLIPS_ENDPOINT).
// GET <worker>?basho=2026-11&day=13
//  -> { clips: [{ videoId, title, day, eastId, westId, east, west, embeddable, published }], updated }
//     (omit &day for the whole basho; add &debug=1 for diagnostics)
// Needs a KV namespace bound as CLIPS (the live/Kick checks above work without it).
// A cron trigger ("*/30 * * * *") keeps the clips fresh; without one the worker
// refreshes itself, at most every 30 min, when the app asks for clips.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60"
};
const json = (obj, status = 200, maxAge = 60) =>
  new Response(JSON.stringify(obj, null, 1), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, "Cache-Control": `public, max-age=${maxAge}` }
  });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function getPage(channelId) {
  return fetch(`https://www.youtube.com/channel/${channelId}/live?hl=en&gl=US`, {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      // Skips the EU cookie-consent interstitial.
      "Cookie": "CONSENT=YES+cb.20240101-00-p0.en+FX+000; SOCS=CAI"
    }
  });
}

// Kick: GET <worker>?platform=kick&channel=<slug> -> { exists, live, viewers, title }
// Uses Kick's website API. Kick sits behind Cloudflare bot protection, so this
// can be refused (-> HTTP 502, the app shows "couldn't check", never "offline").
async function kickStatus(slug, debug) {
  if (!/^[\w-]{2,40}$/.test(slug)) return json({ error: "bad channel" }, 400);
  let res;
  try {
    res = await fetch(`https://kick.com/api/v2/channels/${slug}`, {
      headers: { "User-Agent": UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9" }
    });
  } catch (e) { return json({ error: "upstream" }, 502); }
  if (res.status === 404) return json({ exists: false, live: false, viewers: null, title: null });
  if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);
  let d;
  try { d = await res.json(); } catch (e) { return json({ error: "not-json (bot check?)" }, 502); }
  const ls = d && d.livestream;
  return json({
    exists: true,
    live: !!(ls && (ls.is_live === undefined || ls.is_live)),
    viewers: ls && typeof ls.viewer_count === "number" ? ls.viewer_count : null,
    title: ls ? (ls.session_title || null) : null,
    ...(debug ? { debug: { hasLivestream: !!ls } } : {})
  });
}


// =====================================================================
// JSA bout videos (clips) — everything below up to `export default`
// =====================================================================

const JSA_CHANNEL_ID = "UC6ZZhovRZpUA4VafgBdECZQ";           // 日本相撲協会公式チャンネル (@sumo-video)
const JSA_RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${JSA_CHANNEL_ID}`;
const SUMO_API = "https://www.sumo-api.com/api";
const REFRESH_EVERY_MS = 30 * 60 * 1000;
const MAX_PROFILE_LOOKUPS = 30;                            // keeps one run under the free plan's 50-subrequest limit

// ---------- title parsing ----------

const BASHO_MONTH = { "初場所": 1, "春場所": 3, "大阪場所": 3, "夏場所": 5, "名古屋場所": 7, "七月場所": 7, "秋場所": 9, "九州場所": 11 };
const KANJI_DIGIT = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
// 髙/﨑 etc. are variant forms: canonicalise both sides before comparing.
const VARIANTS = { "髙": "高", "﨑": "崎", "德": "徳", "邊": "辺", "澤": "沢", "濵": "浜" };
const RANK_PREFIX = /^(?:横綱|大関|関脇|小結|前頭?\d*|十両\d*|幕下\d*)[・\s]*/;

function canon(s) {
  return (s || "").normalize("NFKC").replace(/[髙﨑德邊澤濵]/g, (c) => VARIANTS[c]).replace(/\s+/g, "");
}

function kanjiNumber(str) {                                // 十三 -> 13, 十 -> 10, 二十 not needed (max 15)
  if (/^\d+$/.test(str)) return Number(str);
  if (str === "十") return 10;
  const m = str.match(/^十?([一二三四五六七八九])?$/);
  if (!m) return null;
  return (str.startsWith("十") ? 10 : 0) + (m[1] ? KANJI_DIGIT[m[1]] : 0);
}

function parseDay(text) {
  if (text === "初日") return 1;
  if (text === "中日") return 8;
  if (text === "千秋楽") return 15;
  const m = text.match(/^(.+?)日目$/);
  return m ? kanjiNumber(m[1]) : null;
}

function splitMatchup(text) {
  // Separator is a hyphen-like dash; 旭富士ー若隆景 style (long-vowel mark) as a last resort.
  let parts = text.split(/\s*[-−–—―]\s*/);
  if (parts.length !== 2) parts = text.split("ー");
  if (parts.length !== 2) return null;
  const clean = (p) => p.trim().replace(RANK_PREFIX, "").trim();
  const [a, b] = [clean(parts[0]), clean(parts[1])];
  return a && b ? [a, b] : null;
}

// Format A: 大相撲 [rank ]East－West＜令和8年九州場所･13日目＞SUMO
// Format B: 【相撲協会 十三日目の一番】大関・霧島-前13・琴栄峰  (no basho in title -> from publish date)
function parseTitle(rawTitle, publishedISO) {
  const t = rawTitle.normalize("NFKC");
  let m = t.match(/^大相撲\s*(.+?)<令和(\d+)年(.+?場所)[・･]?(初日|中日|千秋楽|[\d一二三四五六七八九十]+日目)>/);
  if (m) {
    const month = BASHO_MONTH[m[3]];
    const day = parseDay(m[4]);
    const names = splitMatchup(m[1]);
    if (!month || !day || !names) return null;
    return { basho: `${2018 + Number(m[2])}-${String(month).padStart(2, "0")}`, day, names };
  }
  m = t.match(/^【相撲協会\s*(初日|中日|千秋楽|[\d一二三四五六七八九十]+日目)の一番】(.+)$/);
  if (m) {
    const day = parseDay(m[1]);
    const names = splitMatchup(m[2]);
    if (!day || !names || !publishedISO) return null;
    // Basho month = publish month in JST if it is an odd month (Jan/Mar/…/Nov).
    const jst = new Date(new Date(publishedISO).getTime() + 9 * 3600 * 1000);
    const mo = jst.getUTCMonth() + 1;
    if (mo % 2 === 0) return null;
    return { basho: `${jst.getUTCFullYear()}-${String(mo).padStart(2, "0")}`, day, names };
  }
  return null;
}

// ---------- RSS ----------

function decodeXml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

async function readFeed() {
  const res = await fetch(JSA_RSS_URL, { cf: { cacheTtl: 120, cacheEverything: true } });
  if (!res.ok) throw new Error(`rss ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((e) => ({
    videoId: (e[1].match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1],
    title: decodeXml((e[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
    published: (e[1].match(/<published>([^<]+)<\/published>/) || [])[1]
  })).filter((e) => e.videoId && e.title);
}

// ---------- name -> rikishiID ----------

async function sumoApi(path) {
  const res = await fetch(`${SUMO_API}${path}`, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!res.ok) throw new Error(`sumo-api ${path} ${res.status}`);
  return res.json();
}

// Returns Map<canonical JP name, { id, en }> for one basho, filling KV as it goes.
async function nameIndex(env, basho) {
  const apiBasho = basho.replace("-", "");
  const key = `names:${basho}`;
  const index = (await env.CLIPS.get(key, "json")) || { byName: {}, pending: [], built: false };
  if (index.built) return index;

  // Step 1 (cheap): banzuke lists give IDs + English names, sometimes JP names too.
  if (!index.pending.length) {
    const rows = [];
    for (const division of ["Makuuchi", "Juryo"]) {
      try {
        const b = await sumoApi(`/basho/${apiBasho}/banzuke/${division}`);
        [...(b.east || []), ...(b.west || [])].forEach((r) => rows.push(r));
      } catch (e) { /* division not published yet */ }
    }
    for (const r of rows) {
      if (r.rikishiID == null) continue;
      if (r.shikonaJp) index.byName[canon(r.shikonaJp)] = { id: r.rikishiID, en: r.shikonaEn || "" };
      else index.pending.push({ id: r.rikishiID, en: r.shikonaEn || "" });
    }
  }

  // Step 2 (only if banzuke had no JP names): profile lookups, a batch per run.
  const batch = index.pending.splice(0, MAX_PROFILE_LOOKUPS);
  for (const p of batch) {
    try {
      const r = await sumoApi(`/rikishi/${p.id}`);
      if (r.shikonaJp) index.byName[canon(r.shikonaJp)] = { id: p.id, en: r.shikonaEn || p.en };
    } catch (e) { index.pending.push(p); }                 // retry next run
  }
  index.built = index.pending.length === 0 && Object.keys(index.byName).length > 0;
  await env.CLIPS.put(key, JSON.stringify(index));
  return index;
}

// ---------- embeddable? ----------

async function isEmbeddable(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`);
    if (res.status === 401 || res.status === 403) return false;   // owner disabled embedding
    if (res.status === 404) return false;                         // removed / private
    return res.ok;
  } catch (e) { return true; }                                    // network hiccup: assume yes, player will cope
}

// ---------- refresh ----------

async function refreshClips(env) {
  const entries = await readFeed();
  const byBasho = new Map();
  for (const e of entries) {
    const p = parseTitle(e.title, e.published);
    if (!p) continue;
    if (!byBasho.has(p.basho)) byBasho.set(p.basho, []);
    byBasho.get(p.basho).push({ ...e, ...p });
  }

  for (const [basho, found] of byBasho) {
    const stored = (await env.CLIPS.get(`clips:${basho}`, "json")) || { clips: [] };
    const have = new Map(stored.clips.map((c) => [c.videoId, c]));
    let index = null;

    for (const f of found) {
      const existing = have.get(f.videoId);
      // Already resolved -> keep. Unresolved (names not found yet) -> try again.
      if (existing && existing.eastId != null && existing.westId != null) continue;
      index = index || await nameIndex(env, basho);
      const [a, b] = f.names.map((n) => index.byName[canon(n)]);
      have.set(f.videoId, {
        videoId: f.videoId,
        title: f.title,
        day: f.day,
        published: f.published,
        east: f.names[0],
        west: f.names[1],
        eastId: a ? a.id : null,
        westId: b ? b.id : null,
        embeddable: existing ? existing.embeddable : await isEmbeddable(f.videoId)
      });
    }
    const clips = [...have.values()].sort((x, y) => x.day - y.day || String(x.published).localeCompare(String(y.published)));
    await env.CLIPS.put(`clips:${basho}`, JSON.stringify({ clips }));
  }
  await env.CLIPS.put("meta:lastRun", String(Date.now()));
}


async function clipsRoute(q, env, ctx) {
  if (!env.CLIPS) return json({ error: "KV binding CLIPS missing (see header comment)" }, 500);
  const basho = q.get("basho") || "";
  const day = q.get("day");
  if (!/^\d{4}-\d{2}$/.test(basho)) return json({ error: "basho=YYYY-MM required" }, 400);

  // Self-refresh when no cron is set up (or it stalled).
  const last = Number(await env.CLIPS.get("meta:lastRun")) || 0;
  if (Date.now() - last > REFRESH_EVERY_MS) {
    await env.CLIPS.put("meta:lastRun", String(Date.now()));      // claim the slot first so parallel requests don't pile on
    // Very first run: wait for it so this response already has clips. Otherwise refresh in the background.
    if (!last) await refreshClips(env).catch(() => {});
    else ctx.waitUntil(refreshClips(env).catch(() => {}));
  }

  const data = (await env.CLIPS.get(`clips:${basho}`, "json")) || { clips: [] };
  let clips = data.clips;
  if (day) clips = clips.filter((c) => c.day === Number(day));
  const out = { clips, updated: last };
  if (q.get("debug") === "1") out.debug = { names: await env.CLIPS.get(`names:${basho}`, "json").then((n) => n && { built: n.built, known: Object.keys(n.byName).length, pending: n.pending.length }) };
  return json(out, 200, 300);
}

export default {
  async scheduled(event, env, ctx) {
    if (env.CLIPS) ctx.waitUntil(refreshClips(env).catch(() => {}));
  },

  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const q = new URL(request.url).searchParams;
    if (q.has("basho")) return clipsRoute(q, env, ctx);
    if (q.get("platform") === "kick") return kickStatus(q.get("channel") || "", q.get("debug") === "1");
    const channelId = q.get("channelId") || "";
    const debug = q.get("debug") === "1";
    if (!/^UC[\w-]{20,24}$/.test(channelId)) return json({ error: "bad channelId" }, 400);

    let res;
    try { res = await getPage(channelId); } catch (e) { return json({ error: "upstream" }, 502); }
    if (res.status === 404) return json({ exists: false, live: false, videoId: null, title: null, embeddable: null });
    if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);

    const html = await res.text();
    const finalUrl = res.url;
    const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
    const hasPlayer = html.includes("ytInitialPlayerResponse");
    if (!hasPlayer && !html.includes('rel="canonical"')) {
      return json({ error: "no-page (consent or bot check)", finalUrl, ...(debug ? { head: html.slice(0, 300) } : {}) }, 502);
    }

    // Any of these means "on air right now"; "isUpcoming" means scheduled-not-started.
    const signals = {
      canonicalIsWatch: !!canonical,
      isLive: /"isLive":\s*true/.test(html),
      isLiveNow: /"isLiveNow":\s*true/.test(html),
      badgeLive: /"style":"LIVE_BADGE_STYLE_LIVE_NOW"|BADGE_STYLE_TYPE_LIVE_NOW/.test(html),
      isUpcoming: /"isUpcoming":\s*true/.test(html),
      hasEndTimestamp: /"endTimestamp":"/.test(html)
    };
    const live = signals.canonicalIsWatch && !signals.hasEndTimestamp &&
      (signals.isLive || signals.isLiveNow) && !(signals.isUpcoming && !signals.isLiveNow && !signals.isLive);
    const videoId = canonical ? canonical[1] : null;
    const title = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || null;

    // Can the video be embedded? oEmbed answers 401 when the owner disabled embedding.
    let embeddable = null;
    if (live && videoId) {
      try {
        const o = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}&format=json`);
        embeddable = o.ok ? true : (o.status === 401 || o.status === 403 ? false : null);
      } catch (e) { /* unknown */ }
    }

    return json({
      exists: true, live, videoId: live ? videoId : null, title: live ? title : null, embeddable,
      ...(debug ? { debug: { finalUrl, signals, hasPlayer, htmlLength: html.length } } : {})
    });
  }
};
