// torikumi.js — renders the current day's torikumi (bout list) during a
// live basho, via SumoAPI.getTorikumi. Division is a dropdown (see
// js/banzuke.js's DIVISIONS — reused here for consistency), persisted via
// SumoUtil.storage under its own key so Torikumi and Banzuke can be set
// to different divisions independently if someone wants that.
//
// FIELD-NAME UNCERTAINTY: sumo-api.com's torikumi endpoint returns a flat
// list of bout objects. The only fields independently confirmed (via a
// third-party app's own code that calls this same endpoint) are ID/rank
// based — eastId, westId, winnerId, loserId, winnerRank, loserRank — not
// wrestler names or the winning technique directly. Rather than guess at
// those two, this cross-references eastId/westId against the SAME
// basho+division's banzuke (already fetched — SumoAPI caches it, so this
// doesn't cost a second real network request) to get shikonaEn for the
// name. "kimarite" is tried directly as a field name with reasonable but
// not confirmed confidence.
// If the live display looks off once this is actually deployed (wrong/
// missing names, no technique shown), that's the first place to check —
// open browser devtools' Network tab on a real torikumi request and
// compare actual field names against KIMARITE_KEYS/RESULT logic below.
(function (global) {
  "use strict";

  const KIMARITE_KEYS = ["kimarite", "technique", "winningTechnique"];
  const DIVISION_KEY = "torikumiDivision";

  function getDivision() { return SumoUtil.storage.get(DIVISION_KEY, "Makuuchi"); }
  function setDivision(d) { SumoUtil.storage.set(DIVISION_KEY, d); }

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

  function boutHTML(bout, nameMap) {
    const eastId = pick(bout, ["eastId", "eastID", "eastRikishiId"]);
    const westId = pick(bout, ["westId", "westID", "westRikishiId"]);
    const winnerId = pick(bout, ["winnerId", "winnerID"]);
    const eastName = SumoUtil.escapeHTML((eastId != null && nameMap.get(String(eastId))) || pick(bout, ["eastShikona", "eastShikonaEn"]) || "?");
    const westName = SumoUtil.escapeHTML((westId != null && nameMap.get(String(westId))) || pick(bout, ["westShikona", "westShikonaEn"]) || "?");
    const kimarite = pick(bout, KIMARITE_KEYS);
    let resultHTML = "";
    if (winnerId != null && eastId != null && westId != null) {
      const winnerName = String(winnerId) === String(eastId) ? eastName : (String(winnerId) === String(westId) ? westName : null);
      if (winnerName) {
        resultHTML = kimarite
          ? `<span class="torikumi-result">${I18n.t("torikumiWonBy", { winner: winnerName, kimarite: SumoUtil.escapeHTML(kimarite) })}</span>`
          : `<span class="torikumi-result">${I18n.t("torikumiWon", { winner: winnerName })}</span>`;
      }
    }
    return `
      <div class="torikumi-row${winnerId != null ? " is-decided" : ""}">
        <span class="torikumi-east${String(winnerId) === String(eastId) ? " is-winner" : ""}">${eastName}</span>
        <span class="torikumi-vs">–</span>
        <span class="torikumi-west${String(winnerId) === String(westId) ? " is-winner" : ""}">${westName}</span>
        ${resultHTML}
      </div>`;
  }

  function renderFilterBar(filterBarEl, live, onChange) {
    if (!filterBarEl) return;
    const current = getDivision();
    filterBarEl.innerHTML = `
      <select id="torikumiFilterDivision" class="mini filter-select">
        ${Banzuke.DIVISIONS.map((d) => `<option value="${d}" ${d === current ? "selected" : ""}>${d}</option>`).join("")}
      </select>`;
    document.getElementById("torikumiFilterDivision").addEventListener("change", (e) => {
      setDivision(e.target.value);
      onChange(e.target.value);
    });
  }

  async function renderList(listEl, live, division) {
    const info = Live.status(live, new Date());
    const day = info.dayIndex;
    listEl.innerHTML = `<p class="filter-empty">${I18n.t("torikumiLoading")}</p>`;
    try {
      const [banzuke, torikumiData] = await Promise.all([
        SumoAPI.getBanzuke(live.id, division),
        SumoAPI.getTorikumi(live.id, division, day)
      ]);
      const bouts = Array.isArray(torikumiData) ? torikumiData
        : (torikumiData && (torikumiData.torikumi || torikumiData.matches)) || [];
      if (!bouts.length) {
        listEl.innerHTML = `<p class="filter-empty">${I18n.t("torikumiNotPosted")}</p>`;
        return;
      }
      const nameMap = buildNameMap(banzuke);
      listEl.innerHTML = `<div class="torikumi-list">${bouts.map((b) => boutHTML(b, nameMap)).join("")}</div>`;
    } catch (e) {
      listEl.innerHTML = `<p class="filter-empty">${I18n.t("torikumiNotPosted")}</p>`;
    }
  }

  async function render() {
    const filterBarEl = document.getElementById("torikumiFilterBar");
    const listEl = document.getElementById("torikumiCard");
    if (!listEl || !global.SumoAPI || !global.Banzuke) return;
    const now = new Date();
    const live = global.Schedule && Schedule.getLive(now);
    if (!live) {
      if (filterBarEl) filterBarEl.innerHTML = "";
      listEl.innerHTML = `<p class="filter-empty">${I18n.t("torikumiInactive")}</p>`;
      return;
    }
    renderFilterBar(filterBarEl, live, (division) => renderList(listEl, live, division));
    renderList(listEl, live, getDivision());
  }

  global.Torikumi = { render };
})(window);
