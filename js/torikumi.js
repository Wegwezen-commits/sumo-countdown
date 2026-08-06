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
(function (global) {
  "use strict";

  const KIMARITE_KEYS = ["kimarite", "technique", "winningTechnique"];
  const DIVISION_KEY = "torikumiDivision";
  const MAX_DAY = 15;

  let selectableBasho = [];
  let state = { bashoId: null, division: SumoUtil.storage.get(DIVISION_KEY, "Makuuchi"), day: 1 };

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

  function boutHTML(bout, nameMap) {
    const eastId = pick(bout, ["eastId", "eastID", "eastRikishiId"]);
    const westId = pick(bout, ["westId", "westID", "westRikishiId"]);
    const winnerId = pick(bout, ["winnerId", "winnerID"]);
    const eastName = (eastId != null && nameMap.get(String(eastId))) || pick(bout, ["eastShikona", "eastShikonaEn"]) || "?";
    const westName = (westId != null && nameMap.get(String(westId))) || pick(bout, ["westShikona", "westShikonaEn"]) || "?";
    const kimarite = pick(bout, KIMARITE_KEYS);
    let resultHTML = "";
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
      <select id="torikumiFilterDay" class="mini filter-select">${dayOptionsHTML()}</select>`;
    document.getElementById("torikumiFilterBasho").addEventListener("change", (e) => { state.bashoId = e.target.value; renderBody(); });
    document.getElementById("torikumiFilterDivision").addEventListener("change", (e) => {
      state.division = e.target.value;
      SumoUtil.storage.set(DIVISION_KEY, state.division);
      renderBody();
    });
    document.getElementById("torikumiFilterDay").addEventListener("change", (e) => { state.day = Number(e.target.value); renderBody(); });
  }

  async function renderBody() {
    const { body } = els();
    if (!body || !state.bashoId) return;
    body.innerHTML = `<p class="filter-empty">${I18n.t("torikumiLoading")}</p>`;
    try {
      const [banzuke, torikumiData] = await Promise.all([
        SumoAPI.getBanzuke(state.bashoId, state.division),
        SumoAPI.getTorikumi(state.bashoId, state.division, state.day)
      ]);
      const bouts = Array.isArray(torikumiData) ? torikumiData
        : (torikumiData && (torikumiData.torikumi || torikumiData.matches)) || [];
      if (!bouts.length) {
        body.innerHTML = `<p class="filter-empty">${I18n.t("torikumiNotPosted")}</p>`;
        return;
      }
      const nameMap = buildNameMap(banzuke);
      body.innerHTML = `<div class="torikumi-list">${bouts.map((b) => boutHTML(b, nameMap)).join("")}</div>`;
    } catch (e) {
      body.innerHTML = `<p class="filter-empty">${I18n.t("torikumiNotPosted")}</p>`;
    }
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
    renderFilterBar();
    renderBody();
  }

  global.Torikumi = { init, render: renderBody };
})(window);
