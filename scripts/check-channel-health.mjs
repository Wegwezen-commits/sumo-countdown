// scripts/check-channel-health.mjs
//
// Walks data/videos.json and data/streams.json, and for every *enabled*
// entry with a YouTube channelId, pings that channel's uploads playlist
// via YouTube's public oEmbed endpoint — the same keyless, CORS-friendly
// technique js/videos.js and js/streams.js already use client-side to
// hide dead channels for a visiting browser. Running it here too, on a
// schedule (see .github/workflows/channel-health-check.yml), means dead
// channels get caught even if nobody happens to load the site while
// they're down, and — more importantly — it can actually flag them
// somewhere a human will see it (a GitHub issue), instead of just
// quietly hiding the card for visitors forever.
//
// Twitch/Rumble/website entries aren't checked here — same limitation as
// the client-side version: no public, keyless, CORS-friendly way to ask.
// (The Cloudflare Worker built for Twitch viewer stats *does* hold
// credentials that could check Twitch channel existence too, but that's
// a separate piece of infra this script deliberately doesn't reach into
// — it only touches this repo's data files.)
//
// Run locally with: node scripts/check-channel-health.mjs
// Exits with a non-zero code and prints a markdown summary to stdout
// when any enabled channel is unreachable; exits 0 (silent) otherwise.

import { readFile } from "node:fs/promises";

const FILES = ["data/videos.json", "data/streams.json"];

function uploadsPlaylistId(channelId) {
  if (!channelId || channelId.slice(0, 2) !== "UC") return null;
  return "UU" + channelId.slice(2);
}

async function checkAlive(channelId) {
  const playlistId = uploadsPlaylistId(channelId);
  if (!playlistId) return true; // nothing to check (non-YouTube or no id) — not our job to flag
  const target = `https://www.youtube.com/playlist?list=${playlistId}`;
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch (e) {
    return null; // network hiccup — unknown, don't report as dead
  }
}

async function main() {
  const dead = [];
  for (const file of FILES) {
    const raw = await readFile(file, "utf-8");
    const json = JSON.parse(raw);
    const entries = json.videos || json.streams || [];
    const candidates = entries.filter((e) => !e.disabled && e.channelId);
    const results = await Promise.all(
      candidates.map(async (e) => [e, await checkAlive(e.channelId)])
    );
    for (const [entry, alive] of results) {
      if (alive === false) dead.push({ file, id: entry.id, label: entry.label, channelId: entry.channelId, channelUrl: entry.channelUrl });
    }
  }

  if (!dead.length) {
    console.log("All enabled YouTube channels are reachable. Nothing to report.");
    process.exit(0);
  }

  const lines = [
    `Found ${dead.length} enabled YouTube channel(s) that no longer resolve via oEmbed — likely deleted, renamed, or terminated. Verify by hand before editing data files (a transient API hiccup can look the same as a real takedown); this is a heads-up, not an auto-fix.`,
    "",
    ...dead.map((d) => `- **${d.label}** (\`${d.id}\` in \`${d.file}\`) — channelId \`${d.channelId}\`, was linking to ${d.channelUrl}`)
  ];
  console.log(lines.join("\n"));
  process.exitCode = 1; // signal the workflow step to open/update the issue
}

main();
