// hero.js — makes the rikishi + sign ("hero-rig") an interactive character
// instead of a static image. Hover or keyboard-focus on desktop, tap on
// touch devices, and — since touch devices have no hover to discover the
// interaction — occasional unprompted "steps forward" so mobile visitors
// see it happen at least once without needing to be told.
(function (global) {
  "use strict";

  const APPROACH_HOLD_MS = 3200;   // how long a tap/sporadic approach stays out
  const WALK_CLASS_MS = 720;       // matches the CSS transition length (footstep bob)
  const SPORADIC_MIN_MS = 22000;
  const SPORADIC_MAX_MS = 48000;
  const GRUNT_MIN_MS = 25000;   // "just fought a match" — an occasional
  const GRUNT_MAX_MS = 55000;   // low humpf, independent of hover/tap

  function reduceMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function canHover() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function init() {
    const rig = document.getElementById("heroRig");
    const hint = document.getElementById("heroHint");
    if (!rig) return;

    let holdTimer = null;
    let walkTimer = null;
    let sporadicTimer = null;
    let gruntTimer = null;
    let dismissedHint = SumoUtil.storage.get("heroHintSeen", false);
    if (dismissedHint && hint) hint.classList.add("hidden");

    function dismissHint() {
      if (dismissedHint || !hint) return;
      dismissedHint = true;
      hint.classList.add("hidden");
      SumoUtil.storage.set("heroHintSeen", true);
    }

    function stepForward({ sound = true, autoRetract = false } = {}) {
      rig.classList.add("approach", "walking");
      if (sound && global.SumoAudio && typeof SumoAudio.playApproach === "function") {
        SumoAudio.playApproach();
      }
      clearTimeout(walkTimer);
      walkTimer = setTimeout(() => rig.classList.remove("walking"), WALK_CLASS_MS);
      if (autoRetract) {
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => rig.classList.remove("approach"), APPROACH_HOLD_MS);
      }
    }

    function stepBack() {
      clearTimeout(holdTimer);
      rig.classList.remove("approach");
    }

    // ---------- Desktop: hover + keyboard focus ----------
    rig.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return; // touch/pen handled via tap below
      dismissHint();
      stepForward({ autoRetract: false });
    });
    rig.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      stepBack();
    });
    rig.addEventListener("focus", () => { dismissHint(); stepForward({ autoRetract: false }); });
    rig.addEventListener("blur", stepBack);

    // ---------- Touch: tap toggles a timed approach ----------
    rig.addEventListener("click", (e) => {
      // Mouse "click" already got its state from hover; only treat this as
      // a discrete tap trigger on devices that can't hover.
      if (canHover()) return;
      dismissHint();
      if (rig.classList.contains("approach")) stepBack();
      else stepForward({ autoRetract: true });
    });

    // Enter/Space on the focused rig (role="button") triggers the same tap behaviour.
    rig.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      dismissHint();
      stepForward({ autoRetract: true });
    });

    // ---------- Sporadic, unprompted approach on touch devices ----------
    function scheduleSporadic() {
      if (canHover() || reduceMotion()) return; // desktop users discover it via hover
      const delay = SPORADIC_MIN_MS + Math.random() * (SPORADIC_MAX_MS - SPORADIC_MIN_MS);
      sporadicTimer = setTimeout(() => {
        if (document.visibilityState === "visible" && !rig.classList.contains("approach")) {
          stepForward({ sound: true, autoRetract: true });
        }
        scheduleSporadic();
      }, delay);
    }
    scheduleSporadic();

    // ---------- Periodic grunt: a low "humpf", like a wrestler still
    // catching his breath after a bout. Independent of hover/tap/sway —
    // fires on desktop and touch alike, just an ambient flavor sound
    // that repeats every so often while the tab is visible. ----------
    function scheduleGrunt() {
      const delay = GRUNT_MIN_MS + Math.random() * (GRUNT_MAX_MS - GRUNT_MIN_MS);
      gruntTimer = setTimeout(() => {
        if (document.visibilityState === "visible" && global.SumoAudio && typeof SumoAudio.playGrunt === "function") {
          SumoAudio.playGrunt();
        }
        scheduleGrunt();
      }, delay);
    }
    scheduleGrunt();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(sporadicTimer);
        clearTimeout(gruntTimer);
      } else if (document.visibilityState === "visible") {
        scheduleGrunt();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  global.HeroRig = { init };
})(window);
