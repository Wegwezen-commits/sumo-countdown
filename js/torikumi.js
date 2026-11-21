// torikumi.js — the Torikumi panel, now fully self-contained: Basho +
// Division + Day selectors (see js/banzuke.js's Schedule.getSelectableBasho
// for the basho list), browsable independently of whether a basho is
// currently live. Previously this only ever showed "today" during a live
// basho and hid itself otherwise — now it can look back at any past
// tournament's any day, and (the original ask that started this) look
// *ahead* to a day that hasn't happened yet within the live basho, since
// the next day's torikumi is typically published before that day starts.
//
// FIELD-NAME UNCERTAINTY: same situation as before — eastId/westId/
// winnerId/winnerRank/loserRank are confirmed field names (via a
// third-party app's own code using this same endpoint), wrestler names
// and "kimarite" are best-effort. Names are cross-referenced against the
// same basho+division's banzuke (SumoAPI caches it, no extra real
// request) rather than guessed at from the torikumi response directly.
//
// SPOILER-FREE MODE (Settings → "Hide results", or the checkbox in this
// panel's filter bar; same pref, kept in sync): bouts that have already been
// decided are listed as plain match-ups — no winner highlight, no "won by"
// line, no decided-row styling that would hint at who's finished — with a
// small Reveal button per bout and Reveal all / Hide all for the day being
// viewed. Undecided bouts (tomorrow's card, today's not-yet-fought bouts)
// look exactly as before, so previewing upcoming match-ups is unaffected.
// Reveals live in memory only: reloading the page hides everything again.
//
// SCORES: next to each wrestler the win-loss(-absence) record he brings INTO the
// bout, taken from the banzuke's per-day `record` list (so it never leaks the
// result of the bout itself, and is safe in spoiler-free mode). Once a decided
// bout is visible (not hidden by spoiler-free mode) the record after the bout
// is shown too, e.g. "5-2 → 6-2". Nothing is drawn when the data isn't there.
//
// PLAYOFFS: a JSA playoff video (優勝決定戦 / 三人の巴戦) covers 2-3 wrestlers, not one bout,
// so the worker sends it as { kind: "playoff", ids: [...] } with no eastId/westId. It is
// never attached to a regular bout row; it gets its own "Playoff" block under the day's
// list. Because even the existence of a playoff gives away the standings, the block stays
// hidden in spoiler-free mode until the day is revealed.
//
// BOUT VIDEOS: when CLIPS_ENDPOINT is set (the clips route of workers/youtube-live.js), bouts that
// the Japan Sumo Association posted a video of on its official YouTube channel
// get a ▶ button that opens the clip in a modal. The worker matches videos to
// bouts by rikishiID, so this only has to compare the two IDs. Because the
// video itself shows who won, the button never appears on a row that
// spoiler-free mode is hiding — it shows up once that bout is revealed.
(function (global) {
  "use strict";

  const KIMARITE_KEYS = ["kimarite", "technique", "winningTechnique"];
  const DIVISION_KEY = "torikumiDivision";
  const MAX_DAY = 15;
  // Same Cloudflare Worker as streams.js's YT_LIVE_ENDPOINT (workers/youtube-live.js
  // answers ?basho=&day= with the clips). Leave "" to switch bout videos off.
  // Until the updated worker + its CLIPS KV binding are deployed, this just
  // gets a 400/500 back and the ▶ buttons quietly don't appear.
  const CLIPS_ENDPOINT = "https://youtube-live-979a.veeken-joost.workers.dev";
  const CLIPS_TTL_MS = 5 * 60 * 1000;
  const CLIPS_TIMEOUT_MS = 6000;

  let selectableBasho = [];
  let state = { bashoId: null, division: SumoUtil.storage.get(DIVISION_KEY, "Makuuchi"), day: 1 };
  let renderToken = 0;
  let lastView = null;                 // { bouts, nameMap } of what's on screen, so reveal clicks repaint without refetching
  const revealed = new Set();          // `${view}|${boutIndex}`
  const revealedAll = new Set();       // view keys with "Reveal all" on
  const clipCache = new Map();         // `${basho}|${day}` -> { at, clips }

  function spoilerFree() { return !!(global.Settings && Settings.prefs.spoilerFree); }
  function viewKey() { return `${state.bashoId}|${state.division}|${state.day}`; }
  function isDecided(bout) {
    const w = pick(bout, ["winnerId", "winnerID"]);
    return w != null;
  }
  function isHidden(bout, idx) {
    return spoilerFree() && isDecided(bout) && !revealedAll.has(viewKey()) && !revealed.has(`${viewKey()}|${idx}`);
  }

  function els() {
    return {
      filterBar: document.getElementById("torikumiFilterBar"),
      body: document.getElementById("torikumiCard")
    };
  }

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    }
    return null;
  }

  function buildNameMap(banzuke) {
    const map = new Map();
    const all = [...((banzuke && banzuke.east) || []), ...((banzuke && banzuke.west) || [])];
    all.forEach((r) => { if (r.rikishiID != null) map.set(String(r.rikishiID), r.shikonaEn || r.shikonaJp); });
    return map;
  }

  // id -> the banzuke entry's per-day record list ([{ result, opponentID, ... }, ...]).
  function buildRecordMap(banzuke) {
    const map = new Map();
    const all = [...((banzuke && banzuke.east) || []), ...((banzuke && banzuke.west) || [])];
    all.forEach((r) => { if (r.rikishiID != null && Array.isArray(r.record)) map.set(String(r.rikishiID), r.record); });
    return map;
  }

  // Tally the first `days` entries of a record list -> { w, l, a } or null.
  function tallyDays(record, days) {
    if (!Array.isArray(record) || days < 0) return null;
    let w = 0, l = 0, a = 0;
    record.slice(0, days).forEach((b) => {
      const res = String((b && (b.result || b.outcome)) || "").toLowerCase();
      if (res === "w" || (res.includes("win") && !res.includes("loss"))) w++;
      else if (res === "l" || res.includes("loss")) l++;
      else if (res.includes("absent") || res.includes("fusen") || res.includes("kyujo")) a++;
    });
    return { w, l, a };
  }

  function scoreText(t) { return t ? `${t.w}-${t.l}${t.a ? `-${t.a}` : ""}` : ""; }

  // `after` = also show the record after this bout (only when the result is visible).
  function scoreHTML(cls, id, recMap, showAfter) {
    const rec = id != null && recMap ? recMap.get(String(id)) : null;
    if (!rec) return "";
    const before = tallyDays(rec, state.day - 1);
    if (!before) return "";
    let text = scoreText(before);
    if (showAfter) {
      const after = tallyDays(rec, state.day);
      // Only trust "after" if the list really has an entry for this day.
      if (after && rec.length >= state.day) text += ` → ${scoreText(after)}`;
    }
    return `<span class="torikumi-score ${cls}">${text}</span>`;
  }

  function nameHTML(cls, name, id, isWinner) {
    const safeName = SumoUtil.escapeHTML(name);
    const classes = `${cls}${isWinner ? " is-winner" : ""}`;
    return id != null
      ? `<button type="button" class="${classes} rikishi-link" data-rikishi-id="${id}">${safeName}</button>`
      : `<span class="${classes}">${safeName}</span>`;
  }

  // ---- bout videos --------------------------------------------------

  function sameId(a, b) { return a != null && b != null && String(a) === String(b); }

  // The worker only knows "these two wrestlers", not which side was east on the
  // banzuke, so compare the pair in either order.
  function clipFor(eastId, westId) {
    const clips = lastView && lastView.clips;
    if (!clips || eastId == null || westId == null) return null;
    return clips.find((c) => c.kind !== "playoff" && (
      (sameId(c.eastId, eastId) && sameId(c.westId, westId)) ||
      (sameId(c.eastId, westId) && sameId(c.westId, eastId)))) || null;
  }

  function watchHTML(clip) {
    if (!clip || !clip.videoId) return "";
    const id = SumoUtil.escapeHTML(clip.videoId);
    return clip.embeddable === false
      ? `<a class="torikumi-watch-wrap torikumi-watch-link" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">▶ ${I18n.t("torikumiWatchYouTube")} ↗</a>`
      : `<div class="torikumi-watch-wrap"><button type="button" class="torikumi-watch" data-video-id="${id}">▶ ${I18n.t("torikumiWatch")}</button></div>`;
  }

  // The playoff block: one row per playoff clip whose wrestlers are all in the division on screen.
  function playoffHTML() {
    const clips = ((lastView && lastView.clips) || []).filter((c) => c.kind === "playoff" && Array.isArray(c.ids));
    if (!clips.length) return "";
    if (spoilerFree() && !revealedAll.has(viewKey())) return "";
    const rows = clips.map((c) => {
      if (!c.ids.every((id) => id != null && lastView.nameMap.has(String(id)))) return "";
      const names = c.ids.map((id) => nameHTML("torikumi-playoff-name", lastView.nameMap.get(String(id)), id, false))
        .join('<span class="torikumi-vs">·</span>');
      return `<div class="torikumi-row torikumi-playoff-row">${names}${watchHTML(c)}</div>`;
    }).join("");
    return rows
      ? `<div class="torikumi-playoff"><h4 class="torikumi-playoff-title">${I18n.t("torikumiPlayoff")}</h4><div class="torikumi-list">${rows}</div></div>`
      : "";
  }

  async function loadClips(token) {
    if (!CLIPS_ENDPOINT || !lastView) return;
    const key = `${state.bashoId}|${state.day}`;
    const hit = clipCache.get(key);
    if (hit && Date.now() - hit.at < CLIPS_TTL_MS) { lastView.clips = hit.clips; if (hit.clips.length) paint(); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIPS_TIMEOUT_MS);
    try {
      const res = await fetch(`${CLIPS_ENDPOINT}?basho=${encodeURIComponent(state.bashoId)}&day=${state.day}`, { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json();
      const clips = Array.isArray(data && data.clips) ? data.clips : [];
      clipCache.set(key, { at: Date.now(), clips });
      if (token !== renderToken || !lastView) return;     // user moved on while this loaded
      lastView.clips = clips;
      if (clips.length) paint();
    } catch (e) { /* videos are a bonus: fail silently, torikumi stays as is */ }
    finally { clearTimeout(timer); }
  }

  let clipModalEl = null;
  function ensureClipModal() {
    if (clipModalEl) return clipModalEl;
    clipModalEl = document.createElement("div");
    clipModalEl.className = "rikishi-modal clip-modal hidden";
    clipModalEl.innerHTML = `
      <div class="rikishi-modal-backdrop"></div>
      <div class="rikishi-modal-body clip-modal-body pixel-corners" role="dialog" aria-modal="true">
        <button type="button" class="rikishi-modal-close" aria-label="Close">×</button>
        <div class="clip-modal-content"></div>
      </div>`;
    document.body.appendChild(clipModalEl);
    clipModalEl.querySelector(".rikishi-modal-backdrop").addEventListener("click", closeClip);
    clipModalEl.querySelector(".rikishi-modal-close").addEventListener("click", closeClip);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeClip(); });
    return clipModalEl;
  }

  function openClip(videoId) {
    if (!/^[\w-]{11}$/.test(videoId || "")) return;
    const modal = ensureClipModal();
    // youtube-nocookie: no tracking cookies until the viewer plays the video.
    modal.querySelector(".clip-modal-content").innerHTML = `
      <div class="clip-frame"><iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1"
        title="Bout video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      <a class="panel-external-link" href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer">${I18n.t("torikumiWatchYouTube")} ↗</a>`;
    modal.classList.remove("hidden");
  }

  function closeClip() {
    if (!clipModalEl || clipModalEl.classList.contains("hidden")) return;
    clipModalEl.classList.add("hidden");
    clipModalEl.querySelector(".clip-modal-content").innerHTML = "";   // removing the iframe stops playback
  }

  function boutHTML(bout, nameMap, recMap, idx) {
    const eastId = pick(bout, ["eastId", "eastID", "eastRikishiId"]);
    const westId = pick(bout, ["westId", "westID", "westRikishiId"]);
    const winnerId = pick(bout, ["winnerId", "winnerID"]);
    const eastName = (eastId != null && nameMap.get(String(eastId))) || pick(bout, ["eastShikona", "eastShikonaEn"]) || "?";
    const westName = (westId != null && nameMap.get(String(westId))) || pick(bout, ["westShikona", "westShikonaEn"]) || "?";
    const kimarite = pick(bout, KIMARITE_KEYS);
    const hidden = isHidden(bout, idx);
    let resultHTML = "";
    if (hidden) {
      // No winner info anywhere in this row — not in classes, not in text.
      return `
      <div class="torikumi-row is-hidden-result">
        ${nameHTML("torikumi-east", eastName, eastId, false)}${scoreHTML("torikumi-score-east", eastId, recMap, false)}
        <span class="torikumi-vs">–</span>
        ${scoreHTML("torikumi-score-west", westId, recMap, false)}${nameHTML("torikumi-west", westName, westId, false)}
        <button type="button" class="torikumi-reveal" data-idx="${idx}" aria-label="${SumoUtil.escapeHTML(I18n.t("spoilerHiddenLabel"))}: ${SumoUtil.escapeHTML(eastName)} – ${SumoUtil.escapeHTML(westName)}">${I18n.t("spoilerReveal")}</button>
      </div>`;
    }
    if (winnerId != null && eastId != null && westId != null) {
      const winnerName = String(winnerId) === String(eastId) ? eastName : (String(winnerId) === String(westId) ? westName : null);
      if (winnerName) {
        resultHTML = kimarite
          ? `<span class="torikumi-result">${I18n.t("torikumiWonBy", { winner: SumoUtil.escapeHTML(winnerName), kimarite: SumoUtil.escapeHTML(kimarite) })}</span>`
          : `<span class="torikumi-result">${I18n.t("torikumiWon", { winner: SumoUtil.escapeHTML(winnerName) })}</span>`;
      }
    }
    return `
      <div class="torikumi-row${winnerId != null ? " is-decided" : ""}">
        ${nameHTML("torikumi-east", eastName, eastId, String(winnerId) === String(eastId))}${scoreHTML("torikumi-score-east", eastId, recMap, winnerId != null)}
        <span class="torikumi-vs">–</span>
        ${scoreHTML("torikumi-score-west", westId, recMap, winnerId != null)}${nameHTML("torikumi-west", westName, westId, String(winnerId) === String(westId))}
        ${resultHTML}
        ${watchHTML(clipFor(eastId, westId))}
      </div>`;
  }

  function dayOptionsHTML() {
    const opts = [];
    for (let d = 1; d <= MAX_DAY; d++) {
      opts.push(`<option value="${d}" ${d === state.day ? "selected" : ""}>${I18n.t("torikumiDayOption", { day: d })}</option>`);
    }
    return opts.join("");
  }

  function renderFilterBar() {
    const { filterBar } = els();
    if (!filterBar) return;
    filterBar.innerHTML = `
      <select id="torikumiFilterBasho" class="mini filter-select">
        ${selectableBasho.map((b) => `<option value="${b.id}" ${b.id === state.bashoId ? "selected" : ""}>${SumoUtil.escapeHTML(b.name)} — ${SumoUtil.formatRange(b.startDate, b.endDate, I18n.locale())}</option>`).join("")}
      </select>
      <select id="torikumiFilterDivision" class="mini filter-select">
        ${global.Banzuke.DIVISIONS.map((d) => `<option value="${d}" ${d === state.division ? "selected" : ""}>${d}</option>`).join("")}
      </select>
      <select id="torikumiFilterDay" class="mini filter-select">${dayOptionsHTML()}</select>
      <label class="spoiler-toggle"><input type="checkbox" id="torikumiSpoilerToggle" ${spoilerFree() ? "checked" : ""} /> <span>${I18n.t("spoilerFree")}</span></label>`;
    document.getElementById("torikumiSpoilerToggle").addEventListener("change", (e) => Settings.set("spoilerFree", e.target.checked));
    document.getElementById("torikumiFilterBasho").addEventListener("change", (e) => { state.bashoId = e.target.value; renderBody(); });
    document.getElementById("torikumiFilterDivision").addEventListener("change", (e) => {
      state.division = e.target.value;
      SumoUtil.storage.set(DIVISION_KEY, state.division);
      renderBody();
    });
    document.getElementById("torikumiFilterDay").addEventListener("change", (e) => { state.day = Number(e.target.value); renderBody(); });
  }

  // Paint the already-fetched bouts (also used when a reveal toggles).
  function paint() {
    const { body } = els();
    if (!body || !lastView) return;
    const { bouts, nameMap, recMap } = lastView;
    let bar = "";
    if (spoilerFree()) {
      const decided = bouts.filter(isDecided).length;
      if (decided) {
        const hiddenN = bouts.filter((b, i) => isHidden(b, i)).length;
        const all = revealedAll.has(viewKey()) || hiddenN === 0;
        bar = `<div class="spoiler-bar">
          <span class="spoiler-count">${hiddenN ? I18n.t("spoilerCount", { n: hiddenN }) : ""}</span>
          <button type="button" class="ghost-button spoiler-all" data-action="${all ? "hide" : "reveal"}">${I18n.t(all ? "spoilerHideAll" : "spoilerRevealAll")}</button>
        </div>`;
      }
    }
    body.innerHTML = `${bar}<div class="torikumi-list">${bouts.map((b, i) => boutHTML(b, nameMap, recMap, i)).join("")}</div>${playoffHTML()}`;
  }

  async function renderBody() {
    const { body } = els();
    if (!body || !state.bashoId) return;
    const token = ++renderToken;
    body.innerHTML = `<p class="filter-empty">${I18n.t("torikumiLoading")}</p>`;
    try {
      const [banzuke, torikumiData] = await Promise.all([
        SumoAPI.getBanzuke(state.bashoId, state.division),
        SumoAPI.getTorikumi(state.bashoId, state.division, state.day)
      ]);
      if (token !== renderToken) return;   // a newer selection superseded this one
      const bouts = Array.isArray(torikumiData) ? torikumiData
        : (torikumiData && (torikumiData.torikumi || torikumiData.matches)) || [];
      if (!bouts.length) {
        lastView = null;
        body.innerHTML = `<p class="filter-empty">${I18n.t("torikumiNotPosted")}</p>`;
        return;
      }
      lastView = { bouts, nameMap: buildNameMap(banzuke), recMap: buildRecordMap(banzuke), clips: null };
      paint();
      loadClips(token);
    } catch (e) {
      if (token !== renderToken) return;
      lastView = null;
      body.innerHTML = `<p class="filter-empty">${I18n.t("torikumiNotPosted")}</p>`;
    }
  }

  let wired = false;
  function wireOnce() {
    if (wired) return;
    wired = true;
    const { body } = els();
    if (body) body.addEventListener("click", (e) => {
      const watch = e.target.closest(".torikumi-watch");
      if (watch) { openClip(watch.getAttribute("data-video-id")); return; }
      const one = e.target.closest(".torikumi-reveal");
      if (one) { revealed.add(`${viewKey()}|${one.getAttribute("data-idx")}`); paint(); return; }
      const all = e.target.closest(".spoiler-all");
      if (all) {
        if (all.getAttribute("data-action") === "reveal") revealedAll.add(viewKey());
        else {
          revealedAll.delete(viewKey());
          [...revealed].forEach((k) => { if (k.startsWith(viewKey() + "|")) revealed.delete(k); });
        }
        paint();
      }
    });
    // Settings switch and the in-panel checkbox share one pref.
    document.addEventListener("prefschange", (e) => {
      if (!e.detail || e.detail.key !== "spoilerFree") return;
      const cb = document.getElementById("torikumiSpoilerToggle");
      if (cb) cb.checked = !!e.detail.value;
      paint();
    });
  }

  async function init() {
    await Schedule.load();
    selectableBasho = Schedule.getSelectableBasho(new Date());
    const now = new Date();
    const live = Schedule.getLive(now);
    if (live) {
      state.bashoId = live.id;
      state.day = Live.status(live, now).dayIndex;
    } else {
      // No live basho: default to the most recently *completed* one
      // (not the upcoming one — it has no torikumi yet), final day.
      const past = selectableBasho.find((b) => new Date(b.endDate + "T23:59:59Z") < now);
      state.bashoId = past ? past.id : (selectableBasho[0] && selectableBasho[0].id);
      state.day = MAX_DAY;
    }
    wireOnce();
    renderFilterBar();
    renderBody();
  }

  global.Torikumi = { init, render: renderBody };
})(window);
