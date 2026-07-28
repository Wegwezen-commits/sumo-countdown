// audio.js — all sound for the app. Two independent layers:
//   1. SFX: short one-shot effects (celebration, clicks), still
//      synthesized live with the Web Audio API — existing
//      "playedForId once" behaviour is preserved.
//   2. Music: five composed, pre-rendered states (idle, countdown,
//      live, finalDay, victory) shipped as small OGG files and played
//      back with crossfading (see the "composed background music"
//      section below) — replacing the previous live-generated
//      sequencer with an actually-composed soundtrack.
// Both layers are muted until the first user interaction (autoplay
// rules) and both respect independent Settings toggles + a shared
// master-volume preference.
(function (global) {
  "use strict";

  let ctx = null;
  let unlocked = false;
  let playedForId = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      masterGain = ctx.createGain();
      musicGain = ctx.createGain();
      sfxGain = ctx.createGain();
      musicGain.connect(masterGain);
      sfxGain.connect(masterGain);
      masterGain.connect(ctx.destination);
      applyVolume();
    }
    return ctx;
  }

  function applyVolume() {
    if (!masterGain) return;
    const v = Settings.prefs && typeof Settings.prefs.volume === "number" ? Settings.prefs.volume : 60;
    masterGain.gain.setTargetAtTime(SumoUtil.clamp(v, 0, 100) / 100, ctx.currentTime, 0.05);
  }

  function unlock() {
    if (unlocked) return;
    const c = ensureContext();
    if (c && c.state === "suspended") c.resume();
    unlocked = true;
  }

  // ---------- low-level synth helpers ----------
  function noiseBurst(c, dest, start, duration, gainPeak, filterType, filterFreq) {
    const bufferSize = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(gainPeak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    let node = src;
    if (filterType) {
      const f = c.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = filterFreq || 900;
      node.connect(f);
      node = f;
    }
    node.connect(gain).connect(dest);
    src.start(start);
    src.stop(start + duration);
  }

  function tone(c, dest, start, duration, freq, gainPeak, type, glide) {
    const osc = c.createOscillator();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, start);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, start + duration);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(gainPeak, start + Math.min(0.02, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain).connect(dest);
    osc.start(start);
    osc.stop(start + duration);
    return osc;
  }

  // koto-like pluck: short bright triangle with fast decay + slight detune
  function pluck(c, dest, start, freq, gainPeak, duration) {
    duration = duration || 0.9;
    tone(c, dest, start, duration, freq, gainPeak, "triangle");
    tone(c, dest, start, duration * 0.6, freq * 2.005, gainPeak * 0.25, "sine");
  }

  // shakuhachi-ish breathy sustained tone: filtered noise + sine, slow vibrato
  function breathTone(c, dest, start, duration, freq, gainPeak) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    const lfo = c.createOscillator();
    lfo.frequency.value = 4.5;
    const lfoGain = c.createGain();
    lfoGain.gain.value = freq * 0.006;
    lfo.connect(lfoGain).connect(osc.frequency);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(gainPeak, start + duration * 0.3);
    gain.gain.linearRampToValueAtTime(gainPeak * 0.7, start + duration * 0.7);
    gain.gain.linearRampToValueAtTime(0, start + duration);
    osc.connect(gain).connect(dest);
    osc.start(start); lfo.start(start);
    osc.stop(start + duration); lfo.stop(start + duration);
  }

  // ---------- one-shot SFX ----------
  function playCelebration() {
    if (!Settings.prefs.audio || !unlocked) return;
    const c = ensureContext();
    if (!c) return;
    const t0 = c.currentTime;
    noiseBurst(c, sfxGain, t0, 0.07, 0.9);
    noiseBurst(c, sfxGain, t0 + 0.09, 0.07, 0.7);
    tone(c, sfxGain, t0 + 0.05, 0.4, 90, 0.6, "sine");
    tone(c, sfxGain, t0 + 0.05, 0.35, 60, 0.5, "triangle");
    const swellDur = 1.6;
    const bufferSize = Math.floor(c.sampleRate * swellDur);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.6;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t0 + 0.3);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.9);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3 + swellDur);
    src.connect(filter).connect(gain).connect(sfxGain);
    src.start(t0 + 0.3);
    src.stop(t0 + 0.3 + swellDur);
    startMusic("victory");
    setTimeout(() => { if (currentState === "victory") startMusic("idle"); }, 6000);
  }

  function playClick() {
    if (!Settings.prefs.audio || !unlocked) return;
    const c = ensureContext();
    if (!c) return;
    tone(c, sfxGain, c.currentTime, 0.06, 700, 0.12, "square");
  }

  // Soft double-footstep + a light wood creak, used when the rikishi steps
  // forward toward the viewer (see js/hero.js). Deliberately understated —
  // this fires often (hover/tap), so it shouldn't compete with the music.
  function playApproach() {
    if (!Settings.prefs.audio || !unlocked) return;
    const c = ensureContext();
    if (!c) return;
    const t0 = c.currentTime;
    noiseBurst(c, sfxGain, t0, 0.05, 0.22, "lowpass", 400);
    noiseBurst(c, sfxGain, t0 + 0.13, 0.05, 0.18, "lowpass", 380);
    tone(c, sfxGain, t0 + 0.02, 0.18, 180, 0.08, "triangle", 140);
  }

  function onZero(bashoId) {
    if (playedForId === bashoId) return;
    playedForId = bashoId;
    playCelebration();
  }

  // ---------- composed background music (pre-rendered, not generative) ----------
  // Five actually-composed tracks — idle/countdown/live/finalDay loop,
  // victory is a one-shot fanfare — sharing one recurring motif on the
  // A "yo" scale, composed as MIDI, rendered through FluidSynth with
  // real instrument samples (koto, shakuhachi, taiko, etc.), mastered,
  // and shipped as small OGG files in assets/audio/ (see README.md for
  // the full build notes). This replaces the previous live Web Audio
  // sequencer entirely; only the one-shot SFX above are still
  // synthesized live. Playback uses <audio> elements routed through
  // per-state Web Audio gain nodes so states can crossfade smoothly
  // and everything still shares the existing master-volume/mute prefs.
  const TRACKS = {
    idle: "assets/audio/idle.ogg",
    countdown: "assets/audio/countdown.ogg",
    live: "assets/audio/live.ogg",
    finalDay: "assets/audio/finalDay.ogg",
    victory: "assets/audio/victory.ogg"
  };
  const CROSSFADE_SECONDS = 1.2;

  let currentState = "idle";
  let musicGraphReady = false;
  const stateEls = {};
  const stateGains = {};

  function buildMusicGraph(c) {
    if (musicGraphReady) return;
    Object.keys(TRACKS).forEach((state) => {
      const el = new Audio(TRACKS[state]);
      el.loop = state !== "victory";
      el.preload = "auto";
      const gain = c.createGain();
      gain.gain.value = 0;
      try {
        const src = c.createMediaElementSource(el);
        src.connect(gain).connect(musicGain);
      } catch (e) {
        // Rare: a browser refusing a second MediaElementSource on the
        // same element. The gain node just stays silent in that case;
        // it's not worth a fallback path for a corner case this narrow.
      }
      stateEls[state] = el;
      stateGains[state] = gain;
    });
    musicGraphReady = true;
  }

  function fadeGain(gain, target, seconds) {
    if (!gain || !ctx) return;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + seconds);
  }

  function crossfadeTo(state) {
    Object.keys(stateEls).forEach((s) => {
      const el = stateEls[s];
      const gain = stateGains[s];
      if (s === state) {
        if (el.paused) {
          if (s !== "victory") el.currentTime = 0;
          el.play().catch(() => { /* still autoplay-locked; unlock() will retry */ });
        }
        fadeGain(gain, 1, CROSSFADE_SECONDS);
      } else if (!el.paused) {
        fadeGain(gain, 0, CROSSFADE_SECONDS);
        setTimeout(() => { if (currentState !== s) el.pause(); }, CROSSFADE_SECONDS * 1000 + 80);
      }
    });
    if (state === "victory") {
      stateEls.victory.onended = () => {
        if (currentState === "victory") startMusic("idle");
      };
    }
  }

  function startMusic(state) {
    currentState = state || "idle";
    if (!Settings.prefs.music || !unlocked) return;
    const c = ensureContext();
    if (!c) return;
    buildMusicGraph(c);
    crossfadeTo(currentState);
  }

  function stopMusic() {
    Object.keys(stateEls).forEach((s) => {
      if (stateGains[s] && ctx) stateGains[s].gain.setValueAtTime(0, ctx.currentTime);
      stateEls[s].pause();
    });
  }

  function setMusicEnabled(on) {
    if (on) startMusic(currentState);
    else stopMusic();
  }

  ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
    window.addEventListener(evt, () => {
      unlock();
      if (Settings.prefs.music) startMusic(currentState);
    }, { once: true, passive: true });
  });

  document.addEventListener("prefschange", (e) => {
    if (e.detail.key === "volume") applyVolume();
    if (e.detail.key === "music") setMusicEnabled(e.detail.value);
  });

  global.SumoAudio = { onZero, unlock, playClick, playApproach, startMusic, stopMusic, setMusicEnabled };
})(window);
