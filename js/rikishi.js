// rikishi.js — a small modal popup showing a wrestler's profile
// (SumoAPI.getRikishi), triggered by clicking/tapping a name in the
// Banzuke or Torikumi panels (see js/banzuke.js, js/torikumi.js — both
// wrap wrestler names in a <button class="rikishi-link" data-rikishi-id=
// "..."> that this module listens for globally via event delegation, so
// neither of those files needs to know this popup exists).
//
// Field names (shikonaEn, currentRank, heya, height, weight, birthDate,
// debut) are best-effort based on sumo-api's own guide and a third-party
// app's documented usage — not all independently confirmed. Missing
// fields are simply omitted from the popup rather than shown as blanks.
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

  async function open(rikishiId, fallbackName) {
    const modal = ensureModal();
    const content = modal.querySelector(".rikishi-modal-content");
    content.innerHTML = `<p class="filter-empty">${I18n.t("rikishiLoading")}</p>`;
    modal.classList.remove("hidden");

    if (!global.SumoAPI) return;
    try {
      const r = await SumoAPI.getRikishi(rikishiId);
      const name = r.shikonaEn || fallbackName || "?";
      content.innerHTML = `
        <h3>${SumoUtil.escapeHTML(name)}</h3>
        <div class="stack">
          ${row(I18n.t("rikishiRank"), r.currentRank)}
          ${row(I18n.t("rikishiStable"), r.heya)}
          ${row(I18n.t("rikishiHeight"), r.height ? `${r.height} cm` : null)}
          ${row(I18n.t("rikishiWeight"), r.weight ? `${r.weight} kg` : null)}
          ${row(I18n.t("rikishiDebut"), r.debut)}
        </div>
        <a class="panel-external-link" href="https://www.sumo-api.com/api/rikishi/${encodeURIComponent(rikishiId)}" target="_blank" rel="noopener noreferrer">${I18n.t("rikishiFullProfile")} ↗</a>
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
