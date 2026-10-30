import { TAU, rand, clamp } from './utils.js';

const glowCache = new Map();

/** Radial-gradient dot sprite, bucketed by hue, shared by all particles. */
function glowSprite(hue) {
  const key = Math.round(hue / 15) * 15;
  let sprite = glowCache.get(key);
  if (sprite) return sprite;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `hsla(${key},100%,92%,1)`);
  grad.addColorStop(0.2, `hsla(${key},100%,72%,0.85)`);
  grad.addColorStop(0.45, `hsla(${key},100%,60%,0.28)`);
  grad.addColorStop(1, `hsla(${key},100%,55%,0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowCache.set(key, c);
  return c;
}

const KINDS = { SPARK: 0, RING: 1, TEXT: 2, GLOW: 3, SHARD: 4 };

/**
 * Pooled particle system. Everything lives in world space and is drawn with
 * additive blending for that neon bloom feel.
 */
export class Particles {
  constructor(max = 900) {
    this.max = max;
    this.pool = [];
    this.active = [];
    for (let i = 0; i < max; i++) {
      this.pool.push({
        kind: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
        size: 1, size1: 1, hue: 160, sat: 100, light: 65, alpha: 1,
        drag: 1, gravity: 0, rot: 0, spin: 0, text: '', font: 12, glow: 1,
      });
    }
  }

  clear() {
    while (this.active.length) this.pool.push(this.active.pop());
  }

  spawn(cfg) {
    const p = this.pool.pop();
    if (!p) return null;
    p.kind = cfg.kind ?? KINDS.SPARK;
    p.x = cfg.x; p.y = cfg.y;
    p.vx = cfg.vx || 0; p.vy = cfg.vy || 0;
    p.maxLife = cfg.life || 0.6;
    p.life = p.maxLife;
    p.size = cfg.size ?? 3;
    p.size1 = cfg.size1 ?? 0;
    p.hue = cfg.hue ?? 165;
    p.sat = cfg.sat ?? 100;
    p.light = cfg.light ?? 68;
    p.alpha = cfg.alpha ?? 1;
    p.drag = cfg.drag ?? 2.2;
    p.gravity = cfg.gravity ?? 0;
    p.rot = cfg.rot || 0;
    p.spin = cfg.spin || 0;
    p.text = cfg.text || '';
    p.font = cfg.font || 14;
    p.glow = cfg.glow ?? 1;
    this.active.push(p);
    return p;
  }

  burst(x, y, count, opts = {}) {
    const {
      hue = 165, speed = 150, spread = TAU, angle = 0, size = 3.2,
      life = 0.7, sat = 100, light = 70, drag = 2.4, kind = KINDS.SPARK,
    } = opts;
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-spread / 2, spread / 2);
      const sp = speed * rand(0.35, 1.15);
      this.spawn({
        kind,
        x: x + rand(-3, 3),
        y: y + rand(-3, 3),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: life * rand(0.6, 1.25),
        size: size * rand(0.6, 1.3),
        size1: 0,
        hue: hue + rand(-16, 16),
        sat,
        light,
        drag,
      });
    }
  }

  ring(x, y, opts = {}) {
    return this.spawn({
      kind: KINDS.RING,
      x, y,
      life: opts.life ?? 0.55,
      size: opts.size ?? 6,
      size1: opts.size1 ?? 90,
      hue: opts.hue ?? 165,
      light: opts.light ?? 75,
      alpha: opts.alpha ?? 0.85,
      vx: opts.vx || 0,
      vy: opts.vy || 0,
      drag: 0,
    });
  }

  text(x, y, text, opts = {}) {
    return this.spawn({
      kind: KINDS.TEXT,
      x, y,
      vx: opts.vx || 0,
      vy: opts.vy ?? -46,
      life: opts.life ?? 0.9,
      size: opts.size ?? 15,
      hue: opts.hue ?? 160,
      sat: opts.sat ?? 90,
      light: opts.light ?? 82,
      text,
      font: opts.font ?? 15,
      drag: opts.drag ?? 1.4,
      alpha: opts.alpha ?? 1,
    });
  }

  update(dt) {
    const a = this.active;
    for (let i = a.length - 1; i >= 0; i--) {
      const p = a[i];
      p.life -= dt;
      if (p.life <= 0) {
        a[i] = a[a.length - 1];
        a.pop();
        this.pool.push(p);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      if (p.drag) {
        const d = Math.exp(-p.drag * dt);
        p.vx *= d;
        p.vy *= d;
      }
      p.rot += p.spin * dt;
    }
  }

  draw(ctx) {
    const a = this.active;
    if (!a.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Soft sparks & glows
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      const t = p.life / p.maxLife;
      if (p.kind === KINDS.SPARK || p.kind === KINDS.GLOW) {
        const alpha = p.alpha * Math.min(1, t * 1.35) * 0.85;
        if (alpha <= 0.012) continue;
        const r = p.kind === KINDS.GLOW ? p.size * (1.7 - t * 0.6) : p.size * (0.6 + t * 0.8);
        const sprite = glowSprite(p.hue);
        const s = r * 4.2;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s);
        ctx.globalAlpha = 1;
      } else if (p.kind === KINDS.RING) {
        const k = 1 - t;
        const r = p.size + (p.size1 - p.size) * (1 - Math.pow(1 - k, 2.2));
        ctx.strokeStyle = `hsla(${p.hue},${p.sat}%,${p.light}%,${p.alpha * t * 0.9})`;
        ctx.lineWidth = Math.max(0.8, 4.2 * t);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    // Text popups last so they stay legible.
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      if (p.kind !== KINDS.TEXT) continue;
      const t = clamp(p.life / p.maxLife, 0, 1);
      const rise = 1 - t;
      const scale = t > 0.75 ? 1 + (t - 0.75) * 1.6 : 1;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t * 1.9);
      ctx.font = `700 ${p.font * scale}px "Chakra Petch", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = 'rgba(2,6,14,0.7)';
      ctx.strokeText(p.text, p.x, p.y - rise * 6);
      ctx.fillStyle = `hsl(${p.hue},${p.sat}%,${p.light}%)`;
      ctx.fillText(p.text, p.x, p.y - rise * 6);
      ctx.restore();
    }
    ctx.restore();
  }
}
