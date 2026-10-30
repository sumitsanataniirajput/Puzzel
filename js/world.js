import { TAU, clamp, rand, randInt, pick, dist } from './utils.js';
import { Worm } from './worm.js';
import { thinkBot } from './ai.js';

const FOOD_HUES = [162, 186, 48, 320, 282, 205, 0, 96, 340];
const BOT_HUES = [298, 275, 22, 44, 200, 344, 96, 228, 316, 8];
const BOT_NAMES = ['VEX', 'NOODLE', 'ZAP', 'GLOW', 'KRAKEN', 'BYTE', 'ORBIT', 'FLUX', 'MOSS', 'PIXEL', 'HELIX', 'NOVA', 'RIVET', 'ECHO'];

const FOOD_CELL = 110;
const SEG_CELL = 84;

export class World {
  constructor(opts = {}) {
    this.radius = opts.radius ?? 1500;
    this.food = [];
    this.foodPool = [];
    this.worms = [];
    this.player = null;
    this.time = 0;
    this.foodTarget = opts.foodTarget ?? 1500;
    this.maxBots = opts.maxBots ?? 9;
    this.onEat = null;
    this.onDeath = null;
    this.onKill = null;
    this.deathReason = '';

    this._foodQuery = [];
    this._segQuery = [];
    this._segPool = [];
    this._segPoolIndex = 0;
    this._foodGrid = new Map();
    this._segGrid = new Map();
    this._respawns = [];
    this._maxPellets = 260;
  }

  // ------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------
  reset({ playerName = 'YOU', foodTarget = 1500, maxBots = 9, withPlayer = true } = {}) {
    this.time = 0;
    this.food.length = 0;
    this.foodPool.length = 0;
    this.worms.length = 0;
    this.player = null;
    this._respawns.length = 0;
    this.foodTarget = foodTarget;
    this.maxBots = maxBots;

    for (let i = 0; i < foodTarget; i++) this._spawnOrb();

    let spawnX = 0;
    let spawnY = 0;
    if (withPlayer) {
      // Start somewhere with elbow room rather than dead centre.
      const a = rand(0, TAU);
      const d = Math.sqrt(Math.random()) * this.radius * 0.45;
      spawnX = Math.cos(a) * d;
      spawnY = Math.sin(a) * d;
      const p = new Worm({
        x: spawnX, y: spawnY, angle: rand(0, TAU), isPlayer: true, name: playerName,
        hue: 166, segments: 24, invuln: 2.4, turnRate: 8.2, maxSegments: 300,
      });
      this.player = p;
      this.worms.push(p);
    }

    // A friendly cluster of orbs right where you wake up: the first ten seconds
    // should be a feeding frenzy, not a search.
    this._spawnStarterFood(spawnX, spawnY, withPlayer ? 60 : 34);

    for (let i = 0; i < maxBots; i++) this._spawnBot(true);
    this.buildSegmentGrid();
  }

  _spawnStarterFood(x, y, count) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const d = rand(70, 330);
      this._addFood({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        r: rand(3.6, 5.4),
        hue: pick(FOOD_HUES),
        value: Math.random() < 0.18 ? 2 : 1,
      });
    }
  }

  _spawnBot(initial = false) {
    const spot = this.findSpawnPoint(initial ? 700 : 760);
    const tone = this._pickHue();
    const size = initial ? randInt(18, 46) : randInt(14, 30);
    const bot = new Worm({
      x: spot.x,
      y: spot.y,
      angle: Math.atan2(-spot.y, -spot.x) + rand(-0.5, 0.5),
      hue: tone,
      segments: size,
      maxSegments: randInt(110, 175),
      growScale: 0.55,
      name: this._pickName(),
      speedScale: rand(0.94, 1.01),
      turnRate: rand(4.4, 5.6),
      aggression: rand(0.25, 1),
    });
    bot.wantBoost = false;
    bot.wander = rand(0, TAU);
    bot.hunting = false;
    this.worms.push(bot);
    return bot;
  }

  /** Keep rivals visually distinct from each other and from the player. */
  _pickHue() {
    const used = this.worms.map((w) => w.hue).concat([166]);
    let best = pick(BOT_HUES);
    let bestGap = -1;
    for (let i = 0; i < 20; i++) {
      const hue = (pick(BOT_HUES) + rand(-8, 8) + 360) % 360;
      let gap = 360;
      for (const u of used) {
        const raw = Math.abs(hue - u) % 360;
        gap = Math.min(gap, raw > 180 ? 360 - raw : raw);
      }
      if (gap > bestGap) { bestGap = gap; best = hue; }
    }
    return best;
  }

  _pickName() {
    const used = new Set(this.worms.map((w) => w.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    return free.length ? pick(free) : pick(BOT_NAMES);
  }

  findSpawnPoint(minDist) {
    for (let attempt = 0; attempt < 26; attempt++) {
      const a = rand(0, TAU);
      const d = Math.sqrt(Math.random()) * this.radius * 0.76;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      let ok = true;
      for (const w of this.worms) {
        if (!w.alive) continue;
        if (dist(x, y, w.x, w.y) < minDist) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return { x: rand(-0.4, 0.4) * this.radius, y: rand(-0.4, 0.4) * this.radius };
  }

  // ------------------------------------------------------------------
  // Food
  // ------------------------------------------------------------------
  _addFood(opts) {
    let f = this.foodPool.pop();
    if (!f) f = { x: 0, y: 0, r: 4, hue: 160, value: 1, phase: 0, alive: true, drift: false, vx: 0, vy: 0, big: false };
    f.x = opts.x;
    f.y = opts.y;
    f.r = opts.r ?? 4.5;
    f.hue = opts.hue ?? 160;
    f.value = opts.value ?? 1;
    f.phase = rand(0, TAU);
    f.alive = true;
    f.drift = !!opts.drift;
    f.vx = opts.vx || 0;
    f.vy = opts.vy || 0;
    f.big = !!opts.big;
    this.food.push(f);
    return f;
  }

  _spawnOrb(x = null, y = null) {
    let px = x;
    let py = y;
    if (px === null) {
      const a = rand(0, TAU);
      const d = Math.sqrt(Math.random()) * this.radius * 0.985;
      px = Math.cos(a) * d;
      py = Math.sin(a) * d;
    }
    const big = Math.random() < 0.045;
    return this._addFood({
      x: px,
      y: py,
      r: big ? rand(7.5, 9.5) : rand(3.4, 5.6),
      hue: pick(FOOD_HUES),
      value: big ? 5 : Math.random() < 0.2 ? 2 : 1,
      big,
    });
  }

  _dropPellets(worm) {
    const segs = worm.segments;
    const step = Math.max(2, Math.round(segs.length / 60));
    const value = clamp(2 + worm.segmentsCount / 45, 2, 9);
    const count = Math.min(70, Math.ceil(segs.length / step));
    let added = 0;
    for (let i = 0; i < segs.length && added < count; i += step) {
      if (this.food.length >= this.foodTarget + this._maxPellets) break;
      const s = segs[i];
      const a = rand(0, TAU);
      const sp = rand(20, 110);
      this._addFood({
        x: s.x + rand(-4, 4),
        y: s.y + rand(-4, 4),
        r: 5.5 + value * 0.55,
        hue: (worm.hue + rand(-18, 18) + 360) % 360,
        value,
        drift: true,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        big: true,
      });
      added++;
    }
  }

  buildFoodGrid() {
    const map = this._foodGrid;
    for (const arr of map.values()) arr.length = 0;
    const foods = this.food;
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      if (!f.alive) continue;
      const key = cellKey((f.x / FOOD_CELL) | 0, (f.y / FOOD_CELL) | 0);
      let arr = map.get(key);
      if (!arr) { arr = []; map.set(key, arr); }
      arr.push(f);
    }
  }

  queryFood(x, y, radius) {
    const out = this._foodQuery;
    out.length = 0;
    const minX = ((x - radius) / FOOD_CELL) | 0;
    const maxX = ((x + radius) / FOOD_CELL) | 0;
    const minY = ((y - radius) / FOOD_CELL) | 0;
    const maxY = ((y + radius) / FOOD_CELL) | 0;
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const arr = this._foodGrid.get(cellKey(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Body segment hash
  // ------------------------------------------------------------------
  buildSegmentGrid() {
    const map = this._segGrid;
    for (const arr of map.values()) arr.length = 0;
    const pool = this._segPool;
    this._segPoolIndex = 0;

    for (let wi = 0; wi < this.worms.length; wi++) {
      const w = this.worms[wi];
      if (!w.alive) continue;
      const segs = w.segments;
      for (let i = 2; i < segs.length; i += 2) {
        const s = segs[i];
        let entry = pool[this._segPoolIndex];
        if (!entry) { entry = { x: 0, y: 0, r: 0, w: null }; pool[this._segPoolIndex] = entry; }
        this._segPoolIndex++;
        entry.x = s.x;
        entry.y = s.y;
        entry.r = w.radius * 0.95;
        entry.w = w;
        const key = cellKey((s.x / SEG_CELL) | 0, (s.y / SEG_CELL) | 0);
        let arr = map.get(key);
        if (!arr) { arr = []; map.set(key, arr); }
        arr.push(entry);
      }
    }
  }

  querySegments(x, y, radius) {
    const out = this._segQuery;
    out.length = 0;
    const minX = ((x - radius) / SEG_CELL) | 0;
    const maxX = ((x + radius) / SEG_CELL) | 0;
    const minY = ((y - radius) / SEG_CELL) | 0;
    const maxY = ((y + radius) / SEG_CELL) | 0;
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const arr = this._segGrid.get(cellKey(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Simulation
  // ------------------------------------------------------------------
  update(dt, control) {
    this.time += dt;

    // Bots decide, everyone moves.
    for (let i = 0; i < this.worms.length; i++) {
      const w = this.worms[i];
      if (!w.alive) continue;
      if (w.isPlayer) {
        const boost = control ? control.boost : false;
        w.update(dt, this, control ? control.angle : null, boost);
      } else {
        thinkBot(w, this, dt);
        w.update(dt, this, w.targetAngle, w.wantBoost);
      }
    }

    // Collisions use the previous frame's bodies; build before eating so the
    // grid is fresh for both.
    this.buildSegmentGrid();
    this.buildFoodGrid();

    for (let i = 0; i < this.worms.length; i++) {
      const w = this.worms[i];
      if (!w.alive) continue;
      this._eatNearby(w);
    }

    this._resolveCollisions();
    this._updateFood(dt);
    this._maintainPopulation(dt);
    this._trimDead();
  }

  _eatNearby(worm) {
    const reach = worm.radius * 1.15 + 8;
    const foods = this.queryFood(worm.x, worm.y, reach + 26);
    let eaten = 0;
    for (let i = 0; i < foods.length && eaten < 5; i++) {
      const f = foods[i];
      if (!f.alive) continue;
      const d = dist(worm.x, worm.y, f.x, f.y);
      if (d < reach + f.r * 0.6) {
        f.alive = false;
        this.foodPool.push(f);
        eaten++;
        worm.grow(0.3 + f.value * 0.44);
        worm.eatFlash = 1;
        if (this.onEat) this.onEat(worm, f);
      } else if (d < reach + 44 && f.drift) {
        // Magnetic pull on dropped pellets makes kills feel greedy.
        const pull = (1 - d / (reach + 44)) * 26 * 0.016;
        f.x += (worm.x - f.x) * pull;
        f.y += (worm.y - f.y) * pull;
      }
    }
    if (eaten > 0) {
      for (let i = this.food.length - 1; i >= 0; i--) {
        if (!this.food[i].alive) this.food.splice(i, 1);
      }
    }
  }

  _resolveCollisions() {
    for (let i = 0; i < this.worms.length; i++) {
      const w = this.worms[i];
      if (!w.alive || w.invuln > 0) continue;

      // Head to foreign body.
      const candidates = this.querySegments(w.x, w.y, w.radius + SEG_CELL * 0.5);
      let hit = null;
      let hitD = Infinity;
      for (let j = 0; j < candidates.length; j++) {
        const s = candidates[j];
        if (s.w === w || !s.w.alive) continue;
        const d = dist(w.x, w.y, s.x, s.y);
        const limit = w.radius * 0.82 + s.r;
        if (d < limit && d < hitD) { hit = s.w; hitD = d; }
      }
      if (hit) {
        this.killWorm(w, hit, 'body');
        continue;
      }

      // Head to head: the bigger worm survives.
      for (let j = 0; j < this.worms.length; j++) {
        const o = this.worms[j];
        if (o === w || !o.alive || o.invuln > 0) continue;
        const d = dist(w.x, w.y, o.x, o.y);
        if (d < (w.radius + o.radius) * 0.78) {
          if (w.segmentsCount < o.segmentsCount) {
            this.killWorm(w, o, 'head');
          } else if (w.segmentsCount > o.segmentsCount) {
            this.killWorm(o, w, 'head');
          } else {
            this.killWorm(w, o, 'head');
            this.killWorm(o, w, 'head');
          }
        }
      }
    }
  }

  killWorm(victim, killer, cause = 'body') {
    if (!victim.alive) return;
    victim.die(cause);
    victim.killer = killer || null;
    this._dropPellets(victim);
    if (killer && killer !== victim) {
      killer.kills++;
      killer.grow(6);
    }
    if (this.onDeath) this.onDeath(victim, killer, cause);
    if (killer && killer !== victim && this.onKill) this.onKill(killer, victim, cause);

    if (!victim.isPlayer) {
      this._respawns.push({ t: rand(1.2, 2.6) });
    }
  }

  _updateFood(dt) {
    // Only dropped pellets drift; static orbs stay put for grid efficiency.
    for (let i = 0; i < this.food.length; i++) {
      const f = this.food[i];
      if (!f.drift) continue;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      const drag = Math.exp(-2.6 * dt);
      f.vx *= drag;
      f.vy *= drag;
      if (Math.abs(f.vx) < 2) f.drift = false;
    }

    // Keep the arena stocked (a few per frame avoids hitching).
    let deficit = this.foodTarget - this.food.length;
    if (deficit > 0) {
      const batch = Math.min(14, deficit);
      for (let i = 0; i < batch; i++) this._spawnOrb();
    }
  }

  _maintainPopulation(dt) {
    for (let i = this._respawns.length - 1; i >= 0; i--) {
      const r = this._respawns[i];
      r.t -= dt;
      if (r.t <= 0) {
        this._respawns.splice(i, 1);
        if (this.worms.filter((w) => w.alive && !w.isPlayer).length < this.maxBots) {
          this._spawnBot(false);
        }
      }
    }
    // Attract mode: keep the arena lively forever.
    if (!this.player) {
      const alive = this.worms.filter((w) => w.alive).length;
      if (alive < this.maxBots && Math.random() < dt * 1.2) this._spawnBot(false);
    }
  }

  _trimDead() {
    for (let i = this.worms.length - 1; i >= 0; i--) {
      const w = this.worms[i];
      if (!w.alive) {
        this.worms.splice(i, 1);
        if (w === this.player) this.player = null;
      }
    }
  }

  aliveBots() {
    return this.worms.filter((w) => w.alive && !w.isPlayer);
  }
}

function cellKey(cx, cy) {
  return (cx + 1024) * 2048 + (cy + 1024);
}
