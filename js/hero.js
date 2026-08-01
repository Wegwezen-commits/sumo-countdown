// hero.js — makes the rikishi + sign ("hero-rig") an interactive character
// instead of a static image. Hover or keyboard-focus on desktop, tap on
// touch devices, and — since touch devices have no hover to discover the
// interaction — occasional unprompted "steps forward" so mobile visitors
// see it happen at least once without needing to be told.
// Also schedules the idle-sheet animation (see .hero-sprite in main.css)
// to play for a few seconds at random intervals, roughly once a minute,
// so the hero mostly stands still on frame 0 of hero-idle-sheet.png and
// only occasionally shifts/breathes rather than looping the animation
// forever. Separately, schedules a much more frequent, much shorter blink
// (frame 1 of the same sheet, held briefly) so the hero doesn't look
// frozen between those.
// All of the "unprompted" behaviour (sporadic approach, grunt, idle-sheet,
// blink) pauses when the tab is hidden OR the hero is scrolled out of
// view, and resumes when either comes back — see pauseAmbient/resumeAmbient.
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

  // Idle-sheet playback: the hero stands still on frame 0 of
  // hero-idle-sheet.png (see main.css) and only plays the full 8-frame
  // animation for a few seconds every so often — "roughly once a
  // minute", randomized so it doesn't feel like a metronome. Average of
  // MIN/MAX below is ~26.5s; widen/narrow this range to make it fire more
  // or less often.
  const IDLE_TRIGGER_MIN_MS = 18000;
  const IDLE_TRIGGER_MAX_MS = 35000;
  // Weighting around real interaction (hover/tap/focus — see markInteraction):
  // right after one, wait at least this long before the idle-sheet can play,
  // so it doesn't compete with something the visitor just did on purpose;
  // after a long stretch of nobody touching the hero, shrink the random
  // window instead of widening it, so it fires a bit more often — a little
  // more personality during long stretches of nobody paying attention.
  const IDLE_COOLDOWN_AFTER_INTERACTION_MS = 20000;
  const IDLE_STILLNESS_BONUS_AFTER_MS = 150000;
  const IDLE_STILLNESS_RANGE_FACTOR = 0.6;

  // Blink: a quick flash of frame 1 of hero-idle-sheet.png (the closed-eyes
  // frame, authored directly into the sheet — see .hero-sprite.blinking in
  // main.css), independent of and much more frequent than the full 8-frame
  // idle-sheet playback above. Both now live on the SAME sprite-sheet layer
  // (there is no separate blink sheet/image anymore), so they're guarded
  // (see idleAnimAllowed/blinkAllowed below) to be strictly mutually
  // exclusive — only one of them may be driving that layer's transform at
  // a time, or they'd fight over the same element.
  const BLINK_MIN_MS = 2500;
  const BLINK_MAX_MS = 6000;
  const BLINK_HOLD_MS = 130;          // how long the eyes stay "closed"
  const BLINK_OPEN_LEAD_MS = 40;      // brief "open" (blink-sheet frame 1) before closing
  const BLINK_OPEN_TAIL_MS = 40;      // brief "open" again before settling back to frame 0
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
    let lastInteractionAt = Date.now();
    let tabVisible = document.visibilityState === "visible";
    let inViewport = true; // updated by IntersectionObserver below, if supported
    let ambientStarted = false;
    let dismissedHint = SumoUtil.storage.get("heroHintSeen", false);
    if (dismissedHint && hint) hint.classList.add("hidden");

    function ambientActive() { return tabVisible && inViewport; }

    function markInteraction() {
      lastInteractionAt = Date.now();
      // A real interaction just happened — push the next idle-sheet play
      // out past the cooldown rather than letting an already-pending timer
      // fire right on top of it.
      if (idleAnimTimer) { clearTimeout(idleAnimTimer); scheduleIdleAnim(); }
    }

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
      markInteraction();
      stepForward({ autoRetract: false });
    });
    rig.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      stepBack();
    });
    rig.addEventListener("focus", () => { dismissHint(); markInteraction(); stepForward({ autoRetract: false }); });
    rig.addEventListener("blur", stepBack);

    // ---------- Touch: tap toggles a timed approach ----------
    rig.addEventListener("click", (e) => {
      // Mouse "click" already got its state from hover; only treat this as
      // a discrete tap trigger on devices that can't hover.
      if (canHover()) return;
      dismissHint();
      markInteraction();
      if (rig.classList.contains("approach")) stepBack();
      else stepForward({ autoRetract: true });
    });

    // Enter/Space on the focused rig (role="button") triggers the same tap behaviour.
    rig.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      dismissHint();
      markInteraction();
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

    // ---------- Idle-sheet playback: play the 8-frame animation once
    // through at random intervals, otherwise stay on frame 0
    // (see .hero-sprite / .hero-sprite.playing-idle in main.css). ----------
    function idleAnimAllowed() {
      return sprite && !reduceMotion() && !sprite.classList.contains("celebrate")
        && !rig.classList.contains("approach") && !sprite.classList.contains("blinking");
    }

    function playIdleAnim() {
      if (!idleAnimAllowed() || sprite.classList.contains("playing-idle")) return;
      sprite.classList.add("playing-idle");
      if (global.SumoAudio && typeof SumoAudio.playIdleShift === "function") {
        SumoAudio.playIdleShift();
      }
    }

    if (sprite) {
      // The animation runs a fixed iteration-count (see main.css), so it
      // ends on its own; drop the class then so the element falls back to
      // frame 0 underneath rather than freezing on the last frame.
      sprite.addEventListener("animationend", (e) => {
        if (e.animationName === "heroIdle") sprite.classList.remove("playing-idle");
      });
    }

    function scheduleIdleAnim() {
      if (!sprite) return;
      const stillFor = Date.now() - lastInteractionAt;
      let min = IDLE_TRIGGER_MIN_MS;
      let max = IDLE_TRIGGER_MAX_MS;
      if (stillFor < IDLE_COOLDOWN_AFTER_INTERACTION_MS) {
        // Just interacted with directly — give it room before the ambient
        // animation competes with whatever the visitor just did on purpose.
        min = IDLE_TRIGGER_MIN_MS + (IDLE_TRIGGER_MAX_MS - IDLE_TRIGGER_MIN_MS) * 0.5;
      } else if (stillFor > IDLE_STILLNESS_BONUS_AFTER_MS) {
        // Nobody's touched it in a while — let a bit more personality show
        // by shrinking the window instead of widening it.
        max = IDLE_TRIGGER_MIN_MS + (IDLE_TRIGGER_MAX_MS - IDLE_TRIGGER_MIN_MS) * IDLE_STILLNESS_RANGE_FACTOR;
      }
      const delay = min + Math.random() * (max - min);
      idleAnimTimer = setTimeout(() => {
        if (ambientActive()) playIdleAnim();
        scheduleIdleAnim();
      }, delay);
    }

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

    // Runs one full open -> closed -> open pass through hero-idle-sheet.png's
    // frames 0/1 (see that file / .hero-sprite::before in main.css), then
    // settles back on frame 0. ".blinking" no longer has any visual effect
    // by itself now that the sheet is always visible — it's kept purely as
    // a JS-state guard (see blinkAllowed/idleAnimAllowed) so nothing else
    // touches this element's transform mid-blink. ".eyes-closed" is what
    // actually shifts the layer to frame 1; both classes always toggle
    // together in this order.
    function oneBlinkPass(onDone) {
      sprite.classList.add("blinking");
      setTimeout(() => {
        sprite.classList.add("eyes-closed");
        setTimeout(() => {
          sprite.classList.remove("eyes-closed");
          setTimeout(() => {
            sprite.classList.remove("blinking");
            if (onDone) onDone();
          }, BLINK_OPEN_TAIL_MS);
        }, BLINK_HOLD_MS);
      }, BLINK_OPEN_LEAD_MS);
    }

    function playBlink() {
      if (!blinkAllowed() || sprite.classList.contains("blinking")) return;
      oneBlinkPass(() => {
        if (Math.random() < BLINK_DOUBLE_CHANCE && blinkAllowed()) {
          setTimeout(() => { if (blinkAllowed()) oneBlinkPass(); }, BLINK_DOUBLE_GAP_MS);
        }
      });
    }

    function scheduleBlink() {
      if (!sprite) return;
      const delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
      blinkTimer = setTimeout(() => {
        if (document.visibilityState === "visible") playBlink();
        scheduleBlink();
      }, delay);
    }

    // ---------- Ambient lifecycle: all four "unprompted" behaviours above
    // (sporadic approach, grunt, idle-sheet, blink) start/stop together via
    // ambientActive() = tab visible AND hero scrolled into view. started
    // guards against double-scheduling if both the IntersectionObserver's
    // initial callback and the unconditional call at the bottom both land
    // while already active. ----------
    function pauseAmbient() {
      ambientStarted = false;
      clearTimeout(sporadicTimer);
      clearTimeout(gruntTimer);
      clearTimeout(idleAnimTimer);
      clearTimeout(blinkTimer);
    }

    function resumeAmbient() {
      if (!ambientActive() || ambientStarted) return;
      ambientStarted = true;
      scheduleSporadic();
      scheduleGrunt();
      scheduleIdleAnim();
      scheduleBlink();
    }

    document.addEventListener("visibilitychange", () => {
      tabVisible = document.visibilityState === "visible";
      if (!tabVisible) pauseAmbient(); else resumeAmbient();
    });

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        inViewport = entries[entries.length - 1].isIntersecting;
        if (!inViewport) pauseAmbient(); else resumeAmbient();
      }, { threshold: 0.15 });
      io.observe(rig);
    } else {
      resumeAmbient(); // no IntersectionObserver support — just start on load
    }
  }

  document.addEventListener("DOMContentLoaded", init);
  global.HeroRig = { init };
})(window);
