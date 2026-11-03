import { TAU, clamp, rand, angleDelta, dist } from './utils.js';

/**
 * Lightweight rival brains: forage, dodge bodies, ambush smaller worms.
 * They are deliberately not perfect — they make mistakes you can exploit.
 */
export function thinkBot(bot, world, dt) {
  bot.thinkTimer -= dt;

  // Always recompute avoidance instantly (cheap, few candidates).
  const r = bot.radius;
  const ahead = 62 + bot.speed * 0.22;
  const lookX = bot.x + Math.cos(bot.angle) * ahead;
  const lookY = bot.y + Math.sin(bot.angle) * ahead;

  let dangerX = 0;
  let dangerY = 0;
  let dangerW = 0;

  const near = world.querySegments(bot.x, bot.y, 150);
  for (let i = 0; i < near.length; i++) {
    const s = near[i];
    if (s.w === bot) continue;
    const d = dist(bot.x, bot.y, s.x, s.y);
    const reach = r + s.r + 26;
    if (d < reach) {
      const w = 1 - d / reach;
      dangerX += (bot.x - s.x) / (d || 1) * w;
      dangerY += (bot.y - s.y) / (d || 1) * w;
      dangerW += w;
    }
    // Look before you leap: avoid bodies directly in the path.
    const ad = dist(lookX, lookY, s.x, s.y);
    if (ad < r + s.r + 34) {
      const w = 1 - ad / (r + s.r + 34);
      dangerX += (lookX - s.x) / (ad || 1) * w * 1.6;
      dangerY += (lookY - s.y) / (ad || 1) * w * 1.6;
      dangerW += w * 1.6;
    }
  }

  if (bot.thinkTimer > 0) {
    // Keep the previous plan but blend in emergency avoidance immediately.
    if (dangerW > 0.2) {
      const avoid = Math.atan2(dangerY, dangerX);
      const blend = clamp(dangerW, 0, 0.9);
      bot.targetAngle = bot.angle + angleDelta(bot.angle, avoid) * blend;
      bot.wantBoost = dangerW > 1.15 && bot.boost > 30;
    }
    return;
  }
  bot.thinkTimer = rand(0.09, 0.2);

  // ---- Boundary ----
  const dCenter = Math.hypot(bot.x, bot.y);
  if (dCenter > world.radius * 0.82) {
    const inward = Math.atan2(-bot.y, -bot.x);
    bot.targetAngle = inward + rand(-0.25, 0.25);
    bot.wantBoost = false;
    return;
  }

  // ---- Emergency avoidance ----
  if (dangerW > 0.18) {
    const avoid = Math.atan2(dangerY, dangerX);
    bot.targetAngle = avoid + rand(-0.3, 0.3);
    bot.wantBoost = dangerW > 1.2 && bot.boost > 25;
    return;
  }

  // ---- Ambush a smaller worm ----
  const player = world.player;
  let prey = null;
  let preyScore = -1;
  if (player && player.alive && !player.invuln && world.time > 4.5) {
    const d = dist(bot.x, bot.y, player.x, player.y);
    if (d < 760 && player.segmentsCount > 34 && player.segmentsCount < bot.segmentsCount * 1.05) {
      const s = (1 - d / 760) * bot.aggression * 1.5;
      if (s > preyScore) { preyScore = s; prey = player; }
    }
  }
  for (let i = 0; i < world.worms.length; i++) {
    const w = world.worms[i];
    if (w === bot || !w.alive || w.invuln > 0) continue;
    if (w.segmentsCount > bot.segmentsCount * 1.05) continue;
    const d = dist(bot.x, bot.y, w.x, w.y);
    if (d > 620) continue;
    const s = (1 - d / 620) * 0.55 * bot.aggression;
    if (s > preyScore) { preyScore = s; prey = w; }
  }

  if (prey && Math.random() < 0.14 + bot.aggression * 0.34) {
    const lead = clamp(dist(bot.x, bot.y, prey.x, prey.y) / 4, 40, 170);
    const tx = prey.x + Math.cos(prey.angle) * lead;
    const ty = prey.y + Math.sin(prey.angle) * lead;
    bot.targetAngle = Math.atan2(ty - bot.y, tx - bot.x);
    bot.wantBoost = dist(bot.x, bot.y, prey.x, prey.y) > 220 && bot.boost > 20;
    bot.hunting = true;
    return;
  }
  bot.hunting = false;

  // ---- Forage ----
  const foods = world.queryFood(bot.x, bot.y, 360);
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < foods.length; i++) {
    const f = foods[i];
    if (!f.alive) continue;
    const d = dist(bot.x, bot.y, f.x, f.y);
    const score = f.value / (d + 40) + rand(0, 0.004);
    if (score > bestScore) { bestScore = score; best = f; }
  }

  if (best) {
    // Aim slightly ahead of the orb so the turn feels natural.
    bot.targetAngle = Math.atan2(best.y - bot.y, best.x - bot.x);
    bot.wantBoost = false;
  } else {
    // Wander with a slow lissajous drift, pulled gently toward the centre.
    bot.wander = (bot.wander || rand(0, TAU)) + dt * rand(0.7, 1.6);
    const drift = Math.sin(bot.time * 0.8 + bot.wobble) * 0.9;
    bot.targetAngle = bot.angle + drift * 0.5 + Math.sin(bot.wander) * 0.5;
    bot.wantBoost = false;
  }
}
