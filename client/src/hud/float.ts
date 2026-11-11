// Pooled floating combat text, animated with the Web Animations API (transform + opacity only).
import type { HudApi } from '../core/contracts';
import { h } from './dom';

type Kind = Parameters<HudApi['floatText']>[3];
const POOL = 40;

export class FloatText {
  readonly el: HTMLElement;
  private pool: HTMLElement[] = [];
  private next = 0;
  private vignette: HTMLElement;
  constructor(parent: HTMLElement) {
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
      default:
        frames = [{ transform: at(jx, 0, 1.5), opacity: 0 }, { transform: at(jx, -12, 1), opacity: 1, offset: 0.15 }, { transform: at(jx, -52, 0.9), opacity: 0 }];
        dur = 900;
    }
    el.animate(frames, { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
  }
}
