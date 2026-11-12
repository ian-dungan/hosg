// Pooled floating combat text, animated with the Web Animations API (transform + opacity only).
import type { HudApi } from '../core/contracts';
import { h } from './dom';

type Kind = Parameters<HudApi['floatText']>[3];
const POOL = 40;
/** How far to the side of the point a damage number starts, in px. */
const SIDE_PX = 38;
/** How far each kind of number rises over its life, in px (it starts at least this far below the top HUD). */
const RISE: Partial<Record<Kind, number>> = { crit: 70, combo: 56, heal: 64, info: 36, hurt: 0 };
const RISE_DAMAGE = 46;

export class FloatText {
  readonly el: HTMLElement;
  private pool: HTMLElement[] = [];
  private next = 0;
  /** The side the last damage number went (1 right, -1 left). */
  private side = 1;
  private vignette: HTMLElement;
  /** `keepOut`: the top HUD's panels (frames): a number under one starts below it, so it never covers them. */
  constructor(parent: HTMLElement, private keepOut: () => readonly HTMLElement[] = () => []) {
    this.el = h('div', 'sg-floats', parent);
    for (let i = 0; i < POOL; i++) this.pool.push(h('div', 'sg-ft', this.el));
    this.vignette = h('div', 'sg-vignette', parent);
  }
  spawn(x: number, y: number, text: string, kind: Kind): void {
    const el = this.pool[this.next];
    this.next = (this.next + 1) % POOL;
    el.getAnimations().forEach((a) => a.cancel());
    el.className = 'sg-ft ' + kind;
    el.textContent = text;
    y = this.belowPanels(x, y, (RISE[kind] ?? RISE_DAMAGE) + 14);
    const jx = (Math.random() - 0.5) * 36;
    const at = (dx: number, dy: number, s: number) => `translate(${(x + dx).toFixed(1)}px,${(y + dy).toFixed(1)}px) translate(-50%,-50%) scale(${s})`;
    let frames: Keyframe[]; let dur = 1000;
    switch (kind) {
      case 'crit':
        frames = [{ transform: at(jx, 0, 2.3), opacity: 0 }, { transform: at(jx, -10, 0.9), opacity: 1, offset: 0.12 },
          { transform: at(jx, -14, 1.1), offset: 0.22 }, { transform: at(jx, -48, 1), opacity: 1, offset: 0.75 }, { transform: at(jx, -70, 0.95), opacity: 0 }];
        dur = 1200; break;
      case 'combo':
        frames = [{ transform: at(0, -10, 2.8), opacity: 0 }, { transform: at(0, -20, 0.92), opacity: 1, offset: 0.12 },
          { transform: at(0, -22, 1.06), offset: 0.2 }, { transform: at(0, -30, 1), opacity: 1, offset: 0.8 }, { transform: at(0, -56, 1.1), opacity: 0 }];
        dur = 1700;
        this.vignette.animate([{ opacity: 0 }, { opacity: 0.8 }, { opacity: 0 }], { duration: 700 });
        break;
      case 'heal':
        frames = [{ transform: at(jx, 0, 0.6), opacity: 0 }, { transform: at(jx, -14, 1.05), opacity: 1, offset: 0.2 }, { transform: at(jx, -64, 1), opacity: 0 }];
        dur = 1200; break;
      case 'hurt':
        frames = [{ transform: at(jx, 0, 1.5), opacity: 0 }, { transform: at(jx, 6, 1), opacity: 1, offset: 0.15 }, { transform: at(jx + 12, 40, 0.9), opacity: 0 }];
        dur = 1000; break;
      case 'info':
        frames = [{ transform: at(0, 0, 0.9), opacity: 0 }, { transform: at(0, -8, 1), opacity: 1, offset: 0.2 }, { transform: at(0, -36, 1), opacity: 0 }];
        dur = 1400; break;
      default: {
        // damage on an enemy: out to one side (alternating) and up, clear of its name and bar above it
        const side = (this.side = -this.side) * (SIDE_PX + Math.random() * 14);
        frames = [{ transform: at(side * 0.5, 0, 1.4), opacity: 0 }, { transform: at(side, -10, 1), opacity: 1, offset: 0.15 },
          { transform: at(side * 1.35, -46, 0.9), opacity: 0 }];
        dur = 950;
      }
    }
    el.animate(frames, { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
  }
  /** `y`, moved down so a number rising `rise` px from (x, y) stays clear of the panels it would cross. */
  private belowPanels(x: number, y: number, rise: number): number {
    const panels = this.keepOut();
    if (panels.length === 0) return y;
    const base = this.el.getBoundingClientRect();
    for (const p of panels) {
      const r = p.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // hidden
      if (x < r.left - base.left - SIDE_PX * 2 || x > r.right - base.left + SIDE_PX * 2) continue;
      y = Math.max(y, r.bottom - base.top + rise);
    }
    return y;
  }
}
