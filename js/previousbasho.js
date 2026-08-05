// previousbasho.js — enriches app.js's renderPreviousPanel with real
// tournament results (yusho winner, special prizes/sansho) from
// SumoAPI.getBashoResult, once it resolves. app.js renders the static
// (schedule.json-sourced) version first so there's never a blank panel
// while this fetches — this module only ADDS to / overwrites specific
// pieces once real data is in, and silently leaves the static version
// alone on failure.
//
// FIELD-NAME UNCERTAINTY: same situation as js/torikumi.js — confirmed
// (via a third-party app's README) that this endpoint returns "yusho
// winners, special prizes", but not the exact JSON key names, since I
// couldn't get a live sample while building this. Tries several
// plausible shapes defensively. If this panel doesn't show real
// winner/prize data once deployed, open devtools' Network tab on a
// /api/basho/:id request and compare against the KEY guesses below.
(function (global) {
  "use strict";

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    }
    return null;
  }

  // Yusho data might come back as a single object, one per division, or
  // under a couple of plausible key names — normalize to an array of
  // { division, name, record }.
  function normalizeYusho(data) {
    const raw = pick(data, ["yusho", "yushoWinners", "champions"]);
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((y) => ({
      division: pick(y, ["division"]) || "Makuuchi",
      name: pick(y, ["shikonaEn", "rikishiName", "name"]),
      record: pick(y, ["record", "result"])
    })).filter((y) => y.name);
  }

  function normalizeSansho(data) {
    const raw = pick(data, ["sansho", "specialPrizes", "prizes"]);
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((p) => ({
      prize: pick(p, ["type", "prize", "name"]),
      name: pick(p, ["shikonaEn", "rikishiName"])
    })).filter((p) => p.name);
  }

  async function enrich(appBashoId) {
    const container = document.getElementById("previousCard");
    if (!container || !global.SumoAPI) return;
    try {
      const data = await SumoAPI.getBashoResult(appBashoId);
      const yusho = normalizeYusho(data);
      const sansho = normalizeSansho(data);
      if (!yusho.length && !sansho.length) return; // nothing usable — leave the static version showing

      const makuuchi = yusho.find((y) => y.division === "Makuuchi") || yusho[0];
      if (makuuchi) {
        const winnerRow = container.querySelector(".champion-strip .v");
        if (winnerRow) winnerRow.textContent = makuuchi.name;
        const recordRow = container.querySelectorAll(".champion-strip .v")[1];
        if (recordRow && makuuchi.record) recordRow.textContent = makuuchi.record;
      }
      if (sansho.length) {
        const sanshoHTML = `
          <div class="row previous-sansho-row">
            <span class="k" data-i18n="specialPrizes">Special Prizes</span>
            <span class="v">${sansho.map((p) => `${SumoUtil.escapeHTML(p.name)}${p.prize ? ` (${SumoUtil.escapeHTML(p.prize)})` : ""}`).join(", ")}</span>
          </div>`;
        container.insertAdjacentHTML("beforeend", sanshoHTML);
        if (global.I18n) I18n.applyStaticText();
      }
    } catch (e) {
      // leave the static version alone — see module comment
    }
  }

  global.PreviousBasho = { enrich };
})(window);
