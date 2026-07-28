// venue.js — venue reference data (data/venues.json) and the venue /
// timezone panel. Also loads champions.json for the previous-basho panel.
(function (global) {
  "use strict";

  const VenueModule = {
    data: {},
    champions: {},

    async load() {
      this.data = await SumoUtil.fetchJSON("data/venues.json");
      global.VenueData = this.data; // used by countdown.js for the hero meta line
      try { this.champions = (await SumoUtil.fetchJSON("data/champions.json")).records || {}; }
      catch (e) { this.champions = {}; }
      return this.data;
    },

    get(id) { return this.data[id]; },

    renderVenueList(container) {
      container.innerHTML = "";
      Object.values(this.data).forEach((v) => {
        const card = document.createElement("div");
        card.className = "venue-card";
        card.innerHTML = `
          <img src="${v.image}" alt="" loading="lazy" width="84" height="56" />
          <div class="v-body">
            <div class="v-name">${v.name}</div>
            <div class="v-meta">${v.city} · ${I18n.t("capacity")}: ${v.capacity.toLocaleString(I18n.locale())}</div>
            <a class="v-link" href="${v.map}" target="_blank" rel="noopener">${I18n.t("mapLink")} ↗</a>
          </div>`;
        container.appendChild(card);
      });
    },

    renderTimezones(container, startISODate) {
      // Grand sumo top-division bouts run roughly 15:00-18:00 JST; we show
      // the tournament's opening-day start referenced at a representative
      // 08:00 JST doors-open time, converted to each zone, plus whichever
      // zone the user selected in Settings (or their auto-detected zone,
      // if left on "Auto") — that row is highlighted so the timezone
      // preference visibly does something here.
      const base = new Date(startISODate + "T08:00:00+09:00");
      const zones = [
        { label: I18n.t("japan"), tz: "Asia/Tokyo" },
        { label: I18n.t("europe"), tz: "Europe/Amsterdam" },
        { label: I18n.t("usEastern"), tz: "America/New_York" }
      ];
      const effectiveTz = (global.Settings && global.Settings.effectiveTimezone()) || "UTC";
      if (!zones.some((z) => z.tz === effectiveTz)) {
        const label = effectiveTz.includes("/") ? effectiveTz.split("/").pop().replace(/_/g, " ") : effectiveTz;
        zones.push({ label, tz: effectiveTz });
      }
      const rows = zones.map((z) => {
        const fmt = new Intl.DateTimeFormat(I18n.locale(), {
          weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: z.tz
        });
        const isYours = z.tz === effectiveTz;
        return `<div class="row${isYours ? " row-yours" : ""}"><span class="k">${z.label}${isYours ? " ★" : ""}</span><span class="v">${fmt.format(base)}</span></div>`;
      }).join("");
      // Without this, the times above read as ambiguous (start of what?
      // doors, first bout, end of day?) — spell out what they represent.
      const note = `<div class="tz-note">${I18n.t("tzNote")}</div>`;
      container.innerHTML = rows + note;
    }
  };

  global.VenueModule = VenueModule;
})(window);
