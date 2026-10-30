# NEON WORM

A fast, glowing worm-arena arcade game for the browser. Eat light, grow long, and cut off rival worms — all rendered on a single canvas with zero dependencies.

![Play in your browser](https://img.shields.io/badge/play-browser-5cffd0) ![No build step](https://img.shields.io/badge/build-none-8b5cff) ![60fps](https://img.shields.io/badge/target-60fps-22e6ff)

---

## Play it

```bash
npm start          # → http://localhost:8000
```

No install, no bundler, no dependencies. `npm start` runs a tiny static server (`serve.js`); any static file server works, since the game is plain HTML/CSS/ES modules.

> Tip: opening `index.html` directly from disk won't work — browsers block ES modules on `file://`. Use the server.

---

## The game

You are a neon worm in a circular arena.

| Action | Keyboard / Mouse | Touch |
| --- | --- | --- |
| Steer | Move the mouse, or `WASD` / arrow keys | Drag anywhere |
| Boost | Hold `Space`, `Shift`, or mouse button | Hold the **BOOST** pad, or a second finger |
| Pause | `Esc` / `P` | ❚❚ button |
| Restart | `Enter` / `R` | **PLAY AGAIN** |
| Mute | `M` | ♪ button |

**Rules**

- Eat glowing orbs to grow longer and score points. Chain them quickly to build up to a **x5** multiplier.
- If your head touches any rival's body, you die instantly. Make rivals hit **you** to score big — bigger worms are worth more.
- Boost is a limited meter; it refills when you let go.
- The striped red edge is lethal. The arena bends you back inward, but get greedy and you'll be cornered.

Everything is tuned so the first ten seconds are a feeding frenzy: you spawn inside a cluster of orbs, with a short shield, and rivals need time before they start hunting.

---

## What's in the box

- **Start screen** with a live arena behind it, personal best, controls, and the local high-score board.
- **In-game HUD** — animated score, length, kill count, combo, boost meter, live minimap, and a kill feed.
- **Pause state** (`Esc` or the HUD button) with quick restart, and automatic pause when the tab loses focus.
- **Game-over state** with final stats, rank, "new record" badge, instant restart, and the local top-8 table.
- **Local high scores** (`localStorage`) with a custom pilot name, plus a **how-to-play** modal.
- **Juice** — screen shake, hit-stop, additive particle sparks, shockwave rings, score popups, floating combo text, boost speed lines, death slow-mo, colour flashes, and a screen-edge danger vignette.
- **Synth audio** — every sound effect is generated with WebAudio (no assets), including a boost rumble, eat blips that rise with your combo, and a kill chime.

---

## Technical notes

The whole game is vanilla JS ES modules, ~2,400 lines, no dependencies.

```
index.html          markup & screens
styles.css          neon theme, responsive HUD
serve.js            zero-dependency static server
js/
  main.js           state machine, scoring, HUD, wiring
  render.js         canvas renderer: cached sprites, worms, particles, minimap
  world.js          food ecosystem, spatial hashes, collisions, spawning
  worm.js           head/trail physics, tapered body resampling
  ai.js             rival brains: forage, dodge, ambush
  particles.js      pooled particle system
  camera.js         follow camera, size zoom, trauma shake
  input.js          unified mouse / keyboard / touch steering
  audio.js          WebAudio synth SFX
  scores.js         localStorage high-score table
  utils.js          math helpers
```

Design decisions worth knowing if you want to hack on it:

- **Bodies are resampled from a trail.** The head records its path and body nodes are sampled at even arc-length intervals each frame, so the worm is smooth at any frame rate and body collisions are trivial circle tests.
- **Spatial hashing for everything.** Food and body segments live in cell maps that are rebuilt (and reused, not reallocated) each frame, so collision queries stay constant-time-ish as the arena grows.
- **Zero per-frame allocation in the hot path.** Particles and food are pooled; the renderer caches hue-bucketed radial-gradient sprites instead of using `shadowBlur`.
- **Culling on zoom.** Only food and worms inside the camera bounds are drawn, which keeps draw calls flat as the arena fills up.
- **Adaptive quality.** Device pixel ratio is capped (1.6 on mobile), and if the average frame time exceeds ~21ms the render scale drops and the arena density thins out, automatically.
- **Touch-first controls.** Steering is a relative drag stick anchored where your thumb lands, so you never have to look at your finger, and the boost pad is thumb-sized.

Tested headlessly with a DOM harness and a canvas renderer for game balance, flow, and frame output.

### Tweaking

- Arena size, food density, and rival count: `quality` and `new World({...})` in `js/main.js`.
- Worm speed, boost, growth, and length cap: constants at the top of `js/worm.js`.
- Rival behaviour: `js/ai.js`.
- Difficulty curve: `World._spawnBot()` and `Worm.grow()` in `js/world.js` / `worm.js`.

---

## Browser support

Modern Chrome, Edge, Firefox and Safari (desktop and mobile). Requires ES modules, Canvas 2D and `localStorage`; audio degrades silently if WebAudio is unavailable.
