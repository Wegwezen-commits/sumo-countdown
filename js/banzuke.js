// banzuke.js — the Banzuke panel, now fully self-contained: a Basho
// selector (any past tournament, the live one, or the next upcoming one
// — see Schedule.getSelectableBasho) and a Division selector, browsable
// independently of whether a basho is currently live. Previously this
// panel hid itself and showed day-of-basho info instead while a basho
// was live — that's no longer the case, since the hero countdown area
// already shows live/day-of-basho status on its own (see js/countdown.js),
// making that duplication pointless once this became independently
// browsable. The one thing that still depends on live/release state is
// what happens when the SELECTED basho is the upcoming one and its
// banzuke hasn't been released yet — that still shows a countdown
// instead of attempting a fetch that would just fail.
//
// Field names (rikishiID, shikonaEn, rank) are confirmed against a real
// third-party app's documented usage of the banzuke endpoint — see the
// comment in js/sumoapi.js.
(function (global) {
  "use strict";

  const DIVISIONS = ["Makuuchi", "Juryo", "Makushita", "Sandanme", "Jonidan", "Jonokuchi"];
  const DIVISION_KEY = "banzukeDivision";
  const BANZUKE_URL = "https://sumo.or.jp/EnHonbashoBanzuke/index/";

  let selectableBasho = [];
  let state = { bashoId: null, division: SumoUtil.storage.get(DIVISION_KEY, "Makuuchi") };

  function els() {
    return {
      filterBar: document.getElementById("banzukeFilterBar"),
      body: document.getElementById("banzukeBody")
    };
  }

  function rowHTML(rikishi) {
    const name = SumoUtil.escapeHTML(rikishi.shikonaEn || rikishi.shikonaJp || "?");
    const rank = SumoUtil.escapeHTML(rikishi.rank || "");
    const id = rikishi.rikishiID;
    const nameHTML = id != null
      ? `<button type="button" class="banzuke-name rikishi-link" data-rikishi-id="${id}">${name}</button>`
      : `<span class="banzuke-name">${name}</span>`;
    return `<div class="banzuke-row"><span class="banzuke-rank">${rank}</span>${nameHTML}</div>`;
  }

  function renderFilterBar() {
    const { filterBar } = els();
    if (!filterBar) return;
    filterBar.innerHTML = `
      <select id="banzukeFilterBasho" class="mini filter-select">
        ${selectableBasho.map((b) => `<option value="${b.id}" ${b.id === state.bashoId ? "selected" : ""}>${SumoUtil.escapeHTML(b.name)} (${b.year})</option>`).join("")}
      </select>
      <select id="banzukeFilterDivision" class="mini filter-select">
        ${DIVISIONS.map((d) => `<option value="${d}" ${d === state.division ? "selected" : ""}>${d}</option>`).join("")}
      </select>`;
    document.getElementById("banzukeFilterBasho").addEventListener("change", (e) => {
      state.bashoId = e.target.value;
      renderBody();
    });
    document.getElementById("banzukeFilterDivision").addEventListener("change", (e) => {
      state.division = e.target.value;
      SumoUtil.storage.set(DIVISION_KEY, state.division);
      renderBody();
    });
  }

  async function renderBody() {
    const { body } = els();
    if (!body) return;
    const basho = selectableBasho.find((b) => b.id === state.bashoId);
    if (!basho) { body.innerHTML = ""; return; }

    const now = new Date();
    const isUpcoming = new Date(basho.startDate + "T00:00:00Z") > now;
    const banzukeDate = basho.banzukeDate ? new Date(basho.banzukeDate + "T00:00:00Z") : null;
    const released = !isUpcoming || !banzukeDate || now >= banzukeDate;

    if (!released) {
      const daysUntil = SumoUtil.daysBetween(basho.banzukeDate, now);
      const dateStr = SumoUtil.formatRange(basho.banzukeDate, basho.banzukeDate, I18n.locale()).split("–").pop().trim();
      body.innerHTML = `
        <div class="row"><span class="k">${I18n.t("banzukeStatus")}</span><span class="v">${I18n.t("banzukeIn", { n: daysUntil })}</span></div>
        <div class="row"><span class="k">${SumoUtil.escapeHTML(basho.name)}</span><span class="v">${dateStr}</span></div>
        <a class="panel-external-link" href="${BANZUKE_URL}" target="_blank" rel="noopener noreferrer">${I18n.t("viewBanzuke")} ↗</a>`;
      return;
    }

    body.innerHTML = `<p class="filter-empty">${I18n.t("banzukeLoading")}</p>`;
    try {
      const data = await SumoAPI.getBanzuke(basho.id, state.division);
      const east = (data && data.east) || [];
      const west = (data && data.west) || [];
      if (!east.length && !west.length) {
        body.innerHTML = `<p class="filter-empty">${I18n.t("banzukeUnavailable")}</p>`;
        return;
      }
      body.innerHTML = `
        <div class="banzuke-columns">
          <div class="banzuke-column">
            <div class="banzuke-column-head" data-i18n="banzukeEast">East</div>
            ${east.map(rowHTML).join("")}
          </div>
          <div class="banzuke-column">
            <div class="banzuke-column-head" data-i18n="banzukeWest">West</div>
            ${west.map(rowHTML).join("")}
          </div>
        </div>
        <a class="panel-external-link" href="${BANZUKE_URL}" target="_blank" rel="noopener noreferrer">${I18n.t("viewBanzuke")} ↗</a>`;
      if (global.I18n) I18n.applyStaticText();
    } catch (e) {
      body.innerHTML = `<p class="filter-empty">${I18n.t("banzukeUnavailable")}</p>`;
    }
  }

  async function init() {
    await Schedule.load();
    selectableBasho = Schedule.getSelectableBasho(new Date());
    const now = new Date();
    const defaultBasho = Schedule.getLive(now) || Schedule.getNextUpcoming(now) || selectableBasho[0];
    state.bashoId = defaultBasho ? defaultBasho.id : null;
    renderFilterBar();
    renderBody();
  }

  global.Banzuke = { init, render: renderBody, DIVISIONS };
})(window);
