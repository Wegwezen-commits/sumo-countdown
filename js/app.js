// app.js — boots the whole page: loads data, wires the settings panel and
// header controls, renders the non-second-precision panels, and starts
// the hero countdown loop.
(function () {
  "use strict";

  function statusLabel(status) {
    return I18n.t({
      completed: "statusCompleted",
      scheduled: "statusScheduled",
      estimated: "statusEstimated",
      live: "statusLive"
    }[status] || "statusEstimated");
  }

  function renderUpcomingSix() {
    const container = document.getElementById("nextSix");
    const now = new Date();
    const six = Schedule.getUpcomingSix(now);
    container.innerHTML = six.map((b) => {
      const venue = VenueModule.get(b.venueId);
      const range = SumoUtil.formatRange(b.startDate, b.endDate, I18n.locale());
      let countText;
      if (b.computedStatus === "live") {
        const info = Live.status(b, now);
        countText = I18n.t("dayOf", { current: info.dayIndex, total: info.totalDays });
      } else {
        const days = SumoUtil.daysBetween(b.startDate, now);
        countText = days <= 0 ? "—" : `${days}d`;
      }
      return `
        <article class="t-card">
          <span class="t-status">${statusLabel(b.computedStatus)}</span>
          <div class="t-name">${b.name}</div>
          <div class="t-venue">${venue ? venue.name : ""}${venue ? " · " + venue.city : ""}</div>
          <div class="t-date">${range}</div>
          <div class="t-count">${countText}</div>
        </article>`;
    }).join("");
  }

  function renderLivePanel() {
    const container = document.getElementById("liveCard");
    const now = new Date();
    const live = Schedule.getLive(now);
    if (!live) {
      container.innerHTML = `<div class="row"><span class="k">${I18n.t("status")}</span><span class="v">—</span></div>`;
      return;
    }
    const info = Live.status(live, now);
    const venue = VenueModule.get(live.venueId);
    container.innerHTML = `
      <div class="row"><span class="k">${I18n.t("nextBasho")}</span><span class="v">${live.name}</span></div>
      <div class="row"><span class="k">${I18n.t("venue")}</span><span class="v">${venue ? venue.name : ""}</span></div>
      <div class="row"><span class="k">${I18n.t("dayOf", { current: info.dayIndex, total: info.totalDays })}</span><span class="v">${I18n.t("daysRemaining", { n: info.daysRemaining })}</span></div>`;
  }

  function renderStatsPanel() {
    const container = document.getElementById("statsCard");
    const all = Schedule.all();
    const now = new Date();
    const past = all.filter((b) => new Date(b.endDate + "T23:59:59Z") < now && b.official);
    const withChampion = past.filter((b) => b.champion);
    const progress = Schedule.progressBetween(now);
    container.innerHTML = `
      <div class="row"><span class="k">${I18n.t("progressLabel")}</span><span class="v">${progress === null ? "—" : progress + "%"}</span></div>
      <div class="row"><span class="k">Tournaments tracked</span><span class="v">${all.length}</span></div>
      <div class="row"><span class="k">Official results on record</span><span class="v">${withChampion.length}</span></div>
    `;
  }

  function renderPreviousPanel() {
    const container = document.getElementById("previousCard");
    const now = new Date();
    const prev = Schedule.getPrevious(now);
    if (!prev) { container.innerHTML = "—"; return; }
    const venue = VenueModule.get(prev.venueId);
    const range = SumoUtil.formatRange(prev.startDate, prev.endDate, I18n.locale());
    const champExtra = VenueModule.champions[prev.id];
    const photo = (champExtra && champExtra.photo) || "assets/pixel/champion-medallion.png";
    const champion = prev.champion || (champExtra && champExtra.champion) || "—";
    container.innerHTML = `
      <div class="champion-strip">
        <img src="${photo}" alt="" loading="lazy" width="56" height="56" />
        <div>
          <div class="row" style="border:none;padding:2px 0;"><span class="k">${I18n.t("winner")}</span><span class="v">${champion}</span></div>
          <div class="row" style="border:none;padding:2px 0;"><span class="k">${I18n.t("record")}</span><span class="v">${prev.record || "—"}</span></div>
        </div>
      </div>
      <div class="row"><span class="k">${I18n.t("runnerUp")}</span><span class="v">${prev.runnerUp || "—"}</span></div>
      <div class="row"><span class="k">${I18n.t("venue")}</span><span class="v">${venue ? venue.name : ""}</span></div>
      <div class="row"><span class="k">${I18n.t("dates")}</span><span class="v">${range}</span></div>
    `;
  }

  function updateTzPreview() {
    const el = document.getElementById("tzPreview");
    if (!el) return;
    const tz = Settings.effectiveTimezone();
    try {
      const fmt = new Intl.DateTimeFormat(I18n.locale(), {
        weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz
      });
      const label = Settings.prefs.timezone === "auto" ? `${tz} (${I18n.t("autoDetected")})` : tz;
      el.innerHTML = `${I18n.t("currentlyIn")} <strong>${label}</strong>: <strong>${fmt.format(new Date())}</strong>`;
    } catch (e) {
      el.textContent = "—";
    }
  }

  function renderVenuesPanel() {
    const container = document.getElementById("venueCard");
    container.innerHTML = "";
    const list = document.createElement("div");
    list.className = "stack";
    VenueModule.renderVenueList(list);
    container.appendChild(list);

    const tzWrap = document.createElement("div");
    tzWrap.style.marginTop = "10px";
    const next = Schedule.getNextUpcoming(new Date());
    if (next) VenueModule.renderTimezones(tzWrap, next.startDate);
    container.appendChild(tzWrap);
  }

  function updateVenueScene() {
    const el = document.getElementById("venueScene");
    if (!el) return;
    const now = new Date();
    const live = Schedule.getLive(now);
    const entry = live || Schedule.getNextUpcoming(now);
    if (!entry) return;
    const venue = VenueModule.get(entry.venueId);
    if (!venue) return;
    const src = Settings.isJapanNight() ? (venue.imageNight || venue.image) : venue.image;
    const full = "url('" + src + "')";
    if (el.style.backgroundImage !== full) el.style.backgroundImage = full;
  }

  function renderAllPanels() {
    renderUpcomingSix();
    renderLivePanel();
    renderStatsPanel();
    renderPreviousPanel();
    renderVenuesPanel();
    updateVenueScene();
  }

  // ---------- Settings dialog ----------
  function wireSettings() {
    const gear = document.getElementById("settingsButton");
    const dialog = document.getElementById("settingsDialog");
    const backdrop = dialog.querySelector(".settings-backdrop");
    const closeBtn = document.getElementById("settingsClose");

    function open() {
      dialog.classList.add("open");
      dialog.setAttribute("aria-hidden", "false");
      closeBtn.focus();
    }
    function close() {
      dialog.classList.remove("open");
      dialog.setAttribute("aria-hidden", "true");
      gear.focus();
    }
    gear.addEventListener("click", open);
    backdrop.addEventListener("click", close);
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && dialog.classList.contains("open")) close(); });

    const p = Settings.prefs;
    const sSakura = document.getElementById("prefSakura");
    const sAudio = document.getElementById("prefAudio");
    const sMusic = document.getElementById("prefMusic");
    const sVolume = document.getElementById("prefVolume");
    const sVolumeValue = document.getElementById("prefVolumeValue");
    const sCompact = document.getElementById("prefCompact");
    const sUltra = document.getElementById("prefUltra");
    const sTv = document.getElementById("prefTv");
    const sTheme = document.getElementById("prefTheme");
    const sTz = document.getElementById("tzSelect");
    const sLang = document.getElementById("langSelect");

    sSakura.checked = p.sakura;
    sAudio.checked = p.audio;
    sMusic.checked = p.music;
    sVolume.value = p.volume;
    sVolumeValue.textContent = `${p.volume}%`;
    sCompact.checked = p.compact;
    sUltra.checked = p.ultra;
    sTv.checked = p.tv;
    sTheme.value = p.theme;
    sTz.value = p.timezone;
    sLang.value = I18n.lang;

    sSakura.addEventListener("change", () => { Settings.set("sakura", sSakura.checked); if (sSakura.checked) Animations.startSakura(); else Animations.stopSakura(); });
    sAudio.addEventListener("change", () => { Settings.set("audio", sAudio.checked); SumoAudio.unlock(); });
    sMusic.addEventListener("change", () => { SumoAudio.unlock(); Settings.set("music", sMusic.checked); });
    sVolume.addEventListener("input", () => {
      Settings.set("volume", Number(sVolume.value));
      sVolumeValue.textContent = `${sVolume.value}%`;
    });
    sCompact.addEventListener("change", () => Settings.set("compact", sCompact.checked));
    sUltra.addEventListener("change", () => Settings.set("ultra", sUltra.checked));
    sTv.addEventListener("change", () => Settings.set("tv", sTv.checked));
    sTheme.addEventListener("change", () => Settings.set("theme", sTheme.value));
    sTz.addEventListener("change", () => { Settings.set("timezone", sTz.value); renderVenuesPanel(); updateTzPreview(); });
    sLang.addEventListener("change", () => { I18n.set(sLang.value); renderAllPanels(); Countdown.render(); });

    document.getElementById("tvExitButton").addEventListener("click", () => {
      sTv.checked = false;
      Settings.set("tv", false);
    });
  }

  async function init() {
    Settings.load();
    Settings.apply();
    Animations.applySeason();
    Animations.playLaunchRope();

    await I18n.load();
    I18n.applyStaticText();

    await Promise.all([Schedule.load(), VenueModule.load()]);

    wireSettings();
    renderAllPanels();
    updateTzPreview();
    setInterval(updateTzPreview, 1000);
    Countdown.start();
    PWA.init();

    document.querySelectorAll(".ghost-button, .icon-button").forEach((btn) => {
      btn.addEventListener("click", () => SumoAudio.playClick());
    });

    const loadingScreen = document.getElementById("loadingScreen");
    if (loadingScreen) {
      requestAnimationFrame(() => loadingScreen.classList.add("hidden"));
      setTimeout(() => loadingScreen.remove(), 900);
    }

    if (Settings.prefs.sakura) Animations.startSakura();

    // Keep slower panels fresh without hammering the DOM every second.
    setInterval(renderAllPanels, 60 * 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
