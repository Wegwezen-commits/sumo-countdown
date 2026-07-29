// hero.js — makes the rikishi + sign ("hero-rig") an interactive character
// instead of a static image. Hover or keyboard-focus on desktop, tap on
// touch devices, and — since touch devices have no hover to discover the
// interaction — occasional unprompted "steps forward" so mobile visitors
// see it happen at least once without needing to be told.
// Also schedules the idle-sheet animation (see .hero-sprite in main.css)
// to play for a few seconds at random intervals, roughly once a minute,
// so the hero mostly stands still on hero-static.png and only occasionally
// shifts/breathes rather than looping the animation forever. Separately,
// schedules a much more frequent, much shorter blink (frame 2 of the idle
// sheet, held briefly) so the hero doesn't look frozen between those.
(function (global) {
  "use strict";

  const APPROACH_HOLD_MS = 3200;   // how long a tap/sporadic approach stays out
  const SPORADIC_MIN_MS = 22000;
  const SPORADIC_MAX_MS = 48000;
  const GRUNT_MIN_MS = 25000;   // "just fought a match" — an occasional
  const GRUNT_MAX_MS = 55000;   // low humpf, independent of hover/tap
  // "Walk near the venue": with no dedicated walk-cycle artwork this
  // round, movement (rather than a breathing/frowning idle loop) is
  // what stands in for idle personality — an occasional stroll toward
  // one side of the stage and back, using the same still art.

  // Idle-sheet playback: the hero stands still on hero-static.png (see
  // main.css) and only plays the 8-frame idle-sheet animation for a few
  // seconds every so often — "roughly once a minute", randomized so it
  // doesn't feel like a metronome. Average of MIN/MAX below is ~65s;
  // widen/narrow this range to make it fire more or less often.
  const IDLE_TRIGGER_MIN_MS = 45000;
  const IDLE_TRIGGER_MAX_MS = 85000;

  // Blink: a quick flash of frame 2 of the idle sheet (see .hero-sprite.blinking
  // in main.css), independent of and much more frequent than the full idle-sheet
  // playback above. Kept short enough to read as a blink rather than a held
  // expression, and guarded (see idleAnimAllowed/blinkAllowed below) so it never
  // fires at the same time as the full idle-sheet animation — both animate the
  // same sprite sheet layer, so they'd visually clash if they overlapped.
  const BLINK_MIN_MS = 2500;
  const BLINK_MAX_MS = 6000;
  const BLINK_HOLD_MS = 130;          // how long the eyes stay "closed"
  const BLINK_DOUBLE_CHANCE = 0.12;   // occasional natural double-blink
  const BLINK_DOUBLE_GAP_MS = 120;

  function reduceMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function canHover() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function init() {
    const rig = document.getElementById("heroRig");
    const hint = document.getElementById("heroHint");
    const sprite = document.getElementById("heroSprite");
    if (!rig) return;

    let holdTimer = null;
    let sporadicTimer = null;
    let gruntTimer = null;
    let idleAnimTimer = null;
    let blinkTimer = null;
    let dismissedHint = SumoUtil.storage.get("heroHintSeen", false);
    if (dismissedHint && hint) hint.classList.add("hidden");

    function dismissHint() {
      if (dismissedHint || !hint) return;
      dismissedHint = true;
      hint.classList.add("hidden");
      SumoUtil.storage.set("heroHintSeen", true);
    }

    function stepForward({ sound = true, autoRetract = false } = {}) {
      rig.classList.add("approach");
      if (sound && global.SumoAudio && typeof SumoAudio.playApproach === "function") {
        SumoAudio.playApproach();
      }
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

    // ---------- Idle-sheet playback: play the 8-frame animation for a
    // few cycles at random intervals, otherwise stay on hero-static.png
    // (see .hero-sprite / .hero-sprite.playing-idle in main.css). ----------
    function idleAnimAllowed() {
      return sprite && !reduceMotion() && !sprite.classList.contains("celebrate")
        && !rig.classList.contains("approach") && !sprite.classList.contains("blinking");
    }

    function playIdleAnim() {
      if (!idleAnimAllowed() || sprite.classList.contains("playing-idle")) return;
      sprite.classList.add("playing-idle");
    }

    if (sprite) {
      // The animation runs a fixed iteration-count (see main.css), so it
      // ends on its own; drop the class then so the element falls back to
      // hero-static.png underneath rather than freezing on the last frame.
      sprite.addEventListener("animationend", (e) => {
        if (e.animationName === "heroIdle") sprite.classList.remove("playing-idle");
      });
    }

    function scheduleIdleAnim() {
      if (!sprite) return;
      const delay = IDLE_TRIGGER_MIN_MS + Math.random() * (IDLE_TRIGGER_MAX_MS - IDLE_TRIGGER_MIN_MS);
      idleAnimTimer = setTimeout(() => {
        if (document.visibilityState === "visible") playIdleAnim();
        scheduleIdleAnim();
      }, delay);
    }
    scheduleIdleAnim();

    // ---------- Blink: much more frequent, much shorter than the idle-sheet
    // playback above — see BLINK_* constants and .hero-sprite.blinking in
    // main.css. Deliberately independent of the full idle animation's own
    // schedule (real blinking isn't synced to anything else the body does),
    // but mutually exclusive with it so they don't fight over the same
    // sprite-sheet layer. ----------
    function blinkAllowed() {
      return sprite && !reduceMotion() && !sprite.classList.contains("celebrate")
        && !sprite.classList.contains("playing-idle");
    }

    function playBlink() {
      if (!blinkAllowed() || sprite.classList.contains("blinking")) return;
      sprite.classList.add("blinking");
      setTimeout(() => {
        sprite.classList.remove("blinking");
        if (Math.random() < BLINK_DOUBLE_CHANCE) {
          setTimeout(() => {
            if (!blinkAllowed() || sprite.classList.contains("blinking")) return;
            sprite.classList.add("blinking");
            setTimeout(() => sprite.classList.remove("blinking"), BLINK_HOLD_MS);
          }, BLINK_DOUBLE_GAP_MS);
        }
      }, BLINK_HOLD_MS);
    }

    function scheduleBlink() {
      if (!sprite) return;
      const delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
      blinkTimer = setTimeout(() => {
        if (document.visibilityState === "visible") playBlink();
        scheduleBlink();
      }, delay);
    }
    scheduleBlink();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(sporadicTimer);
        clearTimeout(gruntTimer);
        clearTimeout(idleAnimTimer);
        clearTimeout(blinkTimer);
      } else if (document.visibilityState === "visible") {
        scheduleGrunt();
        scheduleIdleAnim();
        scheduleBlink();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  global.HeroRig = { init };
})(window);
