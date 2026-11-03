/**
 * Sound — all effects are synthesised with WebAudio, so the game ships with
 * zero audio assets and starts instantly. Every call is cheap and guarded.
 */
const STORE_KEY = 'neonworm.muted.v1';

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(STORE_KEY) === '1'; } catch (_) { /* ignore */ }
    this._lastEat = 0;
    this._boostGain = null;
    this._boostFilter = null;
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (_) {
      return;
    }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    // Shared noise buffer for whooshes and impacts.
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    // Continuous boost rumble, gated by gain.
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 620;
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this._boostGain = gain;
    this._boostFilter = filter;
  }

  setMuted(muted) {
    this.muted = muted;
    try { localStorage.setItem(STORE_KEY, muted ? '1' : '0'); } catch (_) { /* ignore */ }
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, t, 0.05);
    }
    document.body.classList.toggle('muted', muted);
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _tone({ freq = 440, freq2 = null, type = 'sine', dur = 0.15, gain = 0.15, attack = 0.006, delay = 0 }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gEnv = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freq2 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
    gEnv.gain.setValueAtTime(0.0001, t0);
    gEnv.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    gEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gEnv).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise({ dur = 0.3, gain = 0.2, type = 'lowpass', from = 1800, to = 200, delay = 0, q = 1 }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
    const gEnv = ctx.createGain();
    gEnv.gain.setValueAtTime(0.0001, t0);
    gEnv.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    gEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gEnv).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  eat(combo = 1) {
    const now = performance.now();
    if (now - this._lastEat < 38) return;
    this._lastEat = now;
    const base = 420 + Math.min(combo, 6) * 70 + Math.random() * 60;
    this._tone({ freq: base, freq2: base * 1.9, type: 'triangle', dur: 0.09, gain: 0.075 });
  }

  bigEat() {
    this._tone({ freq: 320, freq2: 900, type: 'sine', dur: 0.22, gain: 0.13 });
    this._tone({ freq: 640, freq2: 1500, type: 'triangle', dur: 0.18, gain: 0.06, delay: 0.04 });
  }

  kill() {
    this._tone({ freq: 880, freq2: 1320, type: 'triangle', dur: 0.16, gain: 0.14 });
    this._tone({ freq: 1320, freq2: 1760, type: 'sine', dur: 0.22, gain: 0.1, delay: 0.09 });
    this._noise({ dur: 0.3, gain: 0.13, from: 2600, to: 500, delay: 0.02 });
  }

  die() {
    this._noise({ dur: 0.65, gain: 0.26, from: 2600, to: 90 });
    this._tone({ freq: 220, freq2: 42, type: 'sawtooth', dur: 0.8, gain: 0.16 });
    this._tone({ freq: 110, freq2: 30, type: 'sine', dur: 1.0, gain: 0.18, delay: 0.05 });
  }

  boost(on) {
    if (!this.ready || !this._boostGain) return;
    const t = this.ctx.currentTime;
    this._boostGain.gain.cancelScheduledValues(t);
    this._boostGain.gain.setTargetAtTime(on && !this.muted ? 0.055 : 0, t, 0.08);
    if (this._boostFilter && on) {
      this._boostFilter.frequency.setTargetAtTime(700 + Math.random() * 300, t, 0.2);
    }
  }

  start() {
    this._tone({ freq: 220, freq2: 660, type: 'triangle', dur: 0.2, gain: 0.1 });
    this._tone({ freq: 660, freq2: 990, type: 'sine', dur: 0.26, gain: 0.08, delay: 0.09 });
  }

  over() {
    this._tone({ freq: 440, freq2: 220, type: 'triangle', dur: 0.5, gain: 0.1, delay: 0.1 });
  }

  ui() {
    this._tone({ freq: 700, freq2: 980, type: 'sine', dur: 0.06, gain: 0.05 });
  }

  warn() {
    this._tone({ freq: 200, freq2: 150, type: 'square', dur: 0.12, gain: 0.05 });
  }
}
