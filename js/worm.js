import { TAU, clamp, lerp, rand, dist, angleDelta } from './utils.js';

export const MAX_SEGMENTS = 280;
const BASE_SPEED = 248;
const BOOST_MULT = 1.9;
const BOOST_DRAIN = 30;
const BOOST_REGEN = 25;

/**
 * A worm is a head that drags a trail of sampled body points behind it.
 * Body segments are resampled from that trail every frame, which keeps the
 * motion smooth at any frame rate and makes collisions cheap to reason about.
 */
export class Worm {
  constructor(opts = {}) {
    this.isPlayer = !!opts.isPlayer;
    this.maxSegments = opts.maxSegments ?? MAX_SEGMENTS;
    this.growScale = opts.growScale ?? 1;
    this.name = opts.name || '';
    this.hue = opts.hue ?? 165;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.angle = opts.angle ?? rand(0, TAU);
    this.segmentsCount = opts.segments ?? 24;
    this.speed = BASE_SPEED * (opts.speedScale ?? 1);
    this.speedScale = opts.speedScale ?? 1;
    this.boost = 100;
    this.boosting = false;
    this.boostLock = 0;
    this.boostPulse = 0;
    this.alive = true;
    this.invuln = opts.invuln ?? 0;
    this.deathCause = '';
    this.kills = 0;
    this.time = 0;
    this.eatFlash = 0;
    this.wobble = rand(0, TAU);
    this.turnRate = opts.turnRate ?? 7.4;
    this.aggression = opts.aggression ?? 0.5;
    this.thinkTimer = rand(0, 0.15);
    this.targetAngle = this.angle;
    this.path = [];
    this.segments = [];
    this.pathStep = 0;
    this._initTrail();
    this.computeSegments();
  }

  get radius() {
    return Math.min(20.5, 10 + Math.sqrt(this.segmentsCount) * 0.47);
  }

  get spacing() {
    return Math.max(3.5, this.radius * 0.46);
  }

  get lengthScore() {
    return Math.round(this.segmentsCount * 3);
  }

  _initTrail() {
    const step = Math.max(1.6, this.spacing * 0.5);
    this.pathStep = step;
    this.spacingVal = this.spacing;
    const count = Math.ceil((this.segmentsCount * this.spacing + 60) / step);
    const cx = Math.cos(this.angle);
    const cy = Math.sin(this.angle);
    this.path.length = 0;
    for (let i = count; i >= 0; i--) {
      this.path.push({ x: this.x - cx * step * i, y: this.y - cy * step * i });
    }
    this._trailHead = { x: this.x, y: this.y };
  }

  grow(amount) {
    this.segmentsCount = Math.min(this.maxSegments, this.segmentsCount + amount * this.growScale);
  }

  die(cause = '') {
    if (!this.alive) return;
    this.alive = false;
    this.deathCause = cause;
    this.boosting = false;
  }

  /**
   * @param {number} dt seconds
   * @param {object} world
   * @param {number|null} steerAngle desired heading (null = hold course)
   * @param {boolean} wantBoost
   */
  update(dt, world, steerAngle, wantBoost) {
    this.time += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.eatFlash > 0) this.eatFlash = Math.max(0, this.eatFlash - dt * 4);
    this.boostPulse = Math.max(0, this.boostPulse - dt * 3.2);

    const r = this.radius;
    const spacing = this.spacing;
    this.spacingVal = spacing;

    // ---- Boost economy ----
    const canBoost = this.boost > 3;
    this.boosting = !!wantBoost && canBoost;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - BOOST_DRAIN * dt);
      this.boostLock = 0.55;
      this.boostPulse = 1;
    } else {
      this.boostLock = Math.max(0, this.boostLock - dt);
      if (this.boostLock <= 0) {
        this.boost = Math.min(100, this.boost + BOOST_REGEN * dt);
      }
    }

    // ---- Steering ----
    let target = steerAngle === null || steerAngle === undefined ? this.angle : steerAngle;

    // The arena edge gently bends every worm back inward. It warns, it does not
    // steal control, but you cannot escape the arena.
    const dCenter = Math.hypot(this.x, this.y);
    const edgeZone = world.radius * 0.88;
    if (dCenter > edgeZone) {
      const t = clamp((dCenter - edgeZone) / (world.radius * 0.14), 0, 1.25);
      const inward = Math.atan2(-this.y, -this.x);
      const blend = clamp(t, 0, 1);
      const delta = angleDelta(target, inward);
      target += delta * blend;
    }

    const turn = this.turnRate * (this.radius > 15 ? 0.88 : 1) * (this.boosting ? 0.82 : 1);
    const delta = angleDelta(this.angle, target);
    const maxStep = turn * dt;
    if (Math.abs(delta) <= maxStep) this.angle = target;
    else this.angle += Math.sign(delta) * maxStep;
    this.angle = (this.angle + TAU * 2) % TAU;

    // ---- Speed ----
    const sizeDrag = 1 - clamp((r - 10) / 26, 0, 0.16);
    const edgeDrag = dCenter > world.radius * 0.97 ? 0.72 : 1;
    const wanted = BASE_SPEED * this.speedScale * sizeDrag * edgeDrag * (this.boosting ? BOOST_MULT : 1);
    this.speed = lerp(this.speed, wanted, 1 - Math.exp(-9 * dt));

    const dx = Math.cos(this.angle) * this.speed * dt;
    const dy = Math.sin(this.angle) * this.speed * dt;
    this.x += dx;
    this.y += dy;

    // ---- Trail sampling ----
    const trail = this.path;
    const last = trail[trail.length - 1];
    const hx = this.x, hy = this.y;
    let ddx = hx - last.x;
    let ddy = hy - last.y;
    let d = Math.hypot(ddx, ddy);
    const step = this.pathStep;
    let guard = 0;
    while (d >= step && guard++ < 24) {
      const t = step / d;
      const nx = last.x + ddx * t;
      const ny = last.y + ddy * t;
      trail.push({ x: nx, y: ny });
      last.x = nx;
      last.y = ny;
      ddx = hx - last.x;
      ddy = hy - last.y;
      d = Math.hypot(ddx, ddy);
    }

    const maxPoints = Math.ceil((this.segmentsCount * spacing + spacing * 3) / step) + 4;
    const overflow = trail.length - maxPoints;
    if (overflow > 0) trail.splice(0, overflow);

    this.computeSegments();
  }

  /** Resample body nodes at even arc-length intervals along the trail. */
  computeSegments() {
    const path = this.path;
    const segs = this.segments;
    const n = Math.max(2, Math.round(this.segmentsCount));
    const spacing = this.spacingVal || this.spacing;
    const pathLen = path.length;

    let cursorX = this.x;
    let cursorY = this.y;
    let pi = pathLen - 1;
    let travelled = 0;
    let needed = spacing;
    let out = 0;

    while (out < n && pi >= 0) {
      const bx = path[pi].x;
      const by = path[pi].y;
      let ex = bx - cursorX;
      let ey = by - cursorY;
      let segLen = Math.hypot(ex, ey);

      while (out < n && travelled + segLen >= needed) {
        const t = (needed - travelled) / segLen;
        const sx = cursorX + ex * t;
        const sy = cursorY + ey * t;
        let s = segs[out];
        if (!s) { s = { x: 0, y: 0 }; segs[out] = s; }
        s.x = sx;
        s.y = sy;
        out++;
        cursorX = sx;
        cursorY = sy;
        ex = bx - cursorX;
        ey = by - cursorY;
        segLen = Math.hypot(ex, ey);
        travelled = 0;
      }
      if (out >= n) break;
      travelled += segLen;
      cursorX = bx;
      cursorY = by;
      pi--;
    }

    // If the trail is somehow short, extend the tail straight out behind.
    while (out < n) {
      const s = segs[out] || (segs[out] = { x: 0, y: 0 });
      s.x = cursorX - Math.cos(this.angle) * spacing;
      s.y = cursorY - Math.sin(this.angle) * spacing;
      cursorX = s.x;
      cursorY = s.y;
      out++;
    }
    if (segs.length > n) segs.length = n;
  }

  /** Distance from head to a point, useful for camera/culling. */
  headDistance(x, y) {
    return dist(this.x, this.y, x, y);
  }
}
