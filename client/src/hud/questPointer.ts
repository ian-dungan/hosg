// The quest pointer (Plan 6): a gold arrow chip at the screen's edge toward the tracked objective when it is off
// screen (a 48 px tap target: a tap walks there, with Tap to walk on), and a small "◆" over it when it is on
// screen. Like the party's edge markers (combat/edgeMarkers.ts, whose method this follows) it keeps out of the
// joystick zone, the ability cluster and the frames. pointerLayout is the pure, tested part; QuestPointer is one
// reused element (nothing allocated per frame). Hidden while a dialogue or a sheet is open, and in cutscenes.
import { h, toggle } from './dom';

export interface PointerRect { x0: number; y0: number; x1: number; y1: number }
/** The chip's tap target (px) and its gap from the screen's edge. */
export const POINTER_SIZE = 48;
const MARGIN = POINTER_SIZE / 2 + 8;
const inRect = (r: PointerRect, x: number, y: number, pad: number) => x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad;

/**
 * Where the pointer goes for a target projected at (px, py) (`front` false: behind the camera) on a w × h
 * viewport: on screen (inside the margin) it sits on the target; else on the inset edge along the line from the
 * centre toward it, slid out of the exclusions. Written into `out`.
 */
export function pointerLayout(px: number, py: number, front: boolean, w: number, hgt: number, exclusions: readonly PointerRect[],
  out: { x: number; y: number; angle: number; onScreen: boolean } = { x: 0, y: 0, angle: 0, onScreen: false }) {
  const cx = w / 2, cy = hgt / 2, x0 = MARGIN, y0 = MARGIN, x1 = w - MARGIN, y1 = hgt - MARGIN;
  if (front && px >= x0 && px <= x1 && py >= y0 && py <= y1) { out.x = px; out.y = py; out.angle = -Math.PI / 2; out.onScreen = true; return out; }
  let dx = px - cx, dy = py - cy;
  if (!front) { dx = -dx; dy = -dy; }
  if (dx === 0 && dy === 0) dy = 1;
  const sx = dx !== 0 ? (dx > 0 ? x1 - cx : x0 - cx) / dx : Infinity;
  const sy = dy !== 0 ? (dy > 0 ? y1 - cy : y0 - cy) / dy : Infinity;
  const s = Math.min(sx, sy);
  let x = cx + dx * s, y = cy + dy * s;
  const onSide = sx < sy;
  for (let pass = 0; pass < 4; pass++) {
    let r: PointerRect | null = null;
    for (let k = 0; k < exclusions.length && !r; k++) if (inRect(exclusions[k]!, x, y, POINTER_SIZE / 2)) r = exclusions[k]!;
    if (!r) break;
    if (onSide) {
      const up = r.y0 - POINTER_SIZE / 2 - 1, down = r.y1 + POINTER_SIZE / 2 + 1;
      const upOk = up >= y0, downOk = down <= y1;
      y = upOk && (!downOk || Math.abs(up - y) <= Math.abs(down - y)) ? up : downOk ? down : Math.max(y0, Math.min(y1, y));
    } else {
      const left = r.x0 - POINTER_SIZE / 2 - 1, right = r.x1 + POINTER_SIZE / 2 + 1;
      const lOk = left >= x0, rOk = right <= x1;
      x = lOk && (!rOk || Math.abs(left - x) <= Math.abs(right - x)) ? left : rOk ? right : Math.max(x0, Math.min(x1, x));
    }
  }
  out.x = x; out.y = y; out.angle = Math.atan2(dy, dx); out.onScreen = false;
  return out;
}

/**
 * Which way the chip's label runs from a chip at (x, y) on a w × h screen, so the whole line stays on screen: to the
 * left of a chip in the right third, to the right of one in the left third, else centred under it; above it in the
 * bottom third.
 */
export function pointerLabelSide(x: number, y: number, w: number, hgt: number): { left: boolean; right: boolean; up: boolean } {
  return { left: x > w * 0.66, right: x < w * 0.34, up: y > hgt * 0.66 };
}

export class QuestPointer {
  readonly el: HTMLElement;
  private label: HTMLElement;
  private shown = false;
  private on = false;
  private text = '';
  private lx = NaN; private ly = NaN; private la = NaN;
  constructor(parent: HTMLElement, onTap: () => void) {
    this.el = h('div', 'sg-qp sg-ctl', parent);
    this.el.setAttribute('role', 'button');
    this.el.setAttribute('aria-label', 'Walk toward the quest');
    h('i', 'sg-qp-arrow', this.el);
    h('b', 'sg-qp-gem', this.el, '◆');
    this.label = h('span', 'sg-qp-label', this.el);
    this.el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (!this.on) onTap(); });
  }
  /** Places the pointer (null hides it); touches the DOM only when something changed. */
  update(p: { x: number; y: number; label: string; onScreen: boolean; angle: number } | null): void {
    const show = !!p;
    if (show !== this.shown) { this.shown = show; toggle(this.el, 'on', show); }
    if (!p) return;
    if (p.onScreen !== this.on) { this.on = p.onScreen; toggle(this.el, 'over', p.onScreen); }
    if (p.label !== this.text) { this.text = p.label; this.label.textContent = p.label; }
    if (Math.abs(p.x - this.lx) > 0.5 || Math.abs(p.y - this.ly) > 0.5) {
      this.lx = p.x; this.ly = p.y;
      this.el.style.transform = `translate(${(p.x - POINTER_SIZE / 2).toFixed(1)}px,${(p.y - POINTER_SIZE / 2).toFixed(1)}px)`;
    }
    if (Math.abs(p.angle - this.la) > 0.01) { this.la = p.angle; this.el.style.setProperty('--a', `${p.angle.toFixed(3)}rad`); }
    // the label sits on the side away from the edge
    const side = pointerLabelSide(p.x, p.y, window.innerWidth, window.innerHeight);
    toggle(this.el, 'lab-left', side.left);
    toggle(this.el, 'lab-right', side.right);
    toggle(this.el, 'lab-up', side.up);
  }
}

export const POINTER_CSS = /* css */ `
.sg-qp{position:absolute;left:0;top:0;width:${POINTER_SIZE}px;height:${POINTER_SIZE}px;display:none;z-index:4}
.sg-qp.on{display:block}
.sg-modal-open .sg-qp,.sg-hidden .sg-qp{display:none}
.sg-qp-arrow{position:absolute;inset:7px;transform:rotate(var(--a,0rad))}
.sg-qp-arrow::before{content:"";position:absolute;inset:0;border-radius:50% 50% 50% 0;transform:rotate(-135deg);
  background:radial-gradient(circle at 60% 40%,#ffe9a8,#F2B742 65%,#d99a24);box-shadow:0 0 0 2px rgba(255,250,240,.95),0 0 14px rgba(242,183,66,.7),0 2px 6px rgba(0,0,0,.4)}
.sg-qp-gem{position:absolute;inset:0;display:grid;place-items:center;font:800 15px/1 var(--sans);color:#3a2508;text-shadow:none;pointer-events:none}
.sg-qp-label{position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:-2px;padding:2px 8px;border-radius:9px;white-space:nowrap;
  font:600 14px/1.25 var(--sans);color:var(--cream);background:rgba(16,18,42,.62);pointer-events:none}
.sg-qp.lab-up .sg-qp-label{top:auto;bottom:100%;margin:0 0 -2px}
.sg-qp.lab-left .sg-qp-label{left:auto;right:50%;transform:none}
.sg-qp.lab-right .sg-qp-label{left:8px;transform:none}
.sg-qp:not(.lab-left):not(.lab-right) .sg-qp-label{transform:translateX(-50%)}
.sg-qp-label{max-width:calc(100vw - 40px);overflow:hidden;text-overflow:ellipsis}
.sg-qp.over{pointer-events:none}
.sg-qp.over .sg-qp-arrow,.sg-qp.over .sg-qp-label{display:none}
.sg-qp.over .sg-qp-gem{font-size:24px;color:var(--gold2);text-shadow:0 0 10px rgba(242,183,66,.9),0 2px 3px rgba(40,20,0,.6);animation:sg-qp-bob 1.6s ease-in-out infinite}
@keyframes sg-qp-bob{50%{transform:translateY(-6px)}}
.sg-in-combat .sg-qp{opacity:.6}
`;
