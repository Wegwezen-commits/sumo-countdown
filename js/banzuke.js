// banzuke.js — the Banzuke panel, now fully self-contained: a Basho
// selector (any past tournament, the live one, or the next upcoming one
// — see Schedule.getSelectableBasho) and a Division selector, browsable
// independently of whether a basho is currently live. Previously this
// panel hid itself and showed day-of-basho info instead while a basho
// was live — that's no longer the case, since the hero countdown area
// already shows live/day-of-basho status on its own (see js/countdown.js),
// making that duplication pointless once this became independently
// browsable. The one thing that still depends on live/release state is
// what happens when the SELECTED basho is the upcoming one and its
// banzuke hasn't been released yet — that still shows a countdown
// instead of attempting a fetch that would just fail.
//
// Field names (rikishiID, shikonaEn, rank) are confirmed against a real
// third-party app's documented usage of the banzuke endpoint — see the
// comment in js/sumoapi.js.
//
// BETWEEN TOURNAMENTS (added): once a basho ends and until the next
// banzuke is released, the panel defaults to the basho that just finished
// and shows (a) Fred Pinkerton's three-basho chart (JPG/PDF links, see
// data/charts.json) and (b) rough ▲/▼ markers for obvious risers and
// fallers in Makuuchi/Juryo plus a short list of possible Juryo promotion
// candidates, computed from that basho's records. (b) is a crude,
// explicitly unofficial heuristic — see movement() — not a prediction of
// what the JSA will actually do.
(function (global) {
  "use strict";

  const DIVISIONS = ["Makuuchi", "Juryo", "Makushita", "Sandanme", "Jonidan", "Jonokuchi"];
  const DIVISION_KEY = "banzukeDivision";
  const BANZUKE_URL = "https://sumo.or.jp/EnHonbashoBanzuke/index/";

  let selectableBasho = [];
  let state = { bashoId: null, division: SumoUtil.storage.get(DIVISION_KEY, "Makuuchi") };
  let chartsConfig = null;   // data/charts.json (loaded once)
  let renderToken = 0;       // drops stale async renders when selections change quickly

  function els() {
    return {
      charts: document.getElementById("banzukeCharts"),
      filterBar: document.getElementById("banzukeFilterBar"),
      body: document.getElementById("banzukeBody")
    };
  }

  // "Between tournaments, banzuke not out yet": no basho live and the next
  // banzuke's Japan release date is still ahead. Returns the basho that just
  // finished (whose records the projections use) or null outside that window.
  function projectionBasho(now) {
    if (Schedule.getLive(now)) return null;
    const next = Schedule.getNextBanzuke(now);
    if (!next || next.state !== "pending") return null;
    return Schedule.getPrevious(now) || null;
  }

  // ---- records & rough movement markers --------------------------------
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }

  // wins/losses/absences for one banzuke entry, or null when the data isn't
  // there (then no marker is drawn rather than a wrong one).
  function tally(r) {
    let w = num(r.wins), l = num(r.losses), a = num(r.absences);
    if (w == null && Array.isArray(r.record) && r.record.length) {
      w = 0; l = 0; a = 0;
      r.record.forEach((b) => {
        const res = String((b && (b.result || b.outcome)) || "").toLowerCase();
        if (res === "w" || (res.includes("win") && !res.includes("loss"))) w++;
        else if (res === "l" || res.includes("loss")) l++;
        else if (res.includes("absent") || res.includes("fusen") || res.includes("kyujo")) a++;
      });
    }
    if (w == null) return null;
    l = l || 0; a = a || 0;
    // Sekitori fight 15 bouts; far fewer means partial/odd data → no verdict.
    if (w + l + a < 10) return null;
    return { w, l, a };
  }

  // Deliberately crude "obvious" cases only; 7-8 / 8-7 and everything between
  // is left unmarked because the outcome depends on how many slots open up.
  function movement(r) {
    const rank = String(r.rank || "").toLowerCase();
    if (rank.includes("yokozuna") || rank.includes("ozeki")) return null; // demotion/promotion rules differ
    const t = tally(r);
    if (!t) return null;
    if (t.w >= 11) return { dir: "up", n: 2, t };
    if (t.w >= 9) return { dir: "up", n: 1, t };
    if (t.w <= 4) return { dir: "down", n: 2, t };
    if (t.w <= 6) return { dir: "down", n: 1, t };
    return { dir: "none", n: 0, t };
  }

  function rankNumber(r) {
    const m = /(\d+)/.exec(String(r.rank || ""));
    return m ? parseInt(m[1], 10) : null;
  }

  // Juryo men whose records make a promotion plausible. Rough rule of thumb:
  // top-4 with a winning record, top-8 with 10+, anyone with 12+.
  function juryoCandidates(juryoData) {
    const all = [...((juryoData && juryoData.east) || []), ...((juryoData && juryoData.west) || [])];
    return all.map((r) => ({ r, n: rankNumber(r), t: tally(r) }))
      .filter((x) => x.t && x.n != null &&
        ((x.n <= 4 && x.t.w >= 8) || (x.n <= 8 && x.t.w >= 10) || x.t.w >= 12))
      .sort((a, b) => (a.n - b.n) || (b.t.w - a.t.w))
      .slice(0, 8);
  }

  function markerHTML(mv) {
    if (!mv || mv.dir === "none") return "";
    const up = mv.dir === "up";
    const arrows = (up ? "▲" : "▼").repeat(mv.n);
    const title = SumoUtil.escapeHTML(I18n.t(up ? "projUpTitle" : "projDownTitle"));
    return `<span class="banzuke-move ${up ? "is-up" : "is-down"}" title="${title}" aria-label="${title}">${arrows}</span>`;
  }

  function rowHTML(rikishi, project) {
    const name = SumoUtil.escapeHTML(rikishi.shikonaEn || rikishi.shikonaJp || "?");
    const rank = SumoUtil.escapeHTML(rikishi.rank || "");
    const id = rikishi.rikishiID;
    const nameHTML = id != null
      ? `<button type="button" class="banzuke-name rikishi-link" data-rikishi-id="${id}">${name}</button>`
      : `<span class="banzuke-name">${name}</span>`;
    let extra = "";
    if (project) {
      const mv = movement(rikishi);
      if (mv) extra = `<span class="banzuke-rec">${mv.t.w}-${mv.t.l}${mv.t.a ? `-${mv.t.a}` : ""}</span>${markerHTML(mv)}`;
    }
    return `<div class="banzuke-row"><span class="banzuke-rank">${rank}</span><span class="banzuke-who">${extra}${nameHTML}</span></div>`;
  }

  function candidatesHTML(list) {
    if (!list.length) return "";
    const items = list.map(({ r, t }) => {
      const name = SumoUtil.escapeHTML(r.shikonaEn || r.shikonaJp || "?");
      const rank = SumoUtil.escapeHTML(r.rank || "");
      const nameHTML = r.rikishiID != null
        ? `<button type="button" class="banzuke-name rikishi-link" data-rikishi-id="${r.rikishiID}">${name}</button>` : `<span class="banzuke-name">${name}</span>`;
      return `<li><span class="banzuke-rank">${rank}</span> ${nameHTML} <span class="banzuke-rec">${t.w}-${t.l}${t.a ? `-${t.a}` : ""}</span></li>`;
    }).join("");
    return `<div class="proj-candidates"><div class="proj-candidates-title">${I18n.t("projJuryo")}</div><ul>${items}</ul></div>`;
  }

  // ---- Fred Pinkerton chart card ---------------------------------------
  async function loadCharts() {
    if (chartsConfig) return chartsConfig;
    try { chartsConfig = await SumoUtil.fetchJSON("data/charts.json"); }
    catch (e) { chartsConfig = { charts: [] }; }
    return chartsConfig;
  }

  async function renderCharts() {
    const { charts: box } = els();
    if (!box) return;
    const cfg = await loadCharts();
    const list = (cfg && cfg.charts) || [];
    if (!list.length) { box.innerHTML = ""; return; }
    const now = new Date();
    const between = !!projectionBasho(now);
    const author = (cfg.author && cfg.author.name) || "Fred Pinkerton";
    const siteUrl = (cfg.author && cfg.author.url) || "https://fredpink.com/";
    const next = Schedule.getNextBanzuke(now);
    let nextLine = "";
    if (next && next.state === "pending") {
      const when = I18n.t("banzukeIn", { n: next.daysUntil });
      nextLine = `<div class="charts-next">${I18n.t("chartsNextBanzuke", { basho: SumoUtil.escapeHTML(`${next.basho.name} ${next.basho.year}`), when: SumoUtil.escapeHTML(when) })}</div>`;
    }
    const buttons = list.map((c) => `
      ${c.jpg ? `<a class="ghost-button charts-link" href="${SumoUtil.escapeHTML(c.jpg)}" target="_blank" rel="noopener noreferrer">${I18n.t("chartsOpenJpg")} ↗</a>` : ""}
      ${c.pdf ? `<a class="ghost-button charts-link" href="${SumoUtil.escapeHTML(c.pdf)}" target="_blank" rel="noopener noreferrer">${I18n.t("chartsOpenPdf")} ↗</a>` : ""}`).join("");
    box.innerHTML = `
      <div class="charts-title">${I18n.t("chartsTitle")}</div>
      ${nextLine}
      <p class="charts-intro">${I18n.t(between ? "chartsIntroBetween" : "chartsIntroOut")}</p>
      <div class="charts-actions">${buttons}</div>
      <div class="charts-credit">${SumoUtil.escapeHTML(author)} · <a href="${SumoUtil.escapeHTML(siteUrl)}" target="_blank" rel="noopener noreferrer">${I18n.t("chartsSite")} ↗</a> — ${I18n.t("chartsCredit")}</div>`;
  }

  function renderFilterBar() {
    const { filterBar } = els();
    if (!filterBar) return;
    filterBar.innerHTML = `
      <select id="banzukeFilterBasho" class="mini filter-select">
        ${selectableBasho.map((b) => `<option value="${b.id}" ${b.id === state.bashoId ? "selected" : ""}>${SumoUtil.escapeHTML(b.name)} — ${SumoUtil.formatRange(b.startDate, b.endDate, I18n.locale())}</option>`).join("")}
      </select>
      <select id="banzukeFilterDivision" class="mini filter-select">
        ${DIVISIONS.map((d) => `<option value="${d}" ${d === state.division ? "selected" : ""}>${d}</option>`).join("")}
      </select>`;
    document.getElementById("banzukeFilterBasho").addEventListener("change", (e) => {
      state.bashoId = e.target.value;
      renderBody();
    });
    document.getElementById("banzukeFilterDivision").addEventListener("change", (e) => {
      state.division = e.target.value;
      SumoUtil.storage.set(DIVISION_KEY, state.division);
      renderBody();
    });
  }

  async function renderBody() {
    const { body } = els();
    if (!body) return;
    const token = ++renderToken;
    const basho = selectableBasho.find((b) => b.id === state.bashoId);
    if (!basho) { body.innerHTML = ""; return; }

    const now = new Date();
    const isUpcoming = new Date(basho.startDate + "T00:00:00Z") > now;
    const banzukeDate = basho.banzukeDate ? new Date(basho.banzukeDate + "T00:00:00Z") : null;
    const released = !isUpcoming || !banzukeDate || now >= banzukeDate;

    if (!released) {
      const daysUntil = SumoUtil.daysBetween(basho.banzukeDate, now);
      const dateStr = SumoUtil.formatRange(basho.banzukeDate, basho.banzukeDate, I18n.locale()).split("–").pop().trim();
      body.innerHTML = `
        <div class="row"><span class="k">${I18n.t("banzukeStatus")}</span><span class="v">${I18n.t("banzukeIn", { n: daysUntil })}</span></div>
        <div class="row"><span class="k">${SumoUtil.escapeHTML(basho.name)}</span><span class="v">${dateStr}</span></div>
        <a class="panel-external-link" href="${BANZUKE_URL}" target="_blank" rel="noopener noreferrer">${I18n.t("viewBanzuke")} ↗</a>`;
      return;
    }

    body.innerHTML = `<p class="filter-empty">${I18n.t("banzukeLoading")}</p>`;
    // Markers only for the basho that just ended, only while the next banzuke
    // is still pending, and only in the two sekitori divisions (15 bouts).
    const projBasho = projectionBasho(now);
    const project = !!projBasho && projBasho.id === basho.id && (state.division === "Makuuchi" || state.division === "Juryo");
    try {
      const data = await SumoAPI.getBanzuke(basho.id, state.division);
      let candidates = [];
      if (project) {
        try {
          const jd = state.division === "Juryo" ? data : await SumoAPI.getBanzuke(basho.id, "Juryo");
          candidates = juryoCandidates(jd);
        } catch (e) { /* candidates are a bonus — never block the banzuke */ }
      }
      if (token !== renderToken) return;
      const east = (data && data.east) || [];
      const west = (data && data.west) || [];
      if (!east.length && !west.length) {
        body.innerHTML = `<p class="filter-empty">${I18n.t("banzukeUnavailable")}</p>`;
        return;
      }
      body.innerHTML = `
        <div class="banzuke-columns">
          <div class="banzuke-column">
            <div class="banzuke-column-head" data-i18n="banzukeEast">East</div>
            ${east.map((r) => rowHTML(r, project)).join("")}
          </div>
          <div class="banzuke-column">
            <div class="banzuke-column-head" data-i18n="banzukeWest">West</div>
            ${west.map((r) => rowHTML(r, project)).join("")}
          </div>
        </div>
        ${project ? `<p class="proj-legend">${I18n.t("projLegend")}</p>${candidatesHTML(candidates)}` : ""}
        <a class="panel-external-link" href="${BANZUKE_URL}" target="_blank" rel="noopener noreferrer">${I18n.t("viewBanzuke")} ↗</a>`;
      if (global.I18n) I18n.applyStaticText();
    } catch (e) {
      if (token !== renderToken) return;
      body.innerHTML = `<p class="filter-empty">${I18n.t("banzukeUnavailable")}</p>`;
    }
  }

  // Jump to a given basho (used by the quick strip's "View banzuke" button).
  function selectBasho(id, opts) {
    if (!selectableBasho.some((b) => b.id === id)) return;
    state.bashoId = id;
    renderFilterBar();
    renderBody();
    if (opts && opts.scroll) {
      const panel = document.getElementById("banzukePanel");
      if (panel) {
        const calm = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
        panel.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
      }
    }
  }

  function render() { renderCharts(); renderBody(); }

  async function init() {
    await Schedule.load();
    selectableBasho = Schedule.getSelectableBasho(new Date());
    const now = new Date();
    // Live → the live basho. Between tournaments with the next banzuke still
    // pending → the basho that just ended (that's what the projections and
    // Fred's chart describe; the pending banzuke is one dropdown choice away
    // and its countdown sits in the quick strip). Otherwise → the upcoming one.
    const justEnded = projectionBasho(now);
    const defaultBasho = Schedule.getLive(now)
      || (justEnded && selectableBasho.find((b) => b.id === justEnded.id))
      || Schedule.getNextUpcoming(now) || selectableBasho[0];
    state.bashoId = defaultBasho ? defaultBasho.id : null;
    renderFilterBar();
    renderCharts();
    renderBody();
  }

  global.Banzuke = { init, render, selectBasho, DIVISIONS };
})(window);
