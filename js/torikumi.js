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
(function (global) {
  "use strict";

  const KIMARITE_KEYS = ["kimarite", "technique", "winningTechnique"];
  const DIVISION_KEY = "torikumiDivision";
  const MAX_DAY = 15;

  let selectableBasho = [];
  let state = { bashoId: null, division: SumoUtil.storage.get(DIVISION_KEY, "Makuuchi"), day: 1 };
  let renderToken = 0;
  let lastView = null;                 // { bouts, nameMap } of what's on screen, so reveal clicks repaint without refetching
  const revealed = new Set();          // `${view}|${boutIndex}`
  const revealedAll = new Set();       // view keys with "Reveal all" on

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

  function nameHTML(cls, name, id, isWinner) {
    const safeName = SumoUtil.escapeHTML(name);
    const classes = `${cls}${isWinner ? " is-winner" : ""}`;
    return id != null
      ? `<button type="button" class="${classes} rikishi-link" data-rikishi-id="${id}">${safeName}</button>`
      : `<span class="${classes}">${safeName}</span>`;
  }

  function boutHTML(bout, nameMap, idx) {
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
        ${nameHTML("torikumi-east", eastName, eastId, false)}
        <span class="torikumi-vs">–</span>
        ${nameHTML("torikumi-west", westName, westId, false)}
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
        ${nameHTML("torikumi-east", eastName, eastId, String(winnerId) === String(eastId))}
        <span class="torikumi-vs">–</span>
        ${nameHTML("torikumi-west", westName, westId, String(winnerId) === String(westId))}
        ${resultHTML}
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
    const { bouts, nameMap } = lastView;
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
    body.innerHTML = `${bar}<div class="torikumi-list">${bouts.map((b, i) => boutHTML(b, nameMap, i)).join("")}</div>`;
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
      lastView = { bouts, nameMap: buildNameMap(banzuke) };
      paint();
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
