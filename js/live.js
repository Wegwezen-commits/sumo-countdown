// live.js — Live Basho Mode. While a tournament is running, the hero
// swaps "Days until" for a "Basho Live" badge, shows which of the 15
// days it is, and re-targets the countdown at Senshūraku (the final
// day) instead of the next Day One.
(function (global) {
  "use strict";

  const Live = {
    status(entry, now) {
      now = now || new Date();
      if (!entry) return null;
      const start = new Date(entry.startDate + "T00:00:00Z");
      const endBoundary = new Date(entry.endDate + "T23:59:59Z");
      if (now < start || now > endBoundary) return null;

      const endMidnight = new Date(entry.endDate + "T00:00:00Z");
      const dayIndex = Math.floor((now - start) / 86400000) + 1; // 1-15
      const totalDays = Math.round((endMidnight - start) / 86400000) + 1; // usually 15
      const senshuraku = new Date(start.getTime() + (totalDays - 1) * 86400000);
      // Senshūraku target set to end of that day's competition window (23:59:59 JST-ish)
      senshuraku.setUTCHours(23, 59, 59, 999);
      const daysRemaining = Math.max(0, Math.ceil((senshuraku - now) / 86400000));

      return {
        dayIndex: SumoUtil.clamp(dayIndex, 1, totalDays),
        totalDays,
        daysRemaining,
        target: senshuraku
      };
    }
  };

  global.Live = Live;
})(window);
