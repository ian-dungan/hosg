// Bars over enemies' heads: name and health while engaged or hurt in the last 5 s (for the current target only its
// marks: its frame shows the rest), always for elites, which also get a stagger bar, greyed while it cannot fill;
// the marks (Soaked, Burning, Marked, Rooted, Dazed) and debuffs (Blinded, Weak Point) on them as icons, and a chevron while
// they surge. Plan 4: a crystal sigil, "Warded", over a boss while a Lens Shard wards it; and Searing as 1–5 small
// flames over each adventurer carrying it. DOM, projected each frame; elements are kept per enemy (and per adventurer
// with Searing) and hidden when not needed.
import { Matrix, Vector3, type Scene } from '@babylonjs/core';
import { DEBUFF_BITS, ENEMY_KINDS, MARK_BITS, type DebuffId, type EnemyKindId, type MarkId } from '@sg2/shared';
import type { Enemies } from '../net/enemies';
import type { PlayerView, ZoneRoom } from '../net/session';

/** Shown this long after the enemy last lost health, in ms. */
const HURT_SHOW_MS = 5000;
const LIFT = 0.55;

const CSS = /* css */ `
.sg-oh-layer{z-index:0}
.sg-oh{position:absolute;left:0;top:0;display:none;flex-direction:column;align-items:center;gap:2px;will-change:transform;pointer-events:none}
.sg-oh.on{display:flex}
.sg-oh-name{font:700 12px/1.1 var(--sans);color:#fff2e6;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 4px rgba(0,0,0,.5)}
.sg-oh.tgt .sg-oh-name,.sg-oh.tgt:not(.elite) .sg-oh-hp{display:none} /* the target frame names it and shows its health: only its marks stay, clear of the adventurer's head in melee */
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
.sg-oh-marks b{display:grid;place-items:center;width:16px;height:16px;border-radius:50%;font:800 10px/1 var(--sans);font-variant-emoji:text;color:#1a1020;text-shadow:none;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
.sg-oh-marks b.debuff{border-radius:4px;color:#fff6e6;box-shadow:0 0 0 1px rgba(255,255,255,.5)}
.sg-oh-surge{display:none;font:900 12px/1 var(--sans);color:#7ff0ff;text-shadow:0 0 6px rgba(80,220,255,.9),0 1px 2px #000;letter-spacing:-2px}
.sg-oh.surge .sg-oh-surge{display:block;animation:sg-oh-surge .35s linear infinite}
@keyframes sg-oh-surge{50%{transform:translateX(3px);opacity:.6}}
.sg-oh-ward{display:none;align-items:center;gap:3px;font:800 11px/1 var(--sans);color:#c8fff6;text-shadow:0 0 6px rgba(95,200,216,.95),0 1px 2px #000}
.sg-oh-ward i{display:block;width:12px;height:16px;background:linear-gradient(180deg,#e8fffb,#5fc8d8 60%,#2b867f);clip-path:polygon(50% 0,100% 38%,72% 100%,28% 100%,0 38%);box-shadow:0 0 6px #5fc8d8;animation:sg-oh-ward 1.6s ease-in-out infinite}
.sg-oh.warded .sg-oh-ward{display:flex}
@keyframes sg-oh-ward{50%{transform:translateY(-2px) scale(1.08)}}
.sg-oh-sear{position:absolute;left:0;top:0;display:none;gap:1px;align-items:flex-end;will-change:transform;pointer-events:none}
.sg-oh-sear.on{display:flex}
.sg-oh-sear b{display:block;width:9px;height:13px;border-radius:50% 50% 45% 45%/62% 62% 38% 38%;background:radial-gradient(circle at 50% 75%,#fff2b0 0 18%,#F2B742 35%,#EC6A4C 75%);box-shadow:0 0 5px rgba(236,106,76,.9);animation:sg-oh-flame .5s ease-in-out infinite alternate}
.sg-oh-sear b:nth-child(2n){animation-delay:-.25s;height:11px}
@keyframes sg-oh-flame{from{transform:scaleY(.82) rotate(-4deg)}to{transform:scaleY(1.08) rotate(4deg)}}
`;

const MARK_ICON: Record<MarkId, { g: string; c: string; label: string }> = {
  marked: { g: '◎', c: '#F2B742', label: 'Marked' }, burning: { g: '✷', c: '#ff8a4c', label: 'Burning' }, soaked: { g: '≈', c: '#5fd0c4', label: 'Soaked' },
  rooted: { g: '⤓', c: '#8FD16A', label: 'Rooted' }, dazed: { g: '⊛', c: '#c9a6ff', label: 'Dazed' },
};
const MARK_ORDER: readonly MarkId[] = ['marked', 'burning', 'soaked', 'rooted', 'dazed'];
const DEBUFF_ICON: Record<DebuffId, { g: string; c: string; label: string }> = {
  blinded: { g: '◑', c: '#6d6886', label: 'Blinded' }, weakpoint: { g: '⊙', c: '#c84a32', label: 'Weak Point' },
};

interface El { root: HTMLElement; name: HTMLElement; hp: HTMLElement; st: HTMLElement; stFill: HTMLElement; marks: HTMLElement; k: { hp: number; st: number; marks: number; immune: boolean; on: boolean; tgt: boolean; surge: boolean; ward: boolean } }
/** Searing over one adventurer: its flames and the count shown. */
interface Sear { root: HTMLElement; n: number; on: boolean }
/** Searing stacks drawn at most (AFFLICTIONS.searing.maxStacks). */
const SEAR_MAX = 5;
/** Searing flames sit this far over an adventurer's feet, in m. */
const SEAR_LIFT = 2.15;

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
    const ward = document.createElement('div'); ward.className = 'sg-oh-ward'; ward.append(document.createElement('i'), 'Warded');
    root.append(ward, name, row, st);
    if (ENEMY_KINDS[kind].elite) root.classList.add('elite');
    layer.appendChild(root);
    return { root, name, hp: hpFill, st, stFill, marks, k: { hp: -1, st: -1, marks: -1, immune: false, on: false, tgt: false, surge: false, ward: false } };
  };

  const seen = new Set<number>();
  const sears = new Map<string, Sear>();
  const searSeen = new Set<string>();
  let searW = 0, searH = 0, searVp: ReturnType<NonNullable<Scene['activeCamera']>['viewport']['toGlobal']> | null = null, searTf = Matrix.Identity();
  const visitSear = (p: PlayerView, key: string) => {
    const n = Math.max(0, Math.min(SEAR_MAX, (p as PlayerView & { searing?: number }).searing ?? 0));
    if (n === 0 || p.hp <= 0) return;
    searSeen.add(key);
    let sr = sears.get(key);
    if (!sr) { const root = document.createElement('div'); root.className = 'sg-oh-sear'; layer.appendChild(root); sr = { root, n: 0, on: false }; sears.set(key, sr); }
    if (sr.n !== n) { sr.n = n; sr.root.textContent = ''; for (let i = 0; i < n; i++) sr.root.appendChild(document.createElement('b')); sr.root.title = `Searing ×${n}`; }
    let on = false;
    if (searVp) {
      at.set(p.x, p.y + SEAR_LIFT, p.z);
      Vector3.ProjectToRef(at, Matrix.IdentityReadOnly, searTf, searVp, screen);
      on = screen.z > 0 && screen.z < 1 && screen.x > -40 && screen.x < searW + 40 && screen.y > -40 && screen.y < searH + 40;
      if (on) sr.root.style.transform = `translate(${screen.x.toFixed(1)}px,${screen.y.toFixed(1)}px) translate(-50%,-100%)`;
    }
    if (on !== sr.on) { sr.on = on; sr.root.classList.toggle('on', on); }
  };
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
        const ward = !!(e as typeof e & { warded?: boolean }).warded;
        if (ward !== k.ward) { k.ward = ward; el.root.classList.toggle('warded', ward); }
        const surge = !!e.surging;
        if (surge !== k.surge) { k.surge = surge; el.root.classList.toggle('surge', surge); }
        // marks in the low byte, debuffs above them (both unset until their first: read as 0)
        const bits = (e.marks ?? 0) | ((e.debuffs ?? 0) << 8);
        if (bits !== k.marks) {
          k.marks = bits;
          el.marks.textContent = '';
          for (const m of MARK_ORDER) {
            if (!(bits & MARK_BITS[m])) continue;
            const b = document.createElement('b'); b.textContent = MARK_ICON[m].g; b.style.background = MARK_ICON[m].c; b.title = MARK_ICON[m].label;
            el.marks.appendChild(b);
          }
          for (const d of Object.keys(DEBUFF_ICON) as DebuffId[]) {
            if (!((bits >> 8) & DEBUFF_BITS[d])) continue;
            const b = document.createElement('b'); b.className = 'debuff'; b.textContent = DEBUFF_ICON[d].g; b.style.background = DEBUFF_ICON[d].c; b.title = DEBUFF_ICON[d].label;
            el.marks.appendChild(b);
          }
        }
      });
      for (const [eid, el] of els) if (!seen.has(eid)) { el.root.remove(); els.delete(eid); }
      // Searing: 1–5 flames over each adventurer in view carrying it
      searSeen.clear();
      searW = w; searH = h; searVp = viewport ?? null; searTf = transform;
      room.state.players?.forEach(visitSear);
      for (const [key, sr] of sears) if (!searSeen.has(key)) { sr.root.remove(); sears.delete(key); }
    },
    dispose() { layer.remove(); els.clear(); sears.clear(); },
  };
}
