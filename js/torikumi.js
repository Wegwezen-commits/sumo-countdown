// torikumi.js — renders the current day's Makuuchi torikumi (bout list)
// during a live basho, via SumoAPI.getTorikumi.
//
// FIELD-NAME UNCERTAINTY: sumo-api.com's torikumi endpoint returns a flat
// list of bout objects. The only fields independently confirmed (via a
// third-party app's own code that calls this same endpoint) are ID/rank
// based — eastId, westId, winnerId, loserId, winnerRank, loserRank — not
// wrestler names or the winning technique directly. Rather than guess at
// those two, this cross-references eastId/westId against the SAME
// basho's banzuke (already fetched for the Banzuke panel — SumoAPI caches
// it, so this doesn't cost a second real network request) to get
// shikonaEn for the name. "kimarite" is tried directly as a field name
// with reasonable but not confirmed confidence.
// If the live display looks off once this is actually deployed (wrong/
// missing names, no technique shown), that's the first place to check —
// open browser devtools' Network tab on a real torikumi request and
// compare actual field names against KIMARITE_KEYS/RESULT logic below.
(function (global) {
  "use strict";

  const KIMARITE_KEYS = ["kimarite", "technique", "winningTechnique"];

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

  async function render() {
    const container = document.getElementById("torikumiCard");
    if (!container) return;
    if (!global.SumoAPI) return;
    const now = new Date();
    const live = global.Schedule && Schedule.getLive(now);
    if (!live) {
      container.innerHTML = `<p class="filter-empty">${I18n.t("torikumiInactive")}</p>`;
      return;
    }
    const info = Live.status(live, now);
    const day = info.dayIndex;
    try {
      const [banzuke, torikumiData] = await Promise.all([
        SumoAPI.getBanzuke(live.id, "Makuuchi"),
        SumoAPI.getTorikumi(live.id, "Makuuchi", day)
      ]);
      const bouts = Array.isArray(torikumiData) ? torikumiData
        : (torikumiData && (torikumiData.torikumi || torikumiData.matches)) || [];
      if (!bouts.length) {
        container.innerHTML = `<p class="filter-empty">${I18n.t("torikumiNotPosted")}</p>`;
        return;
      }
      const nameMap = buildNameMap(banzuke);
      container.innerHTML = `<div class="torikumi-list">${bouts.map((b) => boutHTML(b, nameMap)).join("")}</div>`;
    } catch (e) {
      container.innerHTML = `<p class="filter-empty">${I18n.t("torikumiNotPosted")}</p>`;
    }
  }

  global.Torikumi = { render };
})(window);
