// schedule.js — loads data/schedule.json (official JSA dates) and generates
// any tournament beyond the last official entry using the standard
// six-basho-a-year cadence, so the app never stops working and an end
// year is never hardcoded. When official dates are added to schedule.json
// (by hand or by the weekly GitHub Action), they automatically take
// priority over generated placeholders for the same slot.
(function (global) {
  "use strict";

  const MONTH_INFO = {
    1: { name: "Hatsu Basho", nameJa: "初場所", venueId: "ryogoku" },
    3: { name: "Haru Basho", nameJa: "春場所", venueId: "edion-osaka" },
    5: { name: "Natsu Basho", nameJa: "夏場所", venueId: "ryogoku" },
    7: { name: "Nagoya Basho", nameJa: "名古屋場所", venueId: "ig-arena" },
    9: { name: "Aki Basho", nameJa: "秋場所", venueId: "ryogoku" },
    11: { name: "Kyushu Basho", nameJa: "九州場所", venueId: "fukuoka" }
  };
  const MONTHS = [1, 3, 5, 7, 9, 11];

  function secondSunday(year, month /* 1-12 */) {
    // month is 1-indexed here; JS Date month is 0-indexed
    const first = new Date(Date.UTC(year, month - 1, 1));
    const firstDow = first.getUTCDay(); // 0 = Sunday
    const firstSunday = 1 + ((7 - firstDow) % 7);
    const second = firstSunday + 7;
    return new Date(Date.UTC(year, month - 1, second));
  }

  function toISO(d) {
    return d.toISOString().slice(0, 10);
  }

  function generateEntry(year, month) {
    const info = MONTH_INFO[month];
    const start = secondSunday(year, month);
    const end = new Date(start.getTime() + 14 * 86400000); // 15-day tournament
    return {
      id: `${year}-${String(month).padStart(2, "0")}`,
      name: info.name,
      nameJa: info.nameJa,
      month, year,
      venueId: info.venueId,
      startDate: toISO(start),
      endDate: toISO(end),
      official: false,
      status: "estimated"
    };
  }

  async function buildSchedule() {
    const seed = await SumoUtil.fetchJSON("data/schedule.json");
    const seedMap = new Map(seed.basho.map((b) => [b.id, b]));

    const now = new Date();
    const seedYears = seed.basho.map((b) => b.year);
    const earliestYear = Math.min(...seedYears);
    const targetYear = now.getUTCFullYear() + 6; // always keep 6+ years generated ahead

    const list = [];
    for (let year = earliestYear; year <= targetYear; year++) {
      for (const month of MONTHS) {
        const id = `${year}-${String(month).padStart(2, "0")}`;
        list.push(seedMap.get(id) || generateEntry(year, month));
      }
    }
    list.sort((a, b) => a.startDate.localeCompare(b.startDate));
    return list;
  }

  function computeStatus(entry, now) {
    const start = new Date(entry.startDate + "T00:00:00Z");
    const end = new Date(entry.endDate + "T23:59:59Z");
    if (now >= start && now <= end) return "live";
    if (entry.status === "completed" || now > end) return entry.official ? "completed" : "estimated";
    return entry.official ? "scheduled" : "estimated";
  }

  const Schedule = {
    _all: null,

    async load() {
      if (!this._all) this._all = await buildSchedule();
      return this._all;
    },

    all() { return this._all || []; },

    getLive(now) {
      now = now || new Date();
      return this.all().find((b) => computeStatus(b, now) === "live") || null;
    },

    getNextUpcoming(now) {
      now = now || new Date();
      const live = this.getLive(now);
      if (live) return live;
      return this.all().find((b) => new Date(b.startDate + "T00:00:00Z") > now) || null;
    },

    getPrevious(now) {
      now = now || new Date();
      const past = this.all().filter((b) => new Date(b.endDate + "T23:59:59Z") < now);
      return past.length ? past[past.length - 1] : null;
    },

    getUpcomingSix(now) {
      now = now || new Date();
      const live = this.getLive(now);
      const upcoming = this.all().filter((b) => {
        const end = new Date(b.endDate + "T23:59:59Z");
        return end >= now;
      });
      return upcoming.slice(0, 6).map((b) => ({ ...b, computedStatus: computeStatus(b, now) }));
    },

    statusOf(entry, now) { return computeStatus(entry, now || new Date()); },

    // Progress between the previous basho's end and the next basho's start, 0-100
    progressBetween(now) {
      now = now || new Date();
      const prev = this.getPrevious(now);
      const next = this.getNextUpcoming(now);
      if (!prev || !next || this.getLive(now)) return null;
      const start = new Date(prev.endDate + "T23:59:59Z").getTime();
      const end = new Date(next.startDate + "T00:00:00Z").getTime();
      const cur = now.getTime();
      if (end <= start) return null;
      return SumoUtil.clamp(Math.round(((cur - start) / (end - start)) * 100), 0, 100);
    }
  };

  global.Schedule = Schedule;
})(window);
