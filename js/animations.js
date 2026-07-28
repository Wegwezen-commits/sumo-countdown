// animations.js — seasonal theme detection + lightweight CSS-driven particles.
// Deliberately avoids canvas: plain absolutely-positioned divs animated with
// CSS keyframes, capped at a low particle count so it never hurts performance.
(function (global) {
  "use strict";

  function seasonForDate(d) {
    const m = d.getUTCMonth() + 1; // 1-12
    if (m === 3 || m === 4 || m === 5) return "spring";
    if (m === 6 || m === 7 || m === 8) return "summer";
    if (m === 9 || m === 10 || m === 11) return "autumn";
    return "winter";
  }

  function applySeason() {
    const season = seasonForDate(new Date());
    document.getElementById("app").setAttribute("data-season", season);
    return season;
  }

  const MAX_PETALS = 18;
  let petalTimer = null;

  function spawnPetal(layer) {
    if (layer.children.length >= MAX_PETALS) return;
    const petal = document.createElement("span");
    const size = 6 + Math.random() * 8;
    petal.className = "petal";
    petal.style.left = `${Math.random() * 100}%`;
    petal.style.width = `${size}px`;
    petal.style.height = `${size * 0.8}px`;
    petal.style.setProperty("--drift", `${(Math.random() - 0.5) * 160}px`);
    const duration = 9 + Math.random() * 8;
    petal.style.animation = `petalFall ${duration}s linear forwards`;
    layer.appendChild(petal);
    setTimeout(() => petal.remove(), duration * 1000 + 200);
  }

  function startSakura() {
    const layer = document.getElementById("sakuraLayer");
    if (!layer || petalTimer) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    petalTimer = setInterval(() => {
      if (!Settings.prefs.sakura || layer.classList.contains("hidden")) return;
      spawnPetal(layer);
    }, 900);
  }

  function stopSakura() {
    if (petalTimer) { clearInterval(petalTimer); petalTimer = null; }
    const layer = document.getElementById("sakuraLayer");
    if (layer) layer.innerHTML = "";
  }

  // "Konishiki mode" easter egg: tiny falling-salt animation shown briefly
  // in the day or two before a live tournament begins (a nod to the
  // ring-purification salt toss). Very subtle, auto-disables once live.
  let saltLayer = null;
  function maybeShowSaltEgg(hoursUntilStart) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const within48h = hoursUntilStart !== null && hoursUntilStart >= 0 && hoursUntilStart <= 48;
    if (!within48h) {
      if (saltLayer) { saltLayer.remove(); saltLayer = null; }
      return;
    }
    if (saltLayer) return;
    saltLayer = document.createElement("div");
    saltLayer.className = "salt-layer";
    document.getElementById("app").appendChild(saltLayer);
    let count = 0;
    const spawn = setInterval(() => {
      if (!saltLayer || count > 40) { clearInterval(spawn); return; }
      count++;
      const grain = document.createElement("span");
      grain.className = "salt-grain";
      grain.style.left = `${Math.random() * 100}%`;
      grain.style.setProperty("--drift", `${(Math.random() - 0.5) * 60}px`);
      const duration = 4 + Math.random() * 3;
      grain.style.animation = `saltFall ${duration}s linear forwards`;
      saltLayer.appendChild(grain);
      setTimeout(() => grain.remove(), duration * 1000 + 200);
    }, 400);
  }

  function playLaunchRope() {
    // Yokozuna rope flourish on first load: a thin gold arc under the brand mark.
    const mark = document.querySelector(".brand-mark");
    if (!mark) return;
    const rope = document.createElement("div");
    rope.className = "yokozuna-rope";
    rope.style.cssText = "height:3px;width:38px;background:linear-gradient(90deg,var(--gold),transparent);margin-top:2px;border-radius:2px;";
    mark.parentElement.appendChild(rope);
    setTimeout(() => rope.remove(), 1600);
  }

  global.Animations = { applySeason, startSakura, stopSakura, maybeShowSaltEgg, playLaunchRope };
})(window);
