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
      // 08:00 JST doors-open time, converted to each zone, plus the
      // visitor's own auto-detected zone.
      const base = new Date(startISODate + "T08:00:00+09:00");
      const zones = [
        { label: I18n.t("japan"), tz: "Asia/Tokyo" },
        { label: I18n.t("europe"), tz: "Europe/Amsterdam" },
        { label: I18n.t("usEastern"), tz: "America/New_York" }
      ];
      let visitorTz = "UTC";
      try { visitorTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) {}
      if (!zones.some((z) => z.tz === visitorTz)) {
        zones.push({ label: visitorTz.split("/").pop().replace(/_/g, " "), tz: visitorTz });
      }
      container.innerHTML = zones.map((z) => {
        const fmt = new Intl.DateTimeFormat(I18n.locale(), {
          weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: z.tz
        });
        return `<div class="row"><span class="k">${z.label}</span><span class="v">${fmt.format(base)}</span></div>`;
      }).join("");
    }
  };

  global.VenueModule = VenueModule;
})(window);
