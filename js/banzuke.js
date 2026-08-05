// banzuke.js — renders the actual rank list (East/West, rank, shikona)
// once a banzuke has been released, using SumoAPI.getBanzuke. Field names
// here (rikishiID, shikonaEn, rank) are confirmed against a real
// third-party app's documented usage of this same endpoint — see the
// comment in js/sumoapi.js. Kept separate from js/app.js's renderLivePanel
// (which decides WHEN to show this vs. the countdown vs. day-of-basho
// info) so the fetch/render logic for the rank table itself is reusable
// and easy to find.
//
// Division is a dropdown (see DIVISIONS below), persisted via
// SumoUtil.storage so it survives reloads/re-renders instead of always
// snapping back to Makuuchi. Division names are kept as-is across every
// language — they're the actual Japanese terms sumo uses for its own
// rank tiers, not really "translatable" the way UI chrome is.
(function (global) {
  "use strict";

  const DIVISIONS = ["Makuuchi", "Juryo", "Makushita", "Sandanme", "Jonidan", "Jonokuchi"];
  const DIVISION_KEY = "banzukeDivision";

  function getDivision() { return SumoUtil.storage.get(DIVISION_KEY, "Makuuchi"); }
  function setDivision(d) { SumoUtil.storage.set(DIVISION_KEY, d); }

  function rowHTML(rikishi) {
    const name = SumoUtil.escapeHTML(rikishi.shikonaEn || rikishi.shikonaJp || "?");
    const rank = SumoUtil.escapeHTML(rikishi.rank || "");
    const id = rikishi.rikishiID;
    const nameHTML = id != null
      ? `<button type="button" class="banzuke-name rikishi-link" data-rikishi-id="${id}">${name}</button>`
      : `<span class="banzuke-name">${name}</span>`;
    return `<div class="banzuke-row"><span class="banzuke-rank">${rank}</span>${nameHTML}</div>`;
  }

  function renderFilterBar(filterBarEl, onChange) {
    if (!filterBarEl) return;
    const current = getDivision();
    filterBarEl.innerHTML = `
      <select id="banzukeFilterDivision" class="mini filter-select">
        ${DIVISIONS.map((d) => `<option value="${d}" ${d === current ? "selected" : ""}>${d}</option>`).join("")}
      </select>`;
    document.getElementById("banzukeFilterDivision").addEventListener("change", (e) => {
      setDivision(e.target.value);
      onChange(e.target.value);
    });
  }

  async function renderList(listEl, appBashoId, division) {
    listEl.innerHTML = `<p class="filter-empty">${I18n.t("banzukeLoading")}</p>`;
    try {
      const data = await SumoAPI.getBanzuke(appBashoId, division);
      const east = (data && data.east) || [];
      const west = (data && data.west) || [];
      if (!east.length && !west.length) {
        listEl.innerHTML = `<p class="filter-empty">${I18n.t("banzukeUnavailable")}</p>`;
        return;
      }
      listEl.innerHTML = `
        <div class="banzuke-columns">
          <div class="banzuke-column">
            <div class="banzuke-column-head" data-i18n="banzukeEast">East</div>
            ${east.map(rowHTML).join("")}
          </div>
          <div class="banzuke-column">
            <div class="banzuke-column-head" data-i18n="banzukeWest">West</div>
            ${west.map(rowHTML).join("")}
          </div>
        </div>`;
      if (global.I18n) I18n.applyStaticText();
    } catch (e) {
      listEl.innerHTML = `<p class="filter-empty">${I18n.t("banzukeUnavailable")}</p>`;
    }
  }

  // filterBarEl and listEl are two separate containers (see index.html /
  // js/app.js's renderLivePanel) so switching divisions only re-renders
  // the list, not the dropdown itself (which would lose focus/flicker).
  function render(filterBarEl, listEl, appBashoId) {
    renderFilterBar(filterBarEl, (division) => renderList(listEl, appBashoId, division));
    renderList(listEl, appBashoId, getDivision());
  }

  global.Banzuke = { render, DIVISIONS };
})(window);
