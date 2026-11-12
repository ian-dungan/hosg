// Floating virtual joystick: appears where the thumb lands inside the bottom-left zone.
import { h } from './dom';
import { createDoubleTap } from '../combat/doubleTap';

/** A push past this much of the way out, within FLICK_MS of the thumb landing, is a flick. */
const FLICK_AT = 0.75;
const FLICK_MS = 220;

const DEAD = 0.14;

export class Joystick {
  readonly zone: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private pid: number | null = null;
  private cx = 0;
  private cy = 0;
  private vx = 0;
  private vy = 0;
  private downAt = 0;
  private flicked = false;
  private taps = createDoubleTap();
  /** Two flicks the same way, quickly: a dodge that way (set by the HUD). */
  onFlick: ((dir: { x: number; y: number }) => void) | null = null;
  constructor(parent: HTMLElement) {
    this.zone = h('div', 'sg-joyzone sg-ctl', parent);
    this.base = h('div', 'sg-joy', this.zone);
    h('div', 'sg-joy-arrows', this.base);
    this.knob = h('div', 'sg-joy-knob', this.base);
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (this.pid !== null) return;          // a second finger in the zone is ignored
      e.preventDefault(); e.stopPropagation();
      this.pid = e.pointerId;
      this.downAt = performance.now();
      this.flicked = false;
      try { z.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const zr = z.getBoundingClientRect();
      const R = this.radius();
      // keep the whole base on screen / inside the zone
      const x = Math.max(zr.left + R + 6, Math.min(zr.right - R - 6, e.clientX));
      const y = Math.max(zr.top + R + 6, Math.min(zr.bottom - R - 6, e.clientY));
      this.cx = x; this.cy = y;
      this.base.style.left = x - zr.left + 'px';
      this.base.style.top = y - zr.top + 'px';
      this.base.style.bottom = 'auto';
      z.classList.add('active');
      this.move(e.clientX, e.clientY);
    });
    z.addEventListener('pointermove', (e) => { if (e.pointerId === this.pid) { e.preventDefault(); this.move(e.clientX, e.clientY); } });
    const end = (e: PointerEvent) => { if (e.pointerId === this.pid) this.reset(); };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => this.reset());
  }
  private radius(): number { return this.base.offsetWidth / 2 || 60; }
  private move(px: number, py: number): void {
    const R = this.radius() * 0.8;
    let dx = px - this.cx, dy = py - this.cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    this.knob.style.transform = `translate(-50%,-50%) translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
    const m = Math.min(1, d / R);
    if (m < DEAD) { this.vx = 0; this.vy = 0; return; }
    const sc = (m - DEAD) / (1 - DEAD);
    const len = Math.hypot(dx, dy) || 1;
    this.vx = Math.max(-1, Math.min(1, (dx / len) * sc));
    this.vy = Math.max(-1, Math.min(1, (-dy / len) * sc));
    const t = performance.now();
    if (!this.flicked && m >= FLICK_AT && t - this.downAt <= FLICK_MS) {
      this.flicked = true;
      // which way: one of four sectors (a flick right then right again)
      const sector = Math.abs(this.vx) > Math.abs(this.vy) ? (this.vx > 0 ? 'R' : 'L') : (this.vy > 0 ? 'U' : 'D');
      if (this.taps.down(sector, t)) this.onFlick?.({ x: this.vx, y: this.vy });
    }
  }
  reset(): void {
    this.pid = null; this.vx = 0; this.vy = 0;
    this.zone.classList.remove('active');
    this.knob.style.transform = '';
    this.base.style.left = ''; this.base.style.top = ''; this.base.style.bottom = '';
  }
  value(): { x: number; y: number } { return { x: this.vx, y: this.vy }; }
}
