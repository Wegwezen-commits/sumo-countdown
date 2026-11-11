// quickstrip.js — the slim "Next banzuke" strip right under the hero
// countdown, so the banzuke release countdown is visible at a glance
// without scrolling down to the Banzuke panel (see #quickPanel in
// index.html). It's a normal, reorderable block (see js/layout.js), so on
// a phone it can be moved above/below anything else.
//
// States, all driven by Schedule.getNextBanzuke() (Japan calendar days):
//   pending  — "Next banzuke · Hatsu Basho 2027 · 41 days · Mon 21 Dec"
//   today    — "Out today!"
//   released — "Released ✓" + a button that jumps to that banzuke
// Dates for tournaments beyond js/schedule.js's official seed data are
// generated placeholders, so those get an "estimated date" tag rather
// than pretending to be fact.
(function (global) {
  "use strict";

  function el() { return document.getElementById("quickPanel"); }

  function dateLabel(iso) {
    try {
      return new Date(iso + "T00:00:00Z").toLocaleDateString(I18n.locale(), {
        weekday: "short", day: "numeric", month: "short", timeZone: "UTC"
      });
    } catch (e) { return iso; }
  }

  function render() {
    const root = el();
    if (!root) return;
    const info = Schedule.getNextBanzuke(new Date());
    if (!info) { root.classList.add("hidden"); return; }
    root.classList.remove("hidden");

    const name = SumoUtil.escapeHTML(`${info.basho.name} ${info.basho.year}`);
    const est = info.estimated
      ? `<span class="quick-est" title="${SumoUtil.escapeHTML(I18n.t("quickEstimatedHint"))}">${I18n.t("quickEstimated")}</span>` : "";

    let right;
    if (info.state === "pending") {
      const unit = I18n.t(info.daysUntil === 1 ? "unitDay" : "unitDays");
      right = `
        <span class="quick-count"><span class="quick-num">${info.daysUntil}</span> <span class="quick-unit">${SumoUtil.escapeHTML(unit)}</span></span>
        <span class="quick-date">${SumoUtil.escapeHTML(dateLabel(info.banzukeDate))} ${est}</span>`;
    } else if (info.state === "today") {
      right = `<span class="quick-count"><span class="quick-num quick-now">${I18n.t("quickBanzukeToday")}</span></span>
               <button type="button" class="ghost-button quick-view" data-basho="${SumoUtil.escapeHTML(info.basho.id)}">${I18n.t("quickViewBanzuke")}</button>`;
    } else {
      right = `<span class="quick-count"><span class="quick-num quick-done">${I18n.t("banzukeReleased")}</span></span>
               <button type="button" class="ghost-button quick-view" data-basho="${SumoUtil.escapeHTML(info.basho.id)}">${I18n.t("quickViewBanzuke")}</button>`;
    }

    root.innerHTML = `
      <div class="quick-main">
        <span class="quick-label">${I18n.t("quickBanzukeLabel")}</span>
        <span class="quick-basho">${name}</span>
      </div>
      <div class="quick-right">${right}</div>`;

    const btn = root.querySelector(".quick-view");
    if (btn) btn.addEventListener("click", () => {
      if (global.Banzuke && Banzuke.selectBasho) Banzuke.selectBasho(btn.getAttribute("data-basho"), { scroll: true });
    });
  }

  global.QuickStrip = { render };
})(window);
