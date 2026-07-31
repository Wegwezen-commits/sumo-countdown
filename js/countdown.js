// countdown.js — drives the hero clock. Ticks once a second, only ever
// touches the DOM when a digit's value actually changes (so it never
// jumps or flickers), and hands off to Live Basho Mode automatically
// while a tournament is in progress.
(function (global) {
  "use strict";

  const els = {};
  let lastValues = { d: null, h: null, m: null, s: null };
  let tickHandle = null;

  function cacheEls() {
    els.eyebrow = document.getElementById("eyebrow");
    els.days = document.getElementById("days");
    els.hours = document.getElementById("hours");
    els.minutes = document.getElementById("minutes");
    els.seconds = document.getElementById("seconds");
    els.daysLabel = document.querySelector('[data-clock-label="days"]');
    els.liveBadge = document.getElementById("liveBadge");
    els.bashoName = document.getElementById("bashoName");
    els.bashoMeta = document.getElementById("bashoMeta");
    els.progressBar = document.getElementById("progressBar");
    els.progressText = document.getElementById("progressText");
    els.clock = document.getElementById("clock");
    els.heroSprite = document.getElementById("heroSprite");
  }

  function setDigit(el, value, key) {
    const str = SumoUtil.pad(value);
    if (lastValues[key] === str) return;
    lastValues[key] = str;
    el.textContent = str;
    el.classList.remove("flip");
    // Force reflow so the animation restarts every change
    void el.offsetWidth;
    el.classList.add("flip");
  }

  function diffParts(targetMs, nowMs) {
    let remain = Math.max(0, targetMs - nowMs);
    const d = Math.floor(remain / 86400000); remain -= d * 86400000;
    const h = Math.floor(remain / 3600000); remain -= h * 3600000;
    const m = Math.floor(remain / 60000); remain -= m * 60000;
    const s = Math.floor(remain / 1000);
    return { d, h, m, s };
  }

  let lastMusicState = null;
  function setMusicState(state) {
    if (state === lastMusicState) return;
    lastMusicState = state;
    SumoAudio.startMusic(state);
  }

  let celebrating = false;
  // The heroSprite's "celebrate" pose is now worn for the whole live
  // window (see render() below), not just flashed at a zero-crossing —
  // this helper is only left responsible for the victory sound/music
  // pulse that plays at the moment a countdown actually hits zero.
  function pulseVictory() {
    if (celebrating) return;
    celebrating = true;
    setMusicState("victory");
    setTimeout(() => {
      celebrating = false;
      lastMusicState = null; // let the next tick pick idle/countdown/live again
    }, 6000);
  }

  function render() {
    const now = new Date();
    const live = Schedule.getLive(now);
    const liveInfo = live ? Live.status(live, now) : null;

    if (liveInfo) {
      if (els.heroSprite) els.heroSprite.classList.add("celebrate");
      els.liveBadge.classList.remove("hidden");
      els.liveBadge.innerHTML = `<span class="dot" aria-hidden="true"></span> ${I18n.t("liveBadge")}`;
      els.eyebrow.textContent = I18n.t("basholive");
      els.bashoName.textContent = `${live.name}`;
      els.bashoMeta.textContent = `${I18n.t("dayOf", { current: liveInfo.dayIndex, total: liveInfo.totalDays })} · ${I18n.t("daysRemaining", { n: liveInfo.daysRemaining })}`;
      const parts = diffParts(liveInfo.target.getTime(), now.getTime());
      setDigit(els.days, parts.d, "d");
      setDigit(els.hours, parts.h, "h");
      setDigit(els.minutes, parts.m, "m");
      setDigit(els.seconds, parts.s, "s");
      els.progressText.textContent = I18n.t("untilSenshuraku");
      els.progressBar.style.width = `${100 - SumoUtil.clamp(Math.round((liveInfo.daysRemaining / liveInfo.totalDays) * 100), 0, 100)}%`;

      if (parts.d === 0 && parts.h === 0 && parts.m === 0 && parts.s === 0) {
        SumoAudio.onZero(live.id + "-senshuraku");
        pulseVictory();
      } else {
        setMusicState(liveInfo.dayIndex >= liveInfo.totalDays ? "finalDay" : "live");
      }
      Animations.maybeShowSaltEgg(null);
      return;
    }

    els.liveBadge.classList.add("hidden");
    if (els.heroSprite) els.heroSprite.classList.remove("celebrate");
    const next = Schedule.getNextUpcoming(now);
    if (!next) {
      els.bashoMeta.textContent = "—";
      return;
    }
    els.eyebrow.textContent = I18n.t("daysUntil");
    els.bashoName.textContent = next.name;
    const range = SumoUtil.formatRange(next.startDate, next.endDate, I18n.locale());
    const venue = (global.VenueData && global.VenueData[next.venueId]) || null;
    els.bashoMeta.textContent = venue ? `${venue.city} · ${range}` : range;

    const target = new Date(next.startDate + "T00:00:00Z").getTime();
    const parts = diffParts(target, now.getTime());
    setDigit(els.days, parts.d, "d");
    setDigit(els.hours, parts.h, "h");
    setDigit(els.minutes, parts.m, "m");
    setDigit(els.seconds, parts.s, "s");

    const progress = Schedule.progressBetween(now);
    if (progress !== null) {
      els.progressBar.style.width = `${progress}%`;
      els.progressText.textContent = `${I18n.t("progressLabel")}: ${progress}%`;
    } else {
      els.progressBar.style.width = "0%";
      els.progressText.textContent = "";
    }

    const hoursUntil = (target - now.getTime()) / 3600000;
    Animations.maybeShowSaltEgg(hoursUntil);

    if (parts.d === 0 && parts.h === 0 && parts.m === 0 && parts.s === 0) {
      SumoAudio.onZero(next.id + "-start");
      pulseVictory();
    } else {
      setMusicState(hoursUntil <= 48 ? "countdown" : "idle");
    }
  }

  function start() {
    cacheEls();
    render();
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(render, 1000);
  }

  global.Countdown = { start, render };
})(window);
