import { TAU, clamp, seededRandom, hsl } from './utils.js';

const TAU_ = TAU;

/** Canvas renderer with pre-baked sprites and strict culling. */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.time = 0;
    this.orbSprites = new Map();
    this.starPattern = null;
    this.starPattern2 = null;
    this.nebula = null;
    this.vignette = null;
    this.vignetteRed = null;
    this.visibleFood = [];
    this.wormDrawList = [];
    this._scanlines = null;
    this.lowFx = false;
  }

  setSize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this._buildBackdrop();
  }

  // ------------------------------------------------------------------
  // Pre-baked assets
  // ------------------------------------------------------------------
  _orbSprite(hue) {
    const key = Math.round(hue / 12) * 12;
    let sprite = this.orbSprites.get(key);
    if (sprite) return sprite;
    const size = 96;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `hsla(${key},100%,88%,0.95)`);
    grad.addColorStop(0.14, `hsla(${key},100%,70%,0.75)`);
    grad.addColorStop(0.36, `hsla(${key},100%,60%,0.22)`);
    grad.addColorStop(0.7, `hsla(${key},100%,55%,0.05)`);
    grad.addColorStop(1, `hsla(${key},100%,50%,0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    this.orbSprites.set(key, c);
    return c;
  }

  _buildBackdrop() {
    const { w, h } = this;
    if (w < 2 || h < 2) return;

    // --- Nebula backdrop (rebuilt on resize only) ---
    const neb = document.createElement('canvas');
    neb.width = Math.max(2, Math.round(w));
    neb.height = Math.max(2, Math.round(h));
    const nctx = neb.getContext('2d');
    nctx.fillStyle = '#04060d';
    nctx.fillRect(0, 0, neb.width, neb.height);
    const rand = seededRandom(1337);
    const blobs = [
      { x: 0.25, y: 0.25, r: 0.55, hue: 178, a: 0.16 },
      { x: 0.78, y: 0.32, r: 0.5, hue: 272, a: 0.14 },
      { x: 0.55, y: 0.82, r: 0.62, hue: 210, a: 0.12 },
      { x: 0.9, y: 0.85, r: 0.42, hue: 320, a: 0.09 },
    ];
    for (const b of blobs) {
      const g = nctx.createRadialGradient(
        neb.width * b.x, neb.height * b.y, 0,
        neb.width * b.x, neb.height * b.y, Math.max(neb.width, neb.height) * b.r,
      );
      g.addColorStop(0, `hsla(${b.hue},85%,55%,${b.a})`);
      g.addColorStop(0.5, `hsla(${b.hue},85%,45%,${b.a * 0.45})`);
      g.addColorStop(1, 'hsla(210,85%,40%,0)');
      nctx.fillStyle = g;
      nctx.fillRect(0, 0, neb.width, neb.height);
    }
    // Faint cloud noise
    nctx.globalAlpha = 0.05;
    for (let i = 0; i < 90; i++) {
      const x = rand() * neb.width;
      const y = rand() * neb.height;
      const r = 20 + rand() * 90;
      const g = nctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'hsla(190,100%,70%,0.5)');
      g.addColorStop(1, 'hsla(190,100%,70%,0)');
      nctx.fillStyle = g;
      nctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    nctx.globalAlpha = 1;
    this.nebula = neb;

    // --- Star tiles (parallax) ---
    const makeStars = (seed, count, maxR, alpha) => {
      const s = document.createElement('canvas');
      s.width = 512;
      s.height = 512;
      const sc = s.getContext('2d');
      const r2 = seededRandom(seed);
      for (let i = 0; i < count; i++) {
        const x = r2() * 512;
        const y = r2() * 512;
        const rad = 0.4 + r2() * maxR;
        const a = alpha * (0.35 + r2() * 0.65);
        const hue = 170 + r2() * 130;
        sc.fillStyle = `hsla(${hue},90%,${75 + r2() * 20}%,${a})`;
        sc.beginPath();
        sc.arc(x, y, rad, 0, TAU_);
        sc.fill();
      }
      return this.ctx.createPattern(s, 'repeat');
    };
    this.starPattern = makeStars(7, 62, 1.0, 0.42);
    this.starPattern2 = makeStars(23, 24, 1.7, 0.3);

    // --- Vignettes ---
    const makeVignette = (colorStops) => {
      const c = document.createElement('canvas');
      c.width = Math.max(2, Math.round(w / 2));
      c.height = Math.max(2, Math.round(h / 2));
      const g = c.getContext('2d');
      const rad = Math.hypot(c.width, c.height) * 0.62;
      const grad = g.createRadialGradient(c.width / 2, c.height / 2, rad * 0.42, c.width / 2, c.height / 2, rad);
      for (const [stop, color] of colorStops) grad.addColorStop(stop, color);
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
      return c;
    };
    this.vignette = makeVignette([[0, 'rgba(2,4,10,0)'], [0.7, 'rgba(2,4,10,0.35)'], [1, 'rgba(2,4,10,0.82)']]);
    this.vignetteRed = makeVignette([[0, 'rgba(255,20,80,0)'], [0.55, 'rgba(255,20,80,0.06)'], [1, 'rgba(255,20,80,0.55)']]);

    // --- Hazard stripes for the dead zone outside the arena ---
    const hatch = document.createElement('canvas');
    hatch.width = 56;
    hatch.height = 56;
    const hctx = hatch.getContext('2d');
    hctx.strokeStyle = 'rgba(255,64,112,0.4)';
    hctx.lineWidth = 7;
    hctx.beginPath();
    hctx.moveTo(-14, 70);
    hctx.lineTo(70, -14);
    hctx.moveTo(14, 70);
    hctx.lineTo(70, 14);
    hctx.stroke();
    this.hatchPattern = this.ctx.createPattern(hatch, 'repeat');
  }

  // ------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------
  render(world, cam, state) {
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    this.time = state.time;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#04060d';
    ctx.fillRect(0, 0, w, h);

    this._drawBackdrop(ctx, cam);

    ctx.save();
    ctx.translate(w / 2 + cam.shakeX, h / 2 + cam.shakeY);
    if (cam.rot) ctx.rotate(cam.rot);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    this._drawGrid(ctx, cam);
    this._drawArena(ctx, world, cam, state);
    this._drawFood(ctx, world, cam);
    this._drawWorms(ctx, world, cam, state);
    if (state.particles) state.particles.draw(ctx);
    ctx.restore();

    this._drawOverlay(ctx, cam, state);
  }

  _drawBackdrop(ctx, cam) {
    const { w, h } = this;
    if (this.nebula) {
      const ox = clamp(-cam.x * 0.012, -14, 14);
      const oy = clamp(-cam.y * 0.012, -14, 14);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(this.nebula, -18 + ox, -18 + oy, w + 36, h + 36);
      ctx.globalAlpha = 1;
    }
    if (this.starPattern) {
      const drawLayer = (pattern, parallax, extraAlpha) => {
        const ox = ((-cam.x * cam.zoom * parallax + cam.shakeX * 0.5) % 512 + 512) % 512;
        const oy = ((-cam.y * cam.zoom * parallax + cam.shakeY * 0.5) % 512 + 512) % 512;
        ctx.save();
        ctx.translate(ox - 512, oy - 512);
        ctx.fillStyle = pattern;
        ctx.globalAlpha = extraAlpha;
        ctx.fillRect(0, 0, w + 512, h + 512);
        ctx.restore();
      };
      drawLayer(this.starPattern, 0.06, 0.8);
      if (!this.lowFx) drawLayer(this.starPattern2, 0.14, 0.6);
      ctx.globalAlpha = 1;
    }
  }

  _drawGrid(ctx, cam) {
    const b = cam.viewBounds;
    const zoom = cam.zoom;
    ctx.lineWidth = 1 / zoom;

    ctx.strokeStyle = 'rgba(88,160,230,0.05)';
    ctx.beginPath();
    for (let x = Math.floor(b.left / 110) * 110; x < b.right; x += 110) {
      ctx.moveTo(x, b.top);
      ctx.lineTo(x, b.bottom);
    }
    for (let y = Math.floor(b.top / 110) * 110; y < b.bottom; y += 110) {
      ctx.moveTo(b.left, y);
      ctx.lineTo(b.right, y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(120,210,255,0.075)';
    ctx.beginPath();
    for (let x = Math.floor(b.left / 550) * 550; x < b.right; x += 550) {
      ctx.moveTo(x, b.top);
      ctx.lineTo(x, b.bottom);
    }
    for (let y = Math.floor(b.top / 550) * 550; y < b.bottom; y += 550) {
      ctx.moveTo(b.left, y);
      ctx.lineTo(b.right, y);
    }
    ctx.stroke();
  }

  _drawArena(ctx, world, cam, state) {
    const R = world.radius;
    const b = cam.viewBounds;
    const t = this.time;

    // Hazard zone outside the arena
    const dangerPulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.beginPath();
    ctx.rect(b.left - 200, b.top - 200, b.right - b.left + 400, b.bottom - b.top + 400);
    ctx.arc(0, 0, R, 0, TAU_, true);
    ctx.fillStyle = `rgba(255,32,86,${0.075 + dangerPulse * 0.035})`;
    ctx.fill();

    if (this.hatchPattern && !this.lowFx) {
      ctx.save();
      ctx.globalAlpha = 0.1 + dangerPulse * 0.07;
      ctx.fillStyle = this.hatchPattern;
      ctx.fill();
      ctx.restore();
    }

    // Inner soft glow line
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU_);
    ctx.strokeStyle = 'rgba(255,70,120,0.16)';
    ctx.lineWidth = 26 / cam.zoom;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU_);
    ctx.strokeStyle = `rgba(255,90,140,${0.5 + dangerPulse * 0.2})`;
    ctx.lineWidth = 2.5 / cam.zoom;
    ctx.stroke();

    // Rotating warning dashes
    ctx.save();
    ctx.rotate(t * 0.08);
    ctx.beginPath();
    ctx.arc(0, 0, R - 14, 0, TAU_);
    ctx.setLineDash([26 / cam.zoom, 34 / cam.zoom]);
    ctx.strokeStyle = 'rgba(255,140,170,0.35)';
    ctx.lineWidth = 1.5 / cam.zoom;
    ctx.stroke();
    ctx.restore();

    // Faint inner ring for depth
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.72, 0, TAU_);
    ctx.strokeStyle = 'rgba(120,200,255,0.04)';
    ctx.lineWidth = 1 / cam.zoom;
    ctx.stroke();
  }

  _drawFood(ctx, world, cam) {
    const b = cam.viewBounds;
    const foods = world.food;
    const vis = this.visibleFood;
    vis.length = 0;
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      if (!f.alive) continue;
      if (f.x < b.left - f.r || f.x > b.right + f.r || f.y < b.top - f.r || f.y > b.bottom + f.r) continue;
      vis.push(f);
    }

    const t = this.time;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < vis.length; i++) {
      const f = vis[i];
      const pulse = 0.86 + 0.14 * Math.sin(t * 2.2 + f.phase);
      const s = f.r * (f.big ? 9.6 : 8.6) * pulse;
      const sprite = this._orbSprite(f.hue);
      ctx.drawImage(sprite, f.x - s / 2, f.y - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';

    for (let i = 0; i < vis.length; i++) {
      const f = vis[i];
      const pulse = 0.9 + 0.1 * Math.sin(t * 2.2 + f.phase);
      const r = f.r * pulse;
      ctx.fillStyle = hsl(f.hue, 92, 62);
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, TAU_);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.beginPath();
      ctx.arc(f.x - r * 0.16, f.y - r * 0.2, Math.max(0.7, r * 0.32), 0, TAU_);
      ctx.fill();
    }
  }

  _drawWorms(ctx, world, cam, state) {
    const list = this.wormDrawList;
    list.length = 0;
    const b = cam.viewBounds;
    for (let i = 0; i < world.worms.length; i++) {
      const w = world.worms[i];
      if (!w.alive) continue;
      const len = w.segmentsCount * w.spacing + 60;
      const reach = Math.max(b.right - b.left, b.bottom - b.top) * 0.5 + len;
      if (Math.abs(w.x - cam.x) > reach || Math.abs(w.y - cam.y) > reach) continue;
      list.push(w);
    }
    list.sort((a, b2) => (a.isPlayer ? 1 : 0) - (b2.isPlayer ? 1 : 0));

    // Glow pass first so overlapping worms bloom together.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < list.length; i++) this._strokeBody(ctx, list[i], cam, true);
    ctx.restore();

    for (let i = 0; i < list.length; i++) this._drawWorm(ctx, list[i], cam, state);
  }

  _bodyPath(ctx, worm, cam, limit = Infinity) {
    const segs = worm.segments;
    const r = worm.radius;
    const detail = r * cam.zoom < 5 ? 3 : r * cam.zoom < 9 ? 2 : 1;
    const end = Math.min(segs.length, limit);
    ctx.beginPath();
    ctx.moveTo(worm.x, worm.y);
    for (let i = 0; i < end; i += detail) {
      ctx.lineTo(segs[i].x, segs[i].y);
    }
    if (end > 0) {
      const last = segs[end - 1];
      ctx.lineTo(last.x, last.y);
    }
    return detail;
  }

  _strokeBody(ctx, worm, cam, glowOnly) {
    const r = worm.radius;
    this._bodyPath(ctx, worm, cam);
    if (glowOnly) {
      const boostGlow = worm.boosting ? 1.6 : 1;
      ctx.strokeStyle = `hsla(${worm.hue},100%,60%,${0.028 * boostGlow})`;
      ctx.lineWidth = r * 2 + 34 * boostGlow;
      ctx.stroke();
      ctx.strokeStyle = `hsla(${worm.hue},100%,66%,${0.05 * boostGlow})`;
      ctx.lineWidth = r * 2 + 14 * boostGlow;
      ctx.stroke();
      return;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `hsl(${worm.hue},60%,17%)`;
    ctx.lineWidth = r * 2 + 3;
    ctx.stroke();
  }

  _drawWorm(ctx, worm, cam, state) {
    const r = worm.radius;
    const segs = worm.segments;
    if (!segs.length) return;
    const boostT = worm.boosting ? 1 : 0;

    // The last stretch of body tapers to a point instead of ending in a stump.
    const tailCount = clamp(Math.round(segs.length * 0.32), 10, 24);
    const bodyLimit = Math.max(1, segs.length - tailCount);
    this._bodyPath(ctx, worm, cam, bodyLimit);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const outline = `hsl(${worm.hue},60%,15%)`;
    const bodyCol = `hsl(${worm.hue},84%,${44 + boostT * 6}%)`;
    const SUB = 3;
    const steps = tailCount * SUB;
    const px = [];
    const py = [];
    const pr = [];
    for (let k = 0; k < steps; k++) {
      // Start exactly at the last full-width body node so the taper is seamless.
      const f = Math.min(segs.length - 1, bodyLimit - 1 + (k / SUB));
      const i0 = Math.floor(f);
      const i1 = Math.min(segs.length - 1, i0 + 1);
      const frac = f - i0;
      px.push(segs[i0].x + (segs[i1].x - segs[i0].x) * frac);
      py.push(segs[i0].y + (segs[i1].y - segs[i0].y) * frac);
      const t = k / (steps - 1 || 1);
      pr.push(r * (1 - Math.pow(t, 0.92) * 0.97));
    }

    // 1. Outline pass (body + tapered tail), so nothing dark lands on the body.
    //    NOTE: arcs below call beginPath(), so the body path is rebuilt for each
    //    stroke layer rather than assumed to survive.
    this._bodyPath(ctx, worm, cam, bodyLimit);
    ctx.strokeStyle = outline;
    ctx.lineWidth = r * 2 + 3.2;
    ctx.stroke();
    ctx.fillStyle = outline;
    for (let k = 0; k < steps; k++) {
      if (k / steps > 0.86) break;
      ctx.beginPath();
      ctx.arc(px[k], py[k], pr[k] + 1.5, 0, TAU_);
      ctx.fill();
    }

    // 2. Body
    this._bodyPath(ctx, worm, cam, bodyLimit);
    ctx.strokeStyle = bodyCol;
    ctx.lineWidth = r * 2;
    ctx.stroke();

    // 3. Inner sheen — a lit core running down the body
    this._bodyPath(ctx, worm, cam, Math.max(2, bodyLimit - 2));
    ctx.strokeStyle = `hsla(${worm.hue},100%,82%,${0.16 + boostT * 0.1})`;
    ctx.lineWidth = r * 0.74;
    ctx.stroke();

    // 4. Tapered tail circles cover the blunt cap and the sheen tip.
    ctx.fillStyle = bodyCol;
    for (let k = 0; k < steps; k++) {
      ctx.beginPath();
      ctx.arc(px[k], py[k], Math.max(0.7, pr[k]), 0, TAU_);
      ctx.fill();
    }

    this._drawHead(ctx, worm, cam, state);
  }

  _drawHead(ctx, worm, cam, state) {
    const r = worm.radius;
    const z = cam.zoom;
    const hue = worm.hue;

    // Head shell
    ctx.beginPath();
    ctx.arc(worm.x, worm.y, r * 1.02, 0, TAU_);
    ctx.fillStyle = `hsl(${hue},88%,${52 + (worm.boosting ? 5 : 0)}%)`;
    ctx.fill();
    ctx.lineWidth = 1.6 / z;
    ctx.strokeStyle = `hsla(${hue},100%,86%,0.85)`;
    ctx.stroke();

    // Eyes
    const ax = Math.cos(worm.angle);
    const ay = Math.sin(worm.angle);
    const px = -ay;
    const py = ax;
    const blinkCycle = (this.time * 1.1 + worm.wobble * 3) % 6.2;
    const blink = blinkCycle < 0.13 ? 0.12 : 1;
    const eyeR = r * 0.3;
    const look = worm.eatFlash * 0.18;

    for (const side of [-1, 1]) {
      const cx = worm.x + ax * r * 0.34 + px * side * r * 0.43;
      const cy = worm.y + ay * r * 0.34 + py * side * r * 0.43;
      ctx.beginPath();
      ctx.ellipse(cx, cy, eyeR, eyeR * blink, 0, 0, TAU_);
      ctx.fillStyle = '#f4fdff';
      ctx.fill();
      if (blink > 0.5) {
        ctx.beginPath();
        ctx.arc(cx + ax * eyeR * (0.34 + look), cy + ay * eyeR * (0.34 + look), eyeR * 0.52, 0, TAU_);
        ctx.fillStyle = '#04121c';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - eyeR * 0.18, cy - eyeR * 0.22, eyeR * 0.17, 0, TAU_);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
      }
    }

    // Boost ring
    if (worm.boosting) {
      ctx.beginPath();
      ctx.arc(worm.x, worm.y, r * (1.25 + Math.sin(this.time * 22) * 0.06), 0, TAU_);
      ctx.strokeStyle = `hsla(${hue},100%,80%,0.35)`;
      ctx.lineWidth = 2 / z;
      ctx.stroke();
    }

    // Spawn shield
    if (worm.invuln > 0) {
      const a = clamp(worm.invuln / 2.4, 0, 1);
      ctx.beginPath();
      ctx.arc(worm.x, worm.y, r + 9 + Math.sin(this.time * 8) * 3, 0, TAU_);
      ctx.setLineDash([7 / z, 7 / z]);
      ctx.strokeStyle = `hsla(${hue},100%,80%,${0.25 + a * 0.4})`;
      ctx.lineWidth = 2 / z;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Name tag for rivals
    if (!worm.isPlayer && z > 0.42) {
      const fs = 12 / z;
      ctx.font = `600 ${fs}px "Chakra Petch", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = `hsla(${hue},60%,80%,0.42)`;
      ctx.fillText(worm.name, worm.x, worm.y - r - 7 / z);
    }
  }

  _drawOverlay(ctx, cam, state) {
    const { w, h } = this;
    if (state.boostLines > 0) {
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(w, h) * 0.55;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(150,255,235,${0.13 * state.boostLines})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU_ + this.time * 0.35;
        const inner = maxR * (0.62 + ((i * 37) % 11) / 40);
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * (inner + maxR * 0.22), cy + Math.sin(a) * (inner + maxR * 0.22));
      }
      ctx.stroke();
      ctx.restore();
    }
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, w, h);

    if (state.edgeWarn > 0.01 && this.vignetteRed) {
      ctx.globalAlpha = clamp(state.edgeWarn, 0, 1) * (0.6 + 0.4 * Math.sin(state.time * 6));
      ctx.drawImage(this.vignetteRed, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    if (cam.flash > 0.01) {
      const a = cam.flash * 0.4;
      ctx.fillStyle = `hsla(${cam.flashHue},100%,70%,${a})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // ------------------------------------------------------------------
  // Minimap
  // ------------------------------------------------------------------
  drawMinimap(canvas, world, player, cam) {
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const c = size / 2;
    const scale = (c - 3) / world.radius;
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, TAU_);
    ctx.clip();

    ctx.fillStyle = 'rgba(5,11,22,0.72)';
    ctx.fillRect(0, 0, size, size);

    // Sweep
    const sweep = (this.time * 0.5) % TAU_;
    const grad = ctx.createConicGradient
      ? ctx.createConicGradient(sweep, c, c)
      : null;
    if (grad) {
      grad.addColorStop(0, 'rgba(92,255,208,0.16)');
      grad.addColorStop(0.12, 'rgba(92,255,208,0)');
      grad.addColorStop(1, 'rgba(92,255,208,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }

    // Arena ring
    ctx.beginPath();
    ctx.arc(c, c, (world.radius) * scale, 0, TAU_);
    ctx.strokeStyle = 'rgba(255,90,130,0.45)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Rivals
    for (const w of world.worms) {
      if (!w.alive || w.isPlayer) continue;
      ctx.beginPath();
      ctx.arc(c + w.x * scale, c + w.y * scale, 2.1, 0, TAU_);
      ctx.fillStyle = `hsla(${w.hue},90%,65%,0.9)`;
      ctx.fill();
    }

    // Food density hints (cheap: only big pellets)
    ctx.fillStyle = 'rgba(150,220,255,0.28)';
    for (let i = 0; i < world.food.length; i += 17) {
      const f = world.food[i];
      if (!f.big) continue;
      ctx.fillRect(c + f.x * scale - 0.5, c + f.y * scale - 0.5, 1, 1);
    }

    // Player
    if (player && player.alive) {
      const px = c + player.x * scale;
      const py = c + player.y * scale;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(player.angle);
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(-3.4, 3);
      ctx.lineTo(-3.4, -3);
      ctx.closePath();
      ctx.fillStyle = '#b8fff0';
      ctx.shadowColor = '#5cffd0';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, TAU_);
    ctx.strokeStyle = 'rgba(92,255,208,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
