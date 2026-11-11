// youtube-live.js — tiny Cloudflare Worker that answers "is this YouTube
// channel live right now?" for js/streams.js (YT_LIVE_ENDPOINT).
//
// Why it exists: a browser can't read youtube.com/channel/<id>/live itself
// (no CORS headers), and YouTube's oEmbed endpoint does NOT resolve /live
// URLs, so a pure client-side check always reports "offline". This Worker
// fetches that page server-side and reads the result. No API key needed.
//
// Deploy: Cloudflare dashboard > Workers > Create > paste this file > Deploy,
// then put the worker's URL in YT_LIVE_ENDPOINT at the top of js/streams.js.
//
// GET <worker>?channelId=UCxxxxxxxx
//  -> { exists: bool, live: bool, videoId: string|null, title: string|null }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60"
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const channelId = new URL(request.url).searchParams.get("channelId") || "";
    if (!/^UC[\w-]{20,24}$/.test(channelId)) return json({ error: "bad channelId" }, 400);

    let res;
    try {
      res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          // Skips the EU cookie-consent interstitial that otherwise replaces the page.
          "Cookie": "CONSENT=YES+cb; SOCS=CAI"
        },
        cf: { cacheTtl: 60, cacheEverything: true }
      });
    } catch (e) {
      return json({ error: "upstream" }, 502);
    }
    if (res.status === 404) return json({ exists: false, live: false, videoId: null, title: null });
    if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);

    const html = await res.text();
    // Consent wall / bot check instead of the real page -> we can't tell.
    if (!html.includes("ytInitialPlayerResponse") && !html.includes('rel="canonical"')) {
      return json({ error: "no-page" }, 502);
    }
    const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
    // isLive:true appears in videoDetails of a stream that is on air right now;
    // upcoming/ended streams don't have it.
    const isLive = /"isLive":true/.test(html) && /"isLiveContent":true/.test(html);
    const live = !!canonical && isLive;
    const title = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || null;
    return json({
      exists: true,
      live,
      videoId: live ? canonical[1] : null,
      title: live ? title : null
    });
  }
};
