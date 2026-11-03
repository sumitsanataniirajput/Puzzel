import { Renderer } from './render.js';
import { Camera } from './camera.js';
import { World } from './world.js';
import { Particles } from './particles.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import {
  loadScores, saveScore, bestScore, loadName, saveName, MAX_ENTRIES,
} from './scores.js';
import { clamp, damp, formatScore, formatTime, rand, isTouchDevice } from './utils.js';

// ----------------------------------------------------------------------------
// Element handles
// ----------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const dom = {
  canvas: $('game'),
  hud: $('hud'),
  hudScore: $('hudScore'),
  hudLen: $('hudLen'),
  hudKills: $('hudKills'),
  hudCombo: $('hudCombo'),
  hudBoost: $('hudBoost'),
  boostBar: document.querySelector('.boost-bar'),
  minimap: $('minimap'),
  killFeed: $('killFeed'),
  hint: $('hint'),
  screens: {
    start: $('screenStart'),
    pause: $('screenPause'),
    over: $('screenOver'),
  },
  startBest: $('startBest'),
  startBoard: $('startBoard'),
  overBoard: $('overBoard'),
  overScore: $('overScore'),
  overLen: $('overLen'),
  overKills: $('overKills'),
  overFood: $('overFood'),
  overTime: $('overTime'),
  overRank: $('overRank'),
  overReason: $('overReason'),
  recordBadge: $('recordBadge'),
  pauseScore: $('pauseScore'),
  pauseLen: $('pauseLen'),
  pauseTime: $('pauseTime'),
  pilotName: $('pilotName'),
  howTo: $('howTo'),
  btnSoundStart: $('btnSoundStart'),
  btnMute: $('btnMute'),
};

// ----------------------------------------------------------------------------
// Environment
// ----------------------------------------------------------------------------
const coarse = isTouchDevice();
const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 820;
const mobile = coarse || smallScreen;
document.body.classList.toggle('touch', coarse);
document.body.classList.toggle('portrait-touch', coarse && window.matchMedia('(orientation: portrait)').matches);

const quality = {
  dpr: Math.min(window.devicePixelRatio || 1, mobile ? 1.6 : 2),
  food: mobile ? 1300 : 1800,
  bots: mobile ? 7 : 9,
  particles: mobile ? 520 : 900,
};

const sound = new Sound();
const camera = new Camera();
const particles = new Particles(quality.particles);
const world = new World({
  radius: 1750,
  foodTarget: quality.food,
  maxBots: quality.bots,
});

let renderer;
let input;

const state = {
  mode: 'menu', // menu | playing | paused | over
  time: 0,
  runTime: 0,
  score: 0,
  kills: 0,
  foodEaten: 0,
  combo: 1,
  comboTimer: 0,
  bestAtStart: 0,
  player: null,
  deadView: null,
  overlayTimer: 0,
  overlayShown: true,
  hitStop: 0,
  deathSlow: 0,
  edgeWarn: 0,
  warnSound: 0,
  scorePop: 0,
  lastScoreDisplay: -1,
  lastResultId: null,
  menuCamTimer: 0,
  boostFx: 0,
  boostOn: false,
  hintTimer: 0,
  frameAvg: 16.7,
  adaptCooldown: 2.5,
  downgrades: 0,
};

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
function boot() {
  renderer = new Renderer(dom.canvas);
  renderer.lowFx = mobile;
  input = new Input(dom.canvas);
  camera.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const savedName = loadName();
  dom.pilotName.value = savedName;
  document.body.classList.toggle('muted', sound.muted);
  updateSoundLabel();

  resize();
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  window.addEventListener('blur', () => { if (state.mode === 'playing') pauseGame(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'playing') pauseGame();
  });
  dom.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  wireInput();
  wireUI();
  buildBoards();

  enterMenu(true);
  requestAnimationFrame(loop);
}

function wireInput() {
  input.onPause = () => {
    if (state.mode === 'playing') pauseGame();
    else if (state.mode === 'paused') resumeGame();
  };
  input.onKey = (code) => {
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (typing && code !== 'Enter' && code !== 'Escape') return;

    if (code === 'Escape' && typing) {
      document.activeElement.blur();
      return;
    }
    if (code === 'KeyM') {
      toggleMute();
      return;
    }
    if (state.mode === 'menu') {
      if (code === 'Enter' || code === 'Space') { startGame(); }
      return;
    }
    if (state.mode === 'over') {
      if (code === 'Enter' || code === 'KeyR' || code === 'Space') startGame();
      return;
    }
    if (state.mode === 'paused') {
      if (code === 'KeyR') startGame();
      return;
    }
  };
  // First gesture unlocks audio.
  const unlock = () => {
    sound.init();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function wireUI() {
  $('btnPlay').addEventListener('click', () => { sound.ui(); startGame(); });
  $('btnAgain').addEventListener('click', () => { sound.ui(); startGame(); });
  $('btnResume').addEventListener('click', () => { sound.ui(); resumeGame(); });
  $('btnRestartPause').addEventListener('click', () => { sound.ui(); startGame(); });
  $('btnQuit').addEventListener('click', () => { sound.ui(); enterMenu(false); });
  $('btnMenu').addEventListener('click', () => { sound.ui(); enterMenu(false); });
  $('btnPause').addEventListener('click', () => { sound.ui(); pauseGame(); });
  dom.btnMute.addEventListener('click', () => toggleMute());
  dom.btnSoundStart.addEventListener('click', () => toggleMute());
  $('btnHowTo').addEventListener('click', () => { sound.ui(); dom.howTo.classList.add('is-open'); });
  $('btnCloseHowTo').addEventListener('click', () => { sound.ui(); dom.howTo.classList.remove('is-open'); });
  dom.howTo.addEventListener('click', (e) => {
    if (e.target === dom.howTo) dom.howTo.classList.remove('is-open');
  });

  dom.pilotName.addEventListener('input', () => {
    const clean = dom.pilotName.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 8);
    if (clean !== dom.pilotName.value) dom.pilotName.value = clean;
    saveName(clean || 'PILOT');
  });
  dom.pilotName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dom.pilotName.blur();
      saveName(dom.pilotName.value);
      startGame();
    }
  });
}

// ----------------------------------------------------------------------------
// Sizing / quality
// ----------------------------------------------------------------------------
function resize() {
  const w = Math.max(320, window.innerWidth);
  const h = Math.max(320, window.innerHeight);
  renderer.setSize(w, h, quality.dpr);
  camera.setViewport(w, h);
  const mmDpr = Math.min(2, window.devicePixelRatio || 1);
  dom.minimap.width = Math.round(140 * mmDpr);
  dom.minimap.height = Math.round(140 * mmDpr);
  document.body.classList.toggle('portrait-touch', coarse && h > w);
}

let resizeQueued = false;
let lastW = window.innerWidth;
let lastH = window.innerHeight;
function onResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;
    lastW = w;
    lastH = h;
    resize();
  });
}

function adaptQuality(dt) {
  state.frameAvg += (dt * 1000 - state.frameAvg) * 0.06;
  state.adaptCooldown -= dt;
  if (state.adaptCooldown <= 0 && state.frameAvg > 21.5 && state.downgrades < 2 && state.mode === 'playing') {
    state.downgrades++;
    state.adaptCooldown = 6;
    quality.dpr = Math.max(1, quality.dpr * 0.8);
    world.foodTarget = Math.max(650, Math.round(world.foodTarget * 0.85));
    particles.max = Math.max(260, Math.round(particles.max * 0.75));
    resize();
  }
}

// ----------------------------------------------------------------------------
// Screens
// ----------------------------------------------------------------------------
function showScreen(name) {
  for (const key of Object.keys(dom.screens)) {
    dom.screens[key].classList.toggle('is-active', key === name);
  }
}

function enterMenu(first) {
  state.mode = 'menu';
  dom.hud.classList.remove('is-live');
  dom.hud.setAttribute('aria-hidden', 'true');
  dom.overlayTimer = 0;
  state.overlayShown = true;
  showScreen('start');
  dom.howTo.classList.remove('is-open');
  particles.clear();
  world.reset({ foodTarget: quality.food, maxBots: quality.bots, withPlayer: false });
  world.foodTarget = quality.food;
  state.menuCamTimer = 0;
  camera.reset(0, 0);
  state.bestAtStart = bestScore();
  dom.startBest.textContent = formatScore(state.bestAtStart);
  buildBoards();
  sound.boost(false);
  if (!first) sound.ui();
}

function startGame() {
  sound.init();
  const name = saveName(dom.pilotName.value);
  dom.pilotName.value = name;

  world.reset({
    playerName: name,
    foodTarget: quality.food,
    maxBots: quality.bots,
    withPlayer: true,
  });
  particles.clear();
  state.mode = 'playing';
  state.player = world.player;
  state.deadView = null;
  state.score = 0;
  state.kills = 0;
  state.foodEaten = 0;
  state.combo = 1;
  state.comboTimer = 0;
  state.runTime = 0;
  state.hitStop = 0;
  state.deathSlow = 0;
  state.edgeWarn = 0;
  state.scorePop = 0;
  state.boostOn = false;
  state.bestAtStart = bestScore();
  state.lastScoreDisplay = -1;
  state.overlayShown = false;
  state.overlayTimer = 0;
  lastLen = -1;
  lastKills = -1;

  camera.reset(state.player.x, state.player.y);
  camera.zoom = camera.baseZoom() * 1.28; // punch-in that settles as you start moving
  camera.follow(state.player, 0.016);
  camera.flashScreen(0.22, 166);
  spawnBurst(state.player.x, state.player.y, 34, { hue: 166, speed: 260, life: 0.9 });
  particles.ring(state.player.x, state.player.y, { hue: 166, size: 10, size1: 190, life: 0.7 });
  particles.text(state.player.x, state.player.y - 34, 'GO', { hue: 166, size: 30, life: 1.1, vy: -18, sat: 100, light: 78 });

  showScreen(null);
  dom.hud.classList.add('is-live');
  dom.hud.setAttribute('aria-hidden', 'false');
  dom.killFeed.innerHTML = '';
  dom.hint.textContent = coarse
    ? 'DRAG TO STEER'
    : 'STEER WITH THE MOUSE  ·  HOLD SPACE TO BOOST';
  dom.hint.classList.add('is-on');
  state.hintTimer = 6;
  state.lastScoreDisplay = -1;
  updateHUD(true);
  sound.start();
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  input.releaseAll();
  sound.boost(false);
  state.boostOn = false;
  dom.pauseScore.textContent = formatScore(state.score);
  dom.pauseLen.textContent = state.player ? Math.round(state.player.segmentsCount) : 0;
  dom.pauseTime.textContent = formatTime(state.runTime);
  showScreen('pause');
  dom.hud.classList.remove('is-live');
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  showScreen(null);
  dom.hud.classList.add('is-live');
  lastTime = performance.now();
  sound.ui();
}

function gameOver(reason) {
  state.mode = 'over';
  state.overlayTimer = 0.95;
  state.overlayShown = false;
  sound.boost(false);
  state.boostOn = false;

  const finalScore = Math.round(state.score);
  const prevBest = state.bestAtStart;
  let result = null;
  if (finalScore > 0) {
    result = saveScore({
      name: saveName(dom.pilotName.value),
      score: finalScore,
      kills: state.kills,
      length: state.player ? Math.round(state.player.segmentsCount) : 0,
      time: state.runTime,
    });
  }
  state.lastResultId = result && result.entry ? result.entry.id : null;
  buildBoards(state.lastResultId);

  dom.overScore.textContent = formatScore(finalScore);
  dom.overLen.textContent = state.player ? Math.round(state.player.segmentsCount) : 0;
  dom.overKills.textContent = state.kills;
  dom.overFood.textContent = state.foodEaten;
  dom.overTime.textContent = formatTime(state.runTime);
  dom.overReason.textContent = reason;

  const newBest = finalScore > prevBest && finalScore > 0;
  dom.recordBadge.classList.toggle('is-on', newBest);
  if (result && result.rank >= 0) {
    dom.overRank.textContent = newBest ? 'NEW PERSONAL BEST' : `RANK #${result.rank + 1} OF ${MAX_ENTRIES}`;
  } else {
    dom.overRank.textContent = '';
  }
  dom.startBest.textContent = formatScore(bestScore());
}

function revealOverScreen() {
  state.overlayShown = true;
  dom.hud.classList.remove('is-live');
  dom.hud.setAttribute('aria-hidden', 'true');
  showScreen('over');
  buildBoards(state.lastResultId || null);
}

// ----------------------------------------------------------------------------
// High-score boards
// ----------------------------------------------------------------------------
function boardMarkup(list, highlightId) {
  if (!list.length) return '<li class="board-empty">NO RUNS YET — SET THE FIRST RECORD</li>';
  return list
    .map((e, i) => {
      const rank = i + 1;
      const cls = [rank <= 3 ? 'top' : '', e.id === highlightId ? 'me' : ''].filter(Boolean).join(' ');
      return `<li class="${cls}"><span class="rk">${String(rank).padStart(2, '0')}</span>` +
        `<span class="nm">${escapeHtml(e.name)}</span>` +
        `<span class="sc">${formatScore(e.score)}</span>` +
        `<span class="ml">${e.kills} KILL${e.kills === 1 ? '' : 'S'}</span></li>`;
    })
    .join('');
}

function buildBoards(highlightId = null) {
  const list = loadScores();
  dom.startBoard.innerHTML = boardMarkup(list.slice(0, 5), highlightId);
  dom.overBoard.innerHTML = boardMarkup(list, highlightId);
  dom.startBest.textContent = formatScore(list.length ? list[0].score : 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ----------------------------------------------------------------------------
// Feedback
// ----------------------------------------------------------------------------
function spawnBurst(x, y, count, opts) {
  particles.burst(x, y, count, opts);
}

function addFeed(text, tone = '') {
  const el = document.createElement('div');
  el.className = `feed-item ${tone}`;
  el.textContent = text;
  dom.killFeed.appendChild(el);
  while (dom.killFeed.children.length > 3) dom.killFeed.removeChild(dom.killFeed.firstChild);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3100);
}

function popScore(amount = 1) {
  state.scorePop = Math.min(1.2, state.scorePop + amount);
}

// ----------------------------------------------------------------------------
// World events
// ----------------------------------------------------------------------------
world.onEat = (worm, food) => {
  if (!worm.isPlayer || state.mode !== 'playing') return;
  state.comboTimer = 1.35;
  state.combo = Math.min(5, state.combo + 0.12);
  const gain = Math.round(6 * food.value * state.combo);
  state.score += gain;
  state.foodEaten++;
  popScore(1);

  particles.burst(food.x, food.y, food.big ? 12 : 6, {
    hue: food.hue,
    speed: food.big ? 190 : 120,
    life: 0.55,
    size: food.big ? 3.4 : 2.4,
    drag: 3,
    light: 74,
  });
  if (food.big) {
    particles.ring(food.x, food.y, { hue: food.hue, size: food.r, size1: food.r * 7, life: 0.45, alpha: 0.6 });
    particles.text(food.x, food.y - 8, `+${gain}`, { hue: food.hue, size: 17, life: 0.85 });
  } else if (Math.random() < 0.55) {
    particles.text(food.x, food.y - 6, `+${gain}`, { hue: food.hue, size: 13, life: 0.7 });
  }
  camera.addTrauma(food.big ? 0.12 : 0.035);
  if (food.big) sound.bigEat(); else sound.eat(state.combo);
};

world.onKill = (killer, victim, cause) => {
  if (!killer.isPlayer || state.mode !== 'playing') return;
  const bonus = 140 + Math.round(victim.segmentsCount * 4);
  state.score += bonus;
  state.kills++;
  state.hitStop = 0.1;
  camera.addTrauma(0.58);
  camera.flashScreen(0.34, victim.hue);
  popScore(1.2);

  particles.burst(victim.x, victim.y, 46, {
    hue: victim.hue, speed: 340, life: 1, size: 4, drag: 1.8, light: 72,
  });
  particles.ring(victim.x, victim.y, { hue: victim.hue, size: 8, size1: 240, life: 0.65, alpha: 0.75 });
  particles.ring(victim.x, victim.y, { hue: 45, size: 4, size1: 130, life: 0.45, alpha: 0.5 });
  particles.text(victim.x, victim.y - 26, `KILL +${bonus}`, { hue: 48, size: 20, life: 1.15, vy: -34 });
  sound.kill();
  addFeed(`${victim.name || 'RIVAL'} DOWN  +${bonus}`, 'good');
};

world.onDeath = (victim, killer, cause) => {
  if (!victim.isPlayer) {
    if (state.mode === 'playing' || state.mode === 'over') {
      particles.burst(victim.x, victim.y, 20, {
        hue: victim.hue, speed: 180, life: 0.8, size: 3, drag: 2.4, light: 65,
      });
    }
    return;
  }

  // ---- Player death ----
  state.player = victim;
  state.deadView = { x: victim.x, y: victim.y, radius: victim.radius * 1.15, angle: victim.angle, speed: 0 };

  camera.addTrauma(1);
  camera.flashScreen(0.62, 340);
  particles.burst(victim.x, victim.y, 90, {
    hue: victim.hue, speed: 420, life: 1.3, size: 4.6, drag: 1.5, light: 70,
  });
  particles.burst(victim.x, victim.y, 30, {
    hue: 45, speed: 250, life: 0.9, size: 3, drag: 2,
  });
  particles.ring(victim.x, victim.y, { hue: 166, size: 10, size1: 420, life: 0.9, alpha: 0.9 });
  particles.ring(victim.x, victim.y, { hue: 320, size: 6, size1: 300, life: 0.75, alpha: 0.6 });
  particles.text(victim.x, victim.y - 34, 'SIGNAL LOST', { hue: 340, size: 24, life: 1.6, vy: -22 });
  sound.die();
  sound.over();
  state.hitStop = 0.16;
  state.deathSlow = 1.1;

  let reason = 'A rival worm cut you off.';
  if (cause === 'head') reason = 'Head-on collision — the bigger worm wins.';
  else if (killer && killer.name) reason = `${killer.name} cut you off.`;
  gameOver(reason);
};

// ----------------------------------------------------------------------------
// Loop
// ----------------------------------------------------------------------------
let lastTime = performance.now();

function loop(now) {
  const rawDt = Math.min(0.05, Math.max(0.0001, (now - lastTime) / 1000));
  lastTime = now;
  update(rawDt);
  render(rawDt);
  adaptQuality(rawDt);
  requestAnimationFrame(loop);
}

function update(rawDt) {
  state.time += rawDt;
  const dt = rawDt;

  if (state.mode === 'menu') {
    world.update(dt, null);
    particles.update(dt);
    updateMenuCamera(dt);
    return;
  }

  if (state.mode === 'paused') {
    return;
  }

  if (state.mode === 'playing' || state.mode === 'over') {
    let simDt = dt;
    if (state.hitStop > 0) {
      state.hitStop -= dt;
      simDt = dt * 0.22;
    }
    if (state.deathSlow > 0) {
      state.deathSlow = Math.max(0, state.deathSlow - dt);
      simDt *= 0.55;
    }

    if (state.mode === 'playing') {
      state.runTime += dt;
      const player = state.player;
      if (player && player.alive) {
        const head = camera.toScreen(player.x, player.y);
        const steer = input.steerAngle(head.x, head.y);
        world.update(simDt, { angle: steer, boost: input.boosting });
        state.player = world.player;
        if (!state.player) state.player = player;

        // Combo decay
        state.comboTimer -= dt;
        if (state.comboTimer <= 0) {
          state.combo = Math.max(1, state.combo - dt * 1.8);
        }

        // Edge warning
        const dCenter = Math.hypot(player.x, player.y);
        const warn = clamp((dCenter - world.radius * 0.85) / (world.radius * 0.12), 0, 1);
        state.edgeWarn = warn;
        if (warn > 0.45) {
          state.warnSound -= dt;
          if (state.warnSound <= 0) {
            state.warnSound = 0.55;
            sound.warn();
          }
        }

        // Boost feedback
        if (player.boosting && !state.boostOn) {
          state.boostOn = true;
          sound.boost(true);
          camera.addTrauma(0.09);
        } else if (!player.boosting && state.boostOn) {
          state.boostOn = false;
          sound.boost(false);
        }
        if (player.boosting) {
          emitBoostTrail(player, dt);
          camera.addTrauma(dt * 0.55);
        }

        camera.follow(player, dt, { lookAhead: 0.15 });
      } else {
        world.update(simDt, null);
      }

      if (state.hintTimer > 0) {
        state.hintTimer -= dt;
        if (state.hintTimer <= 0) dom.hint.classList.remove('is-on');
      }
    } else {
      // Game-over: arena keeps living behind the panel.
      world.update(simDt, null);
      const target = state.deadView;
      camera.follow(target, dt, { lookAhead: 0, dead: true });
      if (!state.overlayShown) {
        state.overlayTimer -= dt;
        if (state.overlayTimer <= 0) revealOverScreen();
      }
    }

    particles.update(simDt);
    state.edgeWarn = state.mode === 'over' ? 0 : state.edgeWarn;
    updateHUD(false, dt);
  }
}

function updateMenuCamera(dt) {
  state.menuCamTimer -= dt;
  if (state.menuCamTimer <= 0) {
    state.menuCamTimer = 9;
    const candidates = world.worms.filter((w) => w.alive);
    if (candidates.length) {
      state.menuTarget = candidates[Math.floor(Math.random() * candidates.length)];
    }
  }
  const target = state.menuTarget && state.menuTarget.alive ? state.menuTarget : null;
  if (target) {
    camera.follow(target, dt, { lookAhead: 0.4, zoomScale: 0.72 });
  } else {
    camera.follow(null, dt, { zoomScale: 0.72 });
  }
}

function emitBoostTrail(player, dt) {
  const segs = player.segments;
  if (!segs.length) return;
  const tail = segs[segs.length - 1];
  const prev = segs[Math.max(0, segs.length - 3)];
  const ang = Math.atan2(tail.y - prev.y, tail.x - prev.x) + rand(-0.4, 0.4);
  const sp = rand(60, 170);
  particles.spawn({
    kind: 0,
    x: tail.x, y: tail.y,
    vx: Math.cos(ang) * sp,
    vy: Math.sin(ang) * sp,
    life: rand(0.25, 0.55),
    size: rand(2, 4.4),
    hue: player.hue + rand(-20, 30),
    sat: 100,
    light: 78,
    drag: 2.4,
  });
  if (Math.random() < 0.35) {
    particles.spawn({
      kind: 3,
      x: tail.x + rand(-4, 4), y: tail.y + rand(-4, 4),
      vx: Math.cos(ang) * sp * 0.4,
      vy: Math.sin(ang) * sp * 0.4,
      life: rand(0.2, 0.4),
      size: rand(5, 9),
      hue: player.hue,
      sat: 100,
      light: 70,
      drag: 2,
    });
  }
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
function render(dt) {
  const player = state.mode === 'menu' ? null : state.player;
  const boosting = !!(state.mode === 'playing' && state.player && state.player.alive && state.player.boosting);
  state.boostFx = damp(state.boostFx || 0, boosting ? 1 : 0, 7, dt);
  renderer.render(world, camera, {
    time: state.time,
    particles,
    edgeWarn: state.edgeWarn,
    boostLines: state.boostFx,
    player,
  });

  if (state.mode === 'playing' || state.mode === 'over') {
    // Minimap at ~24fps is plenty.
    state.minimapTimer = (state.minimapTimer || 0) - dt;
    if (state.minimapTimer <= 0) {
      state.minimapTimer = 0.04;
      renderer.drawMinimap(dom.minimap, world, player, camera);
    }
  }
}

let hudTextTimer = 0;
let lastLen = -1;
let lastKills = -1;

function updateHUD(force, dt = 0) {
  const p = state.player;
  hudTextTimer -= dt;

  if (state.scorePop > 0) {
    state.scorePop = Math.max(0, state.scorePop - dt * 5);
    dom.hudScore.style.transform = `scale(${1 + state.scorePop * 0.1})`;
  }

  const scoreInt = Math.round(state.score);
  if (scoreInt !== state.lastScoreDisplay) {
    state.lastScoreDisplay = scoreInt;
    dom.hudScore.textContent = formatScore(scoreInt);
  }

  if (hudTextTimer > 0 && !force) return;
  hudTextTimer = 0.1;

  if (p) {
    if (p.segmentsCount !== lastLen) {
      lastLen = p.segmentsCount;
      dom.hudLen.textContent = Math.round(p.segmentsCount);
    }
    if (state.kills !== lastKills) {
      lastKills = state.kills;
      dom.hudKills.textContent = state.kills;
    }
    const boost = p.boost / 100;
    dom.hudBoost.style.transform = `scaleX(${boost})`;
    dom.boostBar.classList.toggle('is-low', boost < 0.25);

    const showCombo = state.combo > 1.15;
    dom.hudCombo.classList.toggle('is-on', showCombo);
    if (showCombo) dom.hudCombo.firstElementChild.textContent = `x${state.combo.toFixed(1)}`;
  }
}

// ----------------------------------------------------------------------------
// Sound UI
// ----------------------------------------------------------------------------
function toggleMute() {
  sound.init();
  const muted = sound.toggleMuted();
  updateSoundLabel();
  if (!muted) sound.ui();
}

function updateSoundLabel() {
  dom.btnSoundStart.textContent = sound.muted ? 'SOUND: OFF' : 'SOUND: ON';
}

// ----------------------------------------------------------------------------
// Go
// ----------------------------------------------------------------------------
boot();

// Debug handle for the curious: window.__neonworm.world, .state, .startGame() …
window.__neonworm = { world, camera, particles, state, sound, startGame, pauseGame, resumeGame };
