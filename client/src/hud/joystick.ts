// Floating virtual joystick: appears where the thumb lands inside the bottom-left zone.
import { h } from './dom';

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
    const k = (m - DEAD) / (1 - DEAD) / (d || 1) * R;
    this.vx = Math.max(-1, Math.min(1, (dx / R) * k));
    this.vy = Math.max(-1, Math.min(1, (-dy / R) * k));
  }
  reset(): void {
    this.pid = null; this.vx = 0; this.vy = 0;
    this.zone.classList.remove('active');
    this.knob.style.transform = '';
    this.base.style.left = ''; this.base.style.top = ''; this.base.style.bottom = '';
  }
  value(): { x: number; y: number } { return { x: this.vx, y: this.vy }; }
}
