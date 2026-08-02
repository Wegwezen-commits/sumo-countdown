// notify.js — local notifications for two events: the banzuke being
// released, and a basho starting (both "starts tomorrow" and "starts
// today/now live"). Each fires at most once per basho (tracked via
// SumoUtil.storage flags) so re-opening the app doesn't repeat them.
//
// IMPORTANT LIMITATION: these are NOT push notifications. They only fire
// while this site is open in a tab (checked on load, hourly while open,
// and whenever the tab becomes visible again) — there's no way to notify
// someone whose browser is fully closed without a backend push service
// (Web Push + VAPID keys + a subscription store), which this static site
// doesn't have. If that's wanted later, the Cloudflare Worker already
// built for Twitch viewer stats (see js/streams.js) could plausibly grow
// into that backend, but it's a genuinely separate feature, not a small
// extension — flagging rather than half-building it.
(function (global) {
  "use strict";

  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly while the tab is open
  const BANZUKE_GRACE_DAYS = 3; // still notify if opened up to N days after release, not just the exact day

  function seen(key) { return !!SumoUtil.storage.get(`notified:${key}`, false); }
  function markSeen(key) { SumoUtil.storage.set(`notified:${key}`, true); }

  async function fire(title, body, tag) {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          return reg.showNotification(title, { body, tag, icon: "assets/icons/icon-192.png" });
        }
      }
    } catch (e) { /* fall through to a plain Notification below */ }
    try { new Notification(title, { body, tag }); } catch (e) { /* notifications unsupported/blocked — silently skip */ }
  }

  async function checkAndNotify() {
    if (!global.Settings || !Settings.prefs.notifications) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    await Schedule.load();
    const now = new Date();

    const banzuke = Schedule.getBanzukeInfo(now);
    if (banzuke && banzuke.released) {
      const key = `banzuke:${banzuke.basho.id}`;
      const banzukeDate = new Date(banzuke.banzukeDate + "T00:00:00Z");
      const daysSinceRelease = Math.floor((now.getTime() - banzukeDate.getTime()) / 86400000);
      if (!seen(key) && daysSinceRelease >= 0 && daysSinceRelease <= BANZUKE_GRACE_DAYS) {
        fire(I18n.t("notifyBanzukeTitle"), I18n.t("notifyBanzukeBody", { basho: banzuke.basho.name }), key);
        markSeen(key);
      }
    }

    const live = Schedule.getLive(now);
    if (live) {
      const key = `live:${live.id}`;
      if (!seen(key)) {
        fire(I18n.t("notifyLiveTitle"), I18n.t("notifyLiveBody", { basho: live.name }), key);
        markSeen(key);
      }
    } else {
      const next = Schedule.getNextUpcoming(now);
      if (next) {
        const daysUntil = SumoUtil.daysBetween(next.startDate, now);
        const key = `tomorrow:${next.id}`;
        if (daysUntil === 1 && !seen(key)) {
          fire(I18n.t("notifyTomorrowTitle"), I18n.t("notifyTomorrowBody", { basho: next.name }), key);
          markSeen(key);
        }
      }
    }
  }

  async function enable() {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") { Settings.set("notifications", true); checkAndNotify(); return true; }
    if (Notification.permission === "denied") return false;
    const perm = await Notification.requestPermission();
    if (perm === "granted") { Settings.set("notifications", true); checkAndNotify(); return true; }
    return false;
  }

  function disable() { Settings.set("notifications", false); }

  function init() {
    if (global.Settings && Settings.prefs.notifications) checkAndNotify();
    setInterval(checkAndNotify, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkAndNotify(); });
  }

  global.Notify = { init, enable, disable, supported: typeof Notification !== "undefined" };
})(window);
