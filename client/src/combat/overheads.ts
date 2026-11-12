// Bars over enemies' heads: name and health while engaged, targeted or hurt in the last 5 s (always for elites,
// which also get a stagger bar, greyed while it cannot fill), the marks on them as icons, and a chevron while
// they surge. DOM, projected each frame; elements are kept per enemy and hidden when not needed.
import { Matrix, Vector3, type Scene } from '@babylonjs/core';
import { ENEMY_KINDS, MARK_BITS, type EnemyKindId, type MarkId } from '@sg2/shared';
import type { Enemies } from '../net/enemies';
import type { ZoneRoom } from '../net/session';

/** Shown this long after the enemy last lost health, in ms. */
const HURT_SHOW_MS = 5000;
const LIFT = 0.55;

const CSS = /* css */ `
.sg-oh-layer{z-index:0}
.sg-oh{position:absolute;left:0;top:0;display:none;flex-direction:column;align-items:center;gap:2px;will-change:transform;pointer-events:none}
.sg-oh.on{display:flex}
.sg-oh-name{font:700 12px/1.1 var(--sans);color:#fff2e6;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 4px rgba(0,0,0,.5)}
.sg-oh.tgt .sg-oh-name{display:none} /* the target frame names it already */
.sg-oh-row{display:flex;align-items:center;gap:3px}
.sg-oh-hp,.sg-oh-st{position:relative;width:64px;height:7px;border-radius:4px;overflow:hidden;background:rgba(14,12,30,.7);box-shadow:0 0 0 1px rgba(0,0,0,.45)}
.sg-oh.elite .sg-oh-hp{width:96px;height:9px}
.sg-oh-hp i,.sg-oh-st i{position:absolute;inset:0;transform-origin:0 50%;background:linear-gradient(180deg,#ff8a6a,#d8442c)}
.sg-oh-st{height:4px;width:96px;display:none}
.sg-oh.elite .sg-oh-st{display:block}
.sg-oh-st i{background:repeating-linear-gradient(-45deg,#F2B742 0 5px,#ffd877 5px 10px)}
.sg-oh-st.immune i{background:#8a8796}
.sg-oh-st.immune{box-shadow:0 0 0 1px rgba(190,190,210,.6)}
.sg-oh-marks{display:flex;gap:2px}
.sg-oh-marks b{display:grid;place-items:center;width:15px;height:15px;border-radius:50%;font:800 10px/1 var(--sans);color:#1a1020;text-shadow:none}
.sg-oh-surge{display:none;font:900 12px/1 var(--sans);color:#7ff0ff;text-shadow:0 0 6px rgba(80,220,255,.9),0 1px 2px #000;letter-spacing:-2px}
.sg-oh.surge .sg-oh-surge{display:block;animation:sg-oh-surge .35s linear infinite}
@keyframes sg-oh-surge{50%{transform:translateX(3px);opacity:.6}}
`;

const MARK_ICON: Record<MarkId, { g: string; c: string }> = {
  marked: { g: '◎', c: '#F2B742' }, burning: { g: '✷', c: '#ff8a4c' }, soaked: { g: '≈', c: '#5fd0c4' },
};

interface El { root: HTMLElement; name: HTMLElement; hp: HTMLElement; st: HTMLElement; stFill: HTMLElement; marks: HTMLElement; k: { hp: number; st: number; marks: number; immune: boolean; on: boolean; tgt: boolean; surge: boolean } }

export interface Overheads {
  update(o: { target: number | null; hurtAt: ReadonlyMap<number, number>; now: number; me: number }): void;
  dispose(): void;
}

export function createOverheads(scene: Scene, room: ZoneRoom, enemies: Enemies): Overheads {
  if (!document.getElementById('sg-oh-css')) {
    const s = document.createElement('style'); s.id = 'sg-oh-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  const layer = document.createElement('div');
  layer.className = 'sg-hud sg-oh-layer';
  (document.getElementById('hud') ?? document.body).prepend(layer);
  const els = new Map<number, El>();
  const at = new Vector3(), screen = new Vector3();

  const make = (kind: EnemyKindId): El => {
    const root = document.createElement('div'); root.className = 'sg-oh';
    const name = document.createElement('div'); name.className = 'sg-oh-name'; name.textContent = ENEMY_KINDS[kind].name;
    const row = document.createElement('div'); row.className = 'sg-oh-row';
    const surge = document.createElement('div'); surge.className = 'sg-oh-surge'; surge.textContent = '»»';
    const hp = document.createElement('div'); hp.className = 'sg-oh-hp'; const hpFill = document.createElement('i'); hp.appendChild(hpFill);
    const marks = document.createElement('div'); marks.className = 'sg-oh-marks';
    row.append(surge, hp, marks);
    const st = document.createElement('div'); st.className = 'sg-oh-st'; const stFill = document.createElement('i'); st.appendChild(stFill);
    root.append(name, row, st);
    if (ENEMY_KINDS[kind].elite) root.classList.add('elite');
    layer.appendChild(root);
    return { root, name, hp: hpFill, st, stFill, marks, k: { hp: -1, st: -1, marks: -1, immune: false, on: false, tgt: false, surge: false } };
  };

  const seen = new Set<number>();
  return {
    update({ target, hurtAt, now, me }) {
      const camera = scene.activeCamera;
      const canvas = scene.getEngine().getRenderingCanvas();
      const w = canvas?.clientWidth ?? innerWidth, h = canvas?.clientHeight ?? innerHeight;
      const viewport = camera?.viewport.toGlobal(w, h);
      const transform = scene.getTransformMatrix();
      seen.clear();
      enemies.forEach((eid, d) => {
        const e = room.state.enemies?.get(String(eid));
        if (!e) return;
        seen.add(eid);
        let el = els.get(eid);
        if (!el) { el = make(d.kind); els.set(eid, el); }
        const k = el.k;
        const elite = ENEMY_KINDS[d.kind].elite;
        const engaged = (e.target ?? -1) >= 0 && (e.mode === 'fight' || e.mode === 'windup' || e.mode === 'stunned');
        const show = e.mode !== 'dead' && (elite || target === eid || engaged || now - (hurtAt.get(eid) ?? -Infinity) < HURT_SHOW_MS || (e.target ?? -1) === me);
        let on = false;
        if (show && viewport) {
          at.set(d.x, d.y + d.view.height + LIFT, d.z);
          Vector3.ProjectToRef(at, Matrix.IdentityReadOnly, transform, viewport, screen);
          on = screen.z > 0 && screen.z < 1 && screen.x > -80 && screen.x < w + 80 && screen.y > -40 && screen.y < h + 40;
          if (on) el.root.style.transform = `translate(${screen.x.toFixed(1)}px,${screen.y.toFixed(1)}px) translate(-50%,-100%)`;
        }
        if (on !== k.on) { k.on = on; el.root.classList.toggle('on', on); }
        if (!on) return;
        const tgt = target === eid;
        if (tgt !== k.tgt) { k.tgt = tgt; el.root.classList.toggle('tgt', tgt); }
        const f = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0;
        if (Math.abs(f - k.hp) > 0.002) { k.hp = f; el.hp.style.transform = `scaleX(${f.toFixed(3)})`; }
        if (elite) {
          const sf = (e.maxStagger ?? 0) > 0 ? Math.max(0, Math.min(1, (e.stagger ?? 0) / e.maxStagger!)) : 0;
          if (Math.abs(sf - k.st) > 0.002) { k.st = sf; el.stFill.style.transform = `scaleX(${sf.toFixed(3)})`; }
          const immune = (e.staggerImmune ?? 0) > 0;
          if (immune !== k.immune) { k.immune = immune; el.st.classList.toggle('immune', immune); }
        }
        const surge = !!e.surging;
        if (surge !== k.surge) { k.surge = surge; el.root.classList.toggle('surge', surge); }
        const bits = e.marks ?? 0;
        if (bits !== k.marks) {
          k.marks = bits;
          el.marks.textContent = '';
          for (const m of ['marked', 'burning', 'soaked'] as MarkId[]) {
            if (!(bits & MARK_BITS[m])) continue;
            const b = document.createElement('b'); b.textContent = MARK_ICON[m].g; b.style.background = MARK_ICON[m].c; b.title = m;
            el.marks.appendChild(b);
          }
        }
      });
      for (const [eid, el] of els) if (!seen.has(eid)) { el.root.remove(); els.delete(eid); }
    },
    dispose() { layer.remove(); els.clear(); },
  };
}
