// banzuke.js — renders the actual Makuuchi rank list (East/West, rank,
// shikona) once a banzuke has been released, using SumoAPI.getBanzuke.
// Field names here (rikishiID, shikonaEn, rank) are confirmed against a
// real third-party app's documented usage of this same endpoint — see
// the comment in js/sumoapi.js. Kept separate from js/app.js's
// renderLivePanel (which decides WHEN to show this vs. the countdown vs.
// day-of-basho info) so the fetch/render logic for the rank table itself
// is reusable and easy to find.
(function (global) {
  "use strict";

  function rowHTML(rikishi) {
    const name = SumoUtil.escapeHTML(rikishi.shikonaEn || rikishi.shikonaJp || "?");
    const rank = SumoUtil.escapeHTML(rikishi.rank || "");
    return `<div class="banzuke-row"><span class="banzuke-rank">${rank}</span><span class="banzuke-name">${name}</span></div>`;
  }

  async function renderRankList(container, appBashoId, division) {
    container.innerHTML = `<p class="filter-empty">${I18n.t("banzukeLoading")}</p>`;
    try {
      const data = await SumoAPI.getBanzuke(appBashoId, division || "Makuuchi");
      const east = (data && data.east) || [];
      const west = (data && data.west) || [];
      if (!east.length && !west.length) {
        container.innerHTML = `<p class="filter-empty">${I18n.t("banzukeUnavailable")}</p>`;
        return;
      }
      container.innerHTML = `
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
      container.innerHTML = `<p class="filter-empty">${I18n.t("banzukeUnavailable")}</p>`;
    }
  }

  global.Banzuke = { renderRankList };
})(window);
