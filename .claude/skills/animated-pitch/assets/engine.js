/* Pitch engine: one master clock drives every animation, so the whole piece can be paused,
   scrubbed and seeked to an exact time (?t=12.5) for verification.

   - track(): one Web Animations API animation per element+property, spanning 0..duration.
   - cue(): a Lottie animation whose frame is computed from the clock (no autoplay drift).
   - scenes(): crossfades each scene and staggers its .copy children; feeds the aria-live caption.
   - Injects the start overlay (a click unlocks audio), the playback toolbar and keyboard keys.

   Usage:
     const P = Pitch.create({ duration: 45 });
     P.scenes([{ id: "sMap", start: 9.5, end: 13.5 }, ...]);
     P.track("#cam", [[9.6, { transform: "scale(1)" }], [13.5, { transform: "scale(1.08)" }]], "motion");
     P.cue("pulse", "#lPulse", 10.2, { loop: true });
     P.sound(5.2, P.boom);
     P.start();

   Kinds: "base" always runs; "motion" transforms jump instead of travel under reduced motion;
   "decor" (bobs, shakes, flashes, waves) is skipped under reduced motion. */
(function () {
  "use strict";
  const EASE = {
    enter: "cubic-bezier(.2,.8,.2,1)",
    exit: "cubic-bezier(.4,0,1,1)",
    camera: "cubic-bezier(.65,0,.35,1)",
    linear: "linear",
  };
  const CSS = `
  #pitch-start{position:fixed;inset:0;display:grid;place-items:center;background:rgba(5,10,8,.72);color:#f3f1ea;z-index:10;text-align:center;font-family:system-ui,sans-serif}
  #pitch-start button{font:700 28px system-ui,sans-serif;padding:18px 44px;border-radius:999px;border:0;background:#f3f1ea;color:#1b1f1d;cursor:pointer}
  #pitch-start button:disabled{opacity:.5;cursor:progress}
  #pitch-start p{opacity:.75;font-size:16px;margin-top:18px}
  #pitch-controls{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;padding:8px 12px;border-radius:14px;background:rgba(10,18,15,.78);color:#e8efe9;font:14px ui-monospace,monospace;max-width:calc(100vw - 32px);transition:opacity 300ms cubic-bezier(.4,0,1,1)}
  #pitch-controls.idle{opacity:0}
  #pitch-controls button{font:inherit;color:inherit;background:rgba(255,255,255,.1);border:0;border-radius:8px;padding:6px 10px;cursor:pointer;min-width:36px}
  #pitch-controls :focus-visible,#pitch-start button:focus-visible{outline:3px solid #ff6b3d;outline-offset:2px}
  #pitch-seek{width:min(360px,60vw)}
  .pitch-clean #pitch-controls{display:none}
  .pitch-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`;

  function create({ duration, stage = "#stage", width = 1920, height = 1080, fadeIn = 0.3 } = {}) {
    const T = duration;
    const params = new URLSearchParams(location.search);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => [...document.querySelectorAll(s)];
    const anims = [], cues = [], sounds = [];
    let sceneList = [];

    function track(target, keys, kind = "base") {
      if (kind === "decor" && reduce) return;
      const els = typeof target === "string" ? $$(target) : [target].flat();
      if (!els.length) console.warn("track: no element for", target);
      const props = new Set(keys.flatMap(([, p]) => Object.keys(p)));
      for (const el of els)
        for (const prop of props) {
          const ks = keys.filter(([, p]) => prop in p);
          const stepped = reduce && kind === "motion" && prop === "transform";
          const frames = ks.map(([t, p, ease]) => ({
            offset: Math.min(1, Math.max(0, t / T)),
            [prop]: p[prop],
            easing: stepped ? "steps(1, end)" : ease || EASE.enter,
          }));
          if (frames[0].offset > 0) frames.unshift({ ...frames[0], offset: 0, easing: "linear" });
          if (frames.at(-1).offset < 1) frames.push({ ...frames.at(-1), offset: 1 });
          const a = el.animate(frames, { duration: T * 1000, fill: "both" });
          a.pause();
          anims.push(a);
        }
    }
    const tY = (px) => `translateY(${px}px)`;
    const pos = (x, y) => `translate(${x}px, ${y}px)`;
    function enter(target, t, { dy = 24, dur = fadeIn, kind = "motion" } = {}) {
      track(target, [[t, { opacity: 0, transform: tY(dy) }], [t + dur, { opacity: 1, transform: tY(0) }]], kind);
    }
    // A ring that pops onto one UI detail, holds, then fades. The element is centred on its left/top.
    function callout(target, t, hold = 0.9, d = 0.18) {
      track(target, [
        [t, { opacity: 0, transform: "translate(-50%,-50%) scale(1.35)" }],
        [t + d, { opacity: 1, transform: "translate(-50%,-50%) scale(1)" }, EASE.exit],
        [t + d + hold, { opacity: 1 }, EASE.exit],
        [t + d + hold + d, { opacity: 0 }],
      ], "motion");
    }
    // name: a key of window.LOTTIE (bundle.js). Hidden before its start so frame 0 never leaks.
    function cue(name, el, start, { loop = false, decor = false } = {}) {
      const container = typeof el === "string" ? $(el) : el;
      if (decor && reduce) { container.hidden = true; return; }
      if (!window.LOTTIE?.[name]) { console.error("cue: missing Lottie", name); return; }
      const anim = lottie.loadAnimation({
        container, renderer: "svg", loop: false, autoplay: false,
        animationData: structuredClone(window.LOTTIE[name]),
      });
      cues.push({ anim, start, loop, container });
    }
    // Scenes: [{id, start, end, label?, fade?: false}]. Labels default to the scene's heading + first paragraph.
    function scenes(list) {
      sceneList = list;
      for (const s of list) {
        const root = document.getElementById(s.id);
        if (!s.label && root) {
          const h = root.querySelector("h1, h2"), p = root.querySelector(".copy p:not(.kicker), .tagline, p");
          s.label = [h?.textContent, p?.textContent].filter(Boolean).join(". ");
        }
        if (s.fade === false || !root) continue;
        track(root, [
          [s.start - 0.1, { opacity: s.start <= 0 ? 1 : 0 }],
          [s.start + fadeIn - 0.1, { opacity: 1 }],
          [s.end - 0.15, { opacity: 1 }, EASE.exit],
          [s.end + 0.15, { opacity: s.end >= T ? 1 : 0 }],
        ]);
        root.querySelectorAll(".copy > *").forEach((c, i) => enter(c, s.start + 0.1 + i * 0.12));
      }
    }
    function sound(t, fn) { sounds.push({ t, fn }); }

    /* audio */
    let audio = null, soundOn = !reduce;
    function ensureAudio() {
      if (!audio) try { audio = new AudioContext(); } catch { audio = null; }
      if (audio?.state === "suspended") audio.resume();
    }
    // Synthesized boom: low-passed noise burst plus a falling sine. No file, no licence.
    function boom(ctx) {
      const now = ctx.currentTime, sr = ctx.sampleRate;
      const buf = ctx.createBuffer(1, sr * 1.6, sr), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
      const noise = ctx.createBufferSource(); noise.buffer = buf;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(1800, now); lp.frequency.exponentialRampToValueAtTime(90, now + 1.2);
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.9, now); ng.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      noise.connect(lp).connect(ng).connect(ctx.destination); noise.start(now);
      const osc = ctx.createOscillator(); osc.type = "sine";
      osc.frequency.setValueAtTime(140, now); osc.frequency.exponentialRampToValueAtTime(32, now + 0.7);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.9, now); og.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
      osc.connect(og).connect(ctx.destination); osc.start(now); osc.stop(now + 1.2);
    }
    function whoosh(ctx) {
      const now = ctx.currentTime, sr = ctx.sampleRate;
      const buf = ctx.createBuffer(1, sr * 0.5, sr), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / d.length);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400, now); bp.frequency.exponentialRampToValueAtTime(2400, now + 0.45);
      const g = ctx.createGain(); g.gain.value = 0.35;
      src.connect(bp).connect(g).connect(ctx.destination); src.start(now);
    }

    /* clock */
    let t = Math.min(T, Math.max(0, parseFloat(params.get("t")) || 0));
    let playing = false, last = performance.now(), sceneIdx = -1;
    let ui = {};

    function render(now, prev) {
      for (const a of anims) a.currentTime = Math.min(now, T - 0.001) * 1000;
      for (const c of cues) {
        const total = c.anim.totalFrames, fr = c.anim.frameRate || 30, local = (now - c.start) * fr;
        c.container.style.visibility = local < 0 ? "hidden" : "visible";
        let f;
        if (local < 0) f = 0;
        else if (reduce) f = c.loop ? total * 0.5 : total - 1;
        else f = c.loop ? local % total : Math.min(local, total - 1);
        c.anim.goToAndStop(f, true);
      }
      if (playing && soundOn && audio) for (const s of sounds) if (prev < s.t && now >= s.t) s.fn(audio);
      const idx = sceneList.findIndex((s) => now >= s.start && now < s.end);
      const i = idx === -1 ? sceneList.length - 1 : idx;
      if (i !== sceneIdx && sceneList[i]) { sceneIdx = i; ui.caption.textContent = sceneList[i].label || ""; }
      ui.seek.value = now.toFixed(2);
      ui.clock.textContent = `${now.toFixed(1)} / ${T.toFixed(1)}`;
    }
    function frame(nowMs) {
      const prev = t;
      if (playing) { t += (nowMs - last) / 1000; if (t >= T) { t = T; setPlaying(false); } }
      last = nowMs;
      render(t, prev);
      requestAnimationFrame(frame);
    }
    function setPlaying(on) {
      playing = on;
      if (on && t >= T) t = 0;
      ui.play.textContent = on ? "❚❚" : "▶";
      ui.play.setAttribute("aria-label", on ? "Pause" : "Play");
      poke();
    }
    function jump(dir) {
      if (!sceneList.length) return;
      const i = sceneList.findIndex((s) => t >= s.start && t < s.end);
      const cur = i === -1 ? sceneList.length - 1 : i;
      const next = Math.min(sceneList.length - 1, Math.max(0, cur + dir));
      t = dir < 0 && t - sceneList[cur].start > 0.6 ? sceneList[cur].start : sceneList[next].start;
    }
    let idleTimer;
    function poke() {
      ui.controls?.classList.remove("idle");
      clearTimeout(idleTimer);
      if (playing) idleTimer = setTimeout(() => ui.controls.classList.add("idle"), 2500);
    }
    function setSound(on) {
      soundOn = on;
      ui.sound.textContent = on ? "🔊" : "🔇";
      ui.sound.setAttribute("aria-label", on ? "Mute" : "Unmute");
      ui.sound.setAttribute("aria-pressed", String(!on));
    }

    function start({ title = "Play" } = {}) {
      document.head.insertAdjacentHTML("beforeend", `<style>${CSS}</style>`);
      document.body.insertAdjacentHTML("beforeend", `
        <div id="pitch-caption" class="pitch-sr" aria-live="polite"></div>
        <div id="pitch-start"><div><button id="pitch-go" disabled>Loading…</button>
          <p>${T} s · Sound on · Space pause · ← → scenes · R restart · M mute</p></div></div>
        <div id="pitch-controls" role="toolbar" aria-label="Playback">
          <button id="pitch-prev" aria-label="Previous scene">⏮</button>
          <button id="pitch-play" aria-label="Pause">❚❚</button>
          <button id="pitch-next" aria-label="Next scene">⏭</button>
          <button id="pitch-restart" aria-label="Restart">↺</button>
          <input id="pitch-seek" type="range" min="0" max="${T}" step="0.05" value="0" aria-label="Seek" />
          <span id="pitch-clock">0.0 / ${T}</span>
          <button id="pitch-sound" aria-label="Mute" aria-pressed="false">🔊</button>
        </div>`);
      ui = {
        caption: $("#pitch-caption"), controls: $("#pitch-controls"), play: $("#pitch-play"),
        seek: $("#pitch-seek"), clock: $("#pitch-clock"), sound: $("#pitch-sound"),
      };
      if (params.has("clean")) document.body.classList.add("pitch-clean");
      addEventListener("pointermove", poke);
      $("#pitch-prev").onclick = () => jump(-1);
      $("#pitch-next").onclick = () => jump(1);
      $("#pitch-restart").onclick = () => { t = 0; ensureAudio(); setPlaying(true); };
      ui.play.onclick = () => { ensureAudio(); setPlaying(!playing); };
      ui.seek.oninput = () => { t = parseFloat(ui.seek.value); };
      ui.sound.onclick = () => { ensureAudio(); setSound(!soundOn); };
      setSound(soundOn);
      addEventListener("keydown", (e) => {
        if (e.target instanceof HTMLInputElement && e.key !== " ") return;
        const k = e.key.toLowerCase();
        if (k === " ") { e.preventDefault(); ensureAudio(); setPlaying(!playing); }
        else if (k === "arrowleft") jump(-1);
        else if (k === "arrowright") jump(1);
        else if (k === "r") { t = 0; ensureAudio(); setPlaying(true); }
        else if (k === "m") setSound(!soundOn);
        else return;
        poke();
      });

      const st = $(stage);
      const fit = () => {
        const s = Math.min(innerWidth / width, innerHeight / height);
        st.style.transform = `translate(${(innerWidth - width * s) / 2}px, ${(innerHeight - height * s) / 2}px) scale(${s})`;
      };
      addEventListener("resize", fit);
      fit();

      const startEl = $("#pitch-start"), go = $("#pitch-go");
      setPlaying(false);
      requestAnimationFrame(frame);
      Promise.all($$("img").map((img) => img.decode().catch(() => console.error("image failed:", img.src)))).then(() => {
        window.__ready = true;
        if (params.has("t") || params.has("autoplay")) {
          startEl.remove();
          if (params.has("autoplay")) setPlaying(true);
          return;
        }
        go.disabled = false;
        go.textContent = "▶ " + title;
        go.focus();
      });
      go.onclick = () => { ensureAudio(); startEl.remove(); t = 0; setPlaying(true); };
      // Test hook for scripts/verify.mjs: deterministic seek.
      window.__seek = (s) => { t = s; render(t, t); };
    }

    return { T, EASE, reduce, track, enter, callout, cue, scenes, sound, boom, whoosh, start, tY, pos, $, $$ };
  }
  window.Pitch = { create };
})();
