import { clamp, damp, rand } from './utils.js';

/** Follow camera with size-based zoom, look-ahead and trauma-based shake. */
export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.trauma = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.rot = 0;
    this.flash = 0;
    this.flashHue = 0;
    this.flashMax = 1;
    this.w = 800;
    this.h = 600;
    this.time = 0;
    this.deadZoom = 0;
    this.reducedMotion = false;
  }

  setViewport(w, h) {
    this.w = w;
    this.h = h;
  }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.trauma = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.zoom = this.baseZoom();
    this.targetZoom = this.zoom;
    this.deadZoom = 0;
  }

  baseZoom() {
    // Portrait phones need a tighter view than a naive min(w,h) fit, otherwise
    // the worm shrinks to a speck in a very tall arena window.
    if (this.w / this.h < 0.9) {
      return clamp(Math.min(1, this.w / 580), 0.42, 1.1);
    }
    return clamp(Math.max(this.w / 1160, this.h / 760), 0.42, 1.45);
  }

  addTrauma(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  flashScreen(amount, hue = 0) {
    this.flash = Math.max(this.flash, amount);
    this.flashMax = Math.max(this.flash, amount);
    this.flashHue = hue;
  }

  follow(target, dt, options = {}) {
    this.time += dt;
    const radius = target ? target.radius : 12;
    const lookAhead = options.lookAhead ?? 0.16;
    const sizeZoom = clamp(Math.pow(12 / radius, 0.42), 0.6, 1.08);
    let zoom = this.baseZoom() * sizeZoom * (options.zoomScale ?? 1);
    if (options.dead) zoom *= 1.22;
    this.targetZoom = zoom;

    if (target) {
      const tx = target.x + Math.cos(target.angle) * target.speed * lookAhead;
      const ty = target.y + Math.sin(target.angle) * target.speed * lookAhead;
      const followRate = options.dead ? 2.2 : 6.5;
      this.x = damp(this.x, tx, followRate, dt);
      this.y = damp(this.y, ty, followRate, dt);
    } else if (options.drift) {
      this.x = options.drift.x;
      this.y = options.drift.y;
    }

    this.zoom = damp(this.zoom, this.targetZoom, 3.4, dt);

    // Shake
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const shake = this.reducedMotion ? this.trauma * 0.12 : this.trauma * this.trauma;
    const mag = shake * 30;
    if (this.trauma > 0) {
      this.shakeX = rand(-mag, mag);
      this.shakeY = rand(-mag, mag);
      this.rot = this.reducedMotion ? 0 : rand(-1, 1) * this.trauma * this.trauma * 0.028;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
      this.rot = 0;
    }

    this.flash = Math.max(0, this.flash - dt * 2.6);
  }

  /** World point -> screen point. */
  toScreen(x, y) {
    return {
      x: (x - this.x) * this.zoom + this.w / 2 + this.shakeX,
      y: (y - this.y) * this.zoom + this.h / 2 + this.shakeY,
    };
  }

  get viewBounds() {
    const hw = this.w / (2 * this.zoom) + 60;
    const hh = this.h / (2 * this.zoom) + 60;
    return { left: this.x - hw, right: this.x + hw, top: this.y - hh, bottom: this.y + hh };
  }
}

