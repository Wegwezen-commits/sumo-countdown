// layout.js — lets the visitor reorder the blocks of the page's info grid
// (basho countdown with the rikishi, banzuke countdown strip, Watch, Torikumi, Banzuke, News, …), mainly so a
// phone user can put what they care about first — e.g. the banzuke
// countdown right under the basho countdown, or Torikumi above Watch.
//
// UI: Settings → "Page layout": one row per block with ▲/▼ buttons (buttons
// rather than drag-and-drop, because dragging fights with scrolling on touch
// screens and isn't keyboard-accessible). The order is saved in the
// `layoutOrder` pref (localStorage via Settings) and applied to the real DOM
// order, so tab order and screen readers follow what's on screen.
//
// Robustness: ids that no longer exist are ignored, and blocks that are new
// since the order was saved are appended in their default position — adding a
// panel to index.html later can't break anyone's saved layout.
(function (global) {
  "use strict";

  // block id → translation key for its name in the settings list
  const NAMES = {
    heroPanel: "layoutHero",
    watchPanel: "watchSumo",
    torikumiPanel: "torikumi",
    banzukePanel: "banzuke",
    newsPanel: "news",
    previousPanel: "previous",
    statsPanel: "stats",
    upcomingPanel: "upcoming",
    venuesPanel: "venues"
  };

  let grid = null;
  let defaultOrder = [];

  function currentOrder() {
    const saved = Array.isArray(Settings.prefs.layoutOrder) ? Settings.prefs.layoutOrder : [];
    const known = saved.filter((id) => defaultOrder.includes(id));
    const fresh = defaultOrder.filter((id) => !known.includes(id));
    // New blocks slot in at their default neighbour rather than at the very end.
    fresh.forEach((id) => {
      const prev = defaultOrder[defaultOrder.indexOf(id) - 1];
      const at = prev ? known.indexOf(prev) : -1;
      known.splice(at + 1, 0, id);
    });
    return known;
  }

  // Put the grid's children in `order` with as few moves as possible.
  // Moving a node re-inserts it, which reloads any iframe inside it, so we
  // only touch nodes that are actually out of place.
  function apply(order) {
    let cursor = grid.firstElementChild;
    order.forEach((id) => {
      const node = document.getElementById(id);
      if (!node || node.parentElement !== grid) return;
      if (node === cursor) cursor = cursor.nextElementSibling;
      else grid.insertBefore(node, cursor);
    });
  }

  function label(id) {
    const key = NAMES[id];
    return (key && I18n.t(key)) || id;
  }

  function renderList(focus) {
    const list = document.getElementById("layoutList");
    if (!list) return;
    const order = currentOrder();
    list.innerHTML = order.map((id, i) => {
      const name = SumoUtil.escapeHTML(label(id));
      const up = SumoUtil.escapeHTML(I18n.t("layoutMoveUp", { name: label(id) }));
      const down = SumoUtil.escapeHTML(I18n.t("layoutMoveDown", { name: label(id) }));
      return `<li class="layout-item" data-id="${id}">
        <span class="layout-name">${name}</span>
        <button type="button" class="icon-button layout-move" data-dir="-1" aria-label="${up}" ${i === 0 ? "disabled" : ""}>▲</button>
        <button type="button" class="icon-button layout-move" data-dir="1" aria-label="${down}" ${i === order.length - 1 ? "disabled" : ""}>▼</button>
      </li>`;
    }).join("");
    if (focus) {
      // Keep keyboard focus on the same control after the list re-renders;
      // if that button just became disabled (item hit the end), use its twin.
      const row = list.querySelector(`[data-id="${focus.id}"]`);
      if (row) {
        let btn = row.querySelector(`[data-dir="${focus.dir}"]`);
        if (btn && btn.disabled) btn = row.querySelector(`[data-dir="${-focus.dir}"]`);
        if (btn) btn.focus();
      }
    }
  }

  function move(id, dir) {
    const order = currentOrder();
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    Settings.set("layoutOrder", order);
    apply(order);
    renderList({ id, dir });
  }

  function reset() {
    Settings.set("layoutOrder", []);
    apply(defaultOrder);
    renderList();
  }

  function init() {
    grid = document.querySelector(".info-grid");
    if (!grid) return;
    defaultOrder = Array.from(grid.children).map((n) => n.id).filter((id) => id && NAMES[id]);
    apply(currentOrder());

    const list = document.getElementById("layoutList");
    if (list) list.addEventListener("click", (e) => {
      const btn = e.target.closest(".layout-move");
      if (!btn || btn.disabled) return;
      move(btn.closest(".layout-item").getAttribute("data-id"), Number(btn.getAttribute("data-dir")));
    });
    const resetBtn = document.getElementById("layoutReset");
    if (resetBtn) resetBtn.addEventListener("click", reset);

    renderList();
    // Block names are translated, so redraw the list when the language changes.
    document.addEventListener("languagechange", () => renderList());
  }

  global.Layout = { init };
})(window);
