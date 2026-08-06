// rikishi.js — a small modal popup showing a wrestler's profile,
// triggered by clicking/tapping a name in the Banzuke or Torikumi panels
// (see js/banzuke.js, js/torikumi.js — both wrap wrestler names in a
// <button class="rikishi-link" data-rikishi-id="..."> that this module
// listens for globally via event delegation, so neither of those files
// needs to know this popup exists).
//
// Basic profile fields (shikonaEn, currentRank, heya, birthDate,
// shusshin, height, weight, debut) are CONFIRMED real — verified against
// an actual live response from this exact endpoint. The per-division
// stats table (SumoAPI.getRikishiStats) is best-effort on field names —
// confirmed that the endpoint returns career + per-division win/loss/
// yusho/special-prize data (via sumo-api's own dashboard rendering of
// it), but not the exact JSON keys, so this tries several plausible
// shapes and simply omits the table if none of them match rather than
// showing broken/blank rows.
(function (global) {
  "use strict";

  let modalEl = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.className = "rikishi-modal hidden";
    modalEl.innerHTML = `
      <div class="rikishi-modal-backdrop"></div>
      <div class="rikishi-modal-body pixel-corners" role="dialog" aria-modal="true">
        <button type="button" class="rikishi-modal-close" aria-label="Close">×</button>
        <div class="rikishi-modal-content"></div>
      </div>`;
    document.body.appendChild(modalEl);
    modalEl.querySelector(".rikishi-modal-backdrop").addEventListener("click", close);
    modalEl.querySelector(".rikishi-modal-close").addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    return modalEl;
  }

  function close() {
    if (modalEl) modalEl.classList.add("hidden");
  }

  function row(label, value) {
    return value ? `<div class="row"><span class="k">${SumoUtil.escapeHTML(label)}</span><span class="v">${SumoUtil.escapeHTML(String(value))}</span></div>` : "";
  }

  function formatDate(iso) {
    if (!iso) return null;
    try { return new Intl.DateTimeFormat(I18n.locale(), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso)); }
    catch (e) { return iso; }
  }

  function pick(obj, keys) {
    for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
    return null;
  }

  // Best-effort: try a few plausible shapes for per-division stats.
  // Returns null (table omitted entirely) rather than a half-guessed one
  // if nothing matches.
  function statsRows(stats) {
    if (!stats) return null;
    const divisions = ["Career", "Makuuchi", "Juryo", "Makushita", "Sandanme", "Jonidan", "Jonokuchi"];
    const byDivision = pick(stats, ["byDivision", "divisions", "stats"]) || stats;
    const rows = divisions.map((div) => {
      const key = div === "Career" ? "career" : div;
      const d = pick(byDivision, [key, div, div.toLowerCase()]);
      if (!d) return null;
      const wins = pick(d, ["wins", "w"]);
      const losses = pick(d, ["losses", "l"]);
      if (wins == null && losses == null) return null;
      return { div, basho: pick(d, ["basho", "bashoCount"]), yusho: pick(d, ["yusho"]), wins, losses, absences: pick(d, ["absences", "absentDays"]) };
    }).filter(Boolean);
    return rows.length ? rows : null;
  }

  function statsTableHTML(rows) {
    if (!rows) return "";
    return `
      <table class="rikishi-stats-table">
        <thead><tr>
          <th>${I18n.t("rikishiDivision")}</th><th>${I18n.t("rikishiWins")}</th><th>${I18n.t("rikishiLosses")}</th><th>${I18n.t("rikishiYusho")}</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${SumoUtil.escapeHTML(r.div)}</td><td>${r.wins ?? "—"}</td><td>${r.losses ?? "—"}</td><td>${r.yusho ?? "—"}</td></tr>`).join("")}
        </tbody>
      </table>`;
  }

  async function open(rikishiId, fallbackName) {
    const modal = ensureModal();
    const content = modal.querySelector(".rikishi-modal-content");
    content.innerHTML = `<p class="filter-empty">${I18n.t("rikishiLoading")}</p>`;
    modal.classList.remove("hidden");

    if (!global.SumoAPI) return;
    try {
      const [r, stats] = await Promise.all([
        SumoAPI.getRikishi(rikishiId),
        SumoAPI.getRikishiStats(rikishiId).catch(() => null)
      ]);
      const name = r.shikonaEn || fallbackName || "?";
      const rows = statsRows(stats);
      content.innerHTML = `
        <h3>${SumoUtil.escapeHTML(name)}${r.shikonaJp ? ` <span class="rikishi-modal-jp">${SumoUtil.escapeHTML(r.shikonaJp)}</span>` : ""}</h3>
        <div class="stack">
          ${row(I18n.t("rikishiRank"), r.currentRank)}
          ${row(I18n.t("rikishiStable"), r.heya)}
          ${row(I18n.t("rikishiBirthDate"), formatDate(r.birthDate))}
          ${row(I18n.t("rikishiBirthplace"), r.shusshin)}
          ${row(I18n.t("rikishiHeight"), r.height ? `${r.height} cm` : null)}
          ${row(I18n.t("rikishiWeight"), r.weight ? `${r.weight} kg` : null)}
          ${row(I18n.t("rikishiDebut"), r.debut)}
        </div>
        ${statsTableHTML(rows)}
        <a class="panel-external-link" href="https://www.sumo-api.com/dashboard/rikishi/${encodeURIComponent(rikishiId)}" target="_blank" rel="noopener noreferrer">${I18n.t("rikishiFullProfile")} ↗</a>
      `;
    } catch (e) {
      content.innerHTML = `<p class="filter-empty">${I18n.t("rikishiUnavailable")}</p>`;
    }
  }

  function init() {
    document.addEventListener("click", (e) => {
      const link = e.target.closest(".rikishi-link");
      if (!link) return;
      const id = link.getAttribute("data-rikishi-id");
      if (id) open(id, link.textContent);
    });
  }

  global.RikishiProfile = { init };
})(window);

