/**
 * Input — unified steering for mouse, keyboard and touch.
 *
 * Steering is expressed as a desired absolute heading. Mouse aims at the
 * cursor relative to the player's head; keyboard snaps to the pressed
 * direction; touch uses a relative drag stick anchored where the thumb lands.
 */
import { clamp } from './utils.js';

const KEY_DIRS = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pointer = { x: 0, y: 0, active: false, id: null };
    this.mode = 'pointer';
    this.stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0, mag: 0 };
    this.boostKeys = false;
    this.boostPointer = false;
    this.boostPad = false;
    this.clickBoost = false;
    this.onPause = null;
    this.onKey = null;
    this.hasTouch = false;
    this._lastKeyAngle = null;

    this._bind();
  }

  _bind() {
    const { canvas } = this;

    window.addEventListener('keydown', (e) => {
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
      if (typing) {
        if (e.code === 'Escape' && el.blur) el.blur();
        return;
      }
      if (e.repeat) {
        if (KEY_DIRS[e.code] || e.code === 'Space') e.preventDefault();
        return;
      }
      if (KEY_DIRS[e.code]) {
        this.keys.add(e.code);
        this.mode = 'keys';
        this._lastKeyAngle = null;
        e.preventDefault();
      } else if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.boostKeys = true;
        e.preventDefault();
      }
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.onPause) this.onPause();
      }
      if (this.onKey) this.onKey(e.code, e);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.boostKeys = false;
      }
    });

    window.addEventListener('blur', () => this.releaseAll());

    // ---- Mouse / pen ----
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.active = true;
      this.mode = 'pointer';
    }, { passive: true });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.active = true;
      this.mode = 'pointer';
      this.boostPointer = true;
      this.clickBoost = true;
    });

    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      this.boostPointer = false;
    });
    window.addEventListener('pointercancel', () => { this.boostPointer = false; });

    // ---- Touch ----
    canvas.addEventListener('touchstart', (e) => this._touchStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this._touchMove(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this._touchEnd(e), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this._touchEnd(e), { passive: false });

    // Boost pad
    const pad = document.getElementById('btnBoost');
    if (pad) {
      const on = (e) => {
        e.preventDefault();
        this.boostPad = true;
        pad.classList.add('is-held');
      };
      const off = (e) => {
        if (e) e.preventDefault();
        this.boostPad = false;
        pad.classList.remove('is-held');
      };
      pad.addEventListener('pointerdown', on);
      pad.addEventListener('pointerup', off);
      pad.addEventListener('pointercancel', off);
      pad.addEventListener('pointerleave', off);
    }
  }

  _touchStart(e) {
    e.preventDefault();
    this.hasTouch = true;
    for (const t of e.changedTouches) {
      if (!this.stick.active) {
        this.stick.active = true;
        this.stick.id = t.identifier;
        this.stick.ox = t.clientX;
        this.stick.oy = t.clientY;
        this.stick.dx = 0;
        this.stick.dy = 0;
        this.stick.mag = 0;
        this.mode = 'touch';
      } else {
        // A second finger anywhere on the arena means "boost".
        this.boostPad = true;
      }
    }
  }

  _touchMove(e) {
    if (!this.stick.active) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== this.stick.id) continue;
      const dx = t.clientX - this.stick.ox;
      const dy = t.clientY - this.stick.oy;
      const mag = Math.hypot(dx, dy);
      const dead = 7;
      if (mag > dead) {
        const maxR = 62;
        const scaled = Math.min(mag, maxR);
        this.stick.dx = (dx / mag) * scaled;
        this.stick.dy = (dy / mag) * scaled;
        this.stick.mag = (scaled - dead) / (maxR - dead);
      } else {
        this.stick.mag = 0;
      }
    }
  }

  _touchEnd(e) {
    let others = 0;
    for (const t of e.changedTouches) {
      if (t.identifier === this.stick.id) {
        this.stick.active = false;
        this.stick.id = null;
        this.stick.mag = 0;
        this.stick.dx = 0;
        this.stick.dy = 0;
      }
    }
    if (typeof e.touches !== 'undefined') others = e.touches.length;
    if (others === 0) this.boostPad = false;
  }

  releaseAll() {
    this.keys.clear();
    this.boostKeys = false;
    this.boostPointer = false;
    this.boostPad = false;
    this.stick.active = false;
    this.stick.mag = 0;
  }

  get boosting() {
    return this.boostKeys || this.boostPointer || this.boostPad;
  }

  keyVector() {
    let x = 0, y = 0;
    for (const code of this.keys) {
      const d = KEY_DIRS[code];
      if (d) { x += d[0]; y += d[1]; }
    }
    if (x === 0 && y === 0) return null;
    const m = Math.hypot(x, y);
    return { x: x / m, y: y / m };
  }

  /**
   * Desired heading in radians, or null to keep current heading.
   * @param {number} headX screen-space x of the player's head
   * @param {number} headY screen-space y of the player's head
   */
  steerAngle(headX, headY) {
    if (this.stick.active && this.stick.mag > 0.001) {
      return Math.atan2(this.stick.dy, this.stick.dx);
    }
    const kv = this.keyVector();
    if (kv) {
      this.mode = 'keys';
      this._lastKeyAngle = Math.atan2(kv.y, kv.x);
      return this._lastKeyAngle;
    }
    if (this.mode === 'pointer' && this.pointer.active) {
      const dx = this.pointer.x - headX;
      const dy = this.pointer.y - headY;
      if (dx * dx + dy * dy > 100) return Math.atan2(dy, dx);
    }
    return null;
  }

  stickStrength() {
    return clamp(this.stick.mag, 0, 1);
  }
}
