// The boss frame: at the top centre while the targeted enemy (or an engaged one in view) is a boss or a
// mega boss. Name and phase pips, a thick hp bar with the phase marks, the phase name, Warded (kill the Lens
// Shards), the enrage countdown from 60 s before it, the stagger bar with the Break window, and the wind-up:
// blue with "!" when it can be interrupted, and a plain warning for the attacks no dodge avoids.
// bossBar (pure, tested) turns the room state into what the frame shows.
import { BOSSES, BREAK_DAMAGE_MULT, ENEMY_ATTACKS, ENEMY_KINDS, TICK_HZ, type BossKindId, type EnemyAttackId, type VictoryView } from '@sg2/shared';
import type { BossBar } from '../core/contracts';
import { h, toggle, ICONS } from './dom';
import { Bar } from './frames';

/** The enrage countdown shows from this long before it, in s. */
export const ENRAGE_SHOW_S = 60;
/** The line for attacks no dodge avoids (Keeper's Toll, Last Light). */
export const UNAVOIDABLE_TEXT = 'Cannot be dodged — shield, heal or Break it';

/** A boss as the room state shows it (the fields bossBar reads). */
export interface BossStateView {
  kind: string; hp: number; maxHp: number; mode: string; windup: string; windupTotal?: number;
  stagger?: number; maxStagger?: number; staggerImmune?: number; phase?: number; warded?: boolean; enrageAt?: number;
}

const isBoss = (k: string): k is BossKindId => Object.prototype.hasOwnProperty.call(BOSSES, k);
const isAttack = (a: string): a is EnemyAttackId => Object.prototype.hasOwnProperty.call(ENEMY_ATTACKS, a);
/** "the Wickhound" → "The Wickhound" (a frame's title). */
export const bossTitle = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * What the boss frame shows for enemy `e` on the room's `clock` (steps), or null when it is no boss. `opts`:
 * how far its wind-up is (0..1), how long its transition still runs (s; from its `phase` fx), and whether it
 * is the target. Written into `out` (reused) when given.
 */
export function bossBar(
  e: BossStateView, clock: number | undefined, opts: { windupFrac: number; transitionLeftS: number; targeted: boolean }, out?: BossBar,
): BossBar | null {
  if (!isBoss(e.kind)) return null;
  const k = ENEMY_KINDS[e.kind], data = BOSSES[e.kind];
  if (k.tier !== 'boss' && k.tier !== 'mega') return null;
  const phase = Math.max(0, Math.min(data.phases.length - 1, e.phase ?? 0));
  const b = out ?? ({ phaseMarks: [] } as unknown as BossBar);
  b.name = bossTitle(k.name); b.hp = e.hp; b.maxHp = Math.max(1, e.maxHp);
  b.phase = phase; b.phases = data.phases.length;
  b.phaseMarks.length = 0;
  for (let i = 0; i < data.phases.length - 1; i++) b.phaseMarks.push(data.phases[i].untilFrac);
  b.phaseName = data.lore.phases[phase] ?? data.phases[phase].name;
  b.warded = !!e.warded;
  const at = e.enrageAt ?? 0;
  if (!at || typeof clock !== 'number') b.enrageIn = null;
  else { const s = (at - clock) / TICK_HZ; b.enrageIn = s > ENRAGE_SHOW_S ? null : Math.max(0, s); }
  b.stagger = e.stagger ?? 0; b.maxStagger = e.maxStagger ?? 0;
  b.broken = e.mode === 'stunned';
  b.staggerImmune = e.staggerImmune ?? 0;
  const w = e.windup;
  if (w && isAttack(w)) {
    const a = ENEMY_ATTACKS[w];
    const c = b.cast ?? { name: '', frac: 0, interruptible: false, unavoidable: false };
    c.name = a.name; c.frac = Math.max(0, Math.min(1, opts.windupFrac)); c.interruptible = a.interruptible; c.unavoidable = !!a.unavoidable;
    b.cast = c;
  } else b.cast = null;
  b.transition = opts.transitionLeftS > 0;
  b.targeted = opts.targeted;
  return b;
}

/** "0:42" for a countdown in s. */
export const clockText = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

/** The victory screen's lines: the boss's lore line, the time and party, the rewards and the rank. */
export function victoryLines(v: VictoryView): string[] {
  const kind = bossTitle(Object.prototype.hasOwnProperty.call(ENEMY_KINDS, v.boss) ? ENEMY_KINDS[v.boss].name : String(v.boss));
  const lines = [v.lore || (BOSSES[v.boss]?.lore.victory ?? ''), `${kind} · ${clockText(v.seconds)} · party of ${v.partySize}`, `+${v.xp} job xp`];
  if (v.boss === 'fallen_warden') lines.push(v.seal ? `Warden's Seal +1 (${v.seals} in all)` : `Seal already earned today (${v.seals} in all)`);
  if (v.title) lines.push(`Title: ${v.title}`);
  if (v.rank !== null) lines.push(`Rank ${v.rank} for a party of ${v.partySize}`);
  return lines.filter((l) => l);
}

/** The boss frame (DOM): every update touches only what changed. */
export class BossFrame {
  readonly el: HTMLElement;
  private nameEl: HTMLElement;
  private pips: HTMLElement;
  private phaseEl: HTMLElement;
  private hp: Bar;
  private marks: HTMLElement;
  private tags: HTMLElement;
  private ward: HTMLElement;
  private enrage: HTMLElement;
  private stag: Bar;
  private stagLabel: HTMLElement;
  private castEl: HTMLElement;
  private castName: HTMLElement;
  private castBar: Bar;
  private warn: HTMLElement;
  private close: HTMLElement;
  private c = { on: false, name: '', phase: -1, phases: -1, marks: '', hp: -1, max: -1, warded: false, enrage: '', stag: -1, broken: false, immune: false,
    cast: '', intr: false, unav: false, trans: false, targeted: false, phaseName: '' };
  constructor(parent: HTMLElement, onClose: () => void) {
    this.el = h('div', 'sg-bf', parent);
    const head = h('div', 'sg-bf-head', this.el);
    this.pips = h('div', 'sg-bf-pips', head);
    this.nameEl = h('div', 'sg-bf-name', head);
    this.close = h('div', 'sg-bf-close sg-ctl', head);
    this.close.innerHTML = ICONS.close;
    this.close.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onClose(); });
    const hpWrap = h('div', 'sg-bf-hpwrap', this.el);
    this.hp = new Bar(hpWrap, 'sg-hp-boss sg-bf-hp');
    this.marks = h('div', 'sg-bf-marks', hpWrap);
    const sub = h('div', 'sg-bf-sub', this.el);
    this.phaseEl = h('span', 'sg-bf-phase', sub);
    this.tags = h('span', 'sg-bf-tags', sub);
    this.ward = h('span', 'sg-bf-ward', this.tags, 'Warded · kill the Lens Shards');
    this.enrage = h('span', 'sg-bf-enrage', this.tags);
    const sw = h('div', 'sg-bf-stagwrap', this.el);
    this.stagLabel = h('div', 'sg-bf-staglabel', sw, 'STAGGER');
    this.stag = new Bar(sw, 'sg-stag sg-bf-stag', false);
    this.castEl = h('div', 'sg-bf-cast', this.el);
    this.castName = h('div', 'sg-bf-castname', this.castEl);
    this.castBar = new Bar(this.castEl, 'sg-bf-castbar', false);
    this.warn = h('div', 'sg-bf-warn', this.castEl, UNAVOIDABLE_TEXT);
    // portrait phones: one line (name and health) until tapped; a tap shows the whole frame, another folds it again
    this.el.addEventListener('pointerdown', (e) => {
      if (this.close.contains(e.target as Node)) return;
      e.preventDefault(); e.stopPropagation();
      toggle(this.el, 'expanded', !this.el.classList.contains('expanded'));
    });
  }
  update(b: BossBar | null | undefined): boolean {
    const c = this.c, on = !!b;
    if (on !== c.on) { c.on = on; toggle(this.el, 'on', on); if (!on) c.name = ''; }
    if (!b) return false;
    if (b.name !== c.name) { c.name = b.name; this.nameEl.textContent = b.name; c.hp = -1; }
    if (b.phases !== c.phases || b.phase !== c.phase) {
      if (b.phases !== c.phases) { this.pips.textContent = ''; for (let i = 0; i < b.phases; i++) h('i', '', this.pips); }
      c.phases = b.phases; c.phase = b.phase;
      for (let i = 0; i < this.pips.children.length; i++) {
        toggle(this.pips.children[i] as HTMLElement, 'done', i < b.phase);
        toggle(this.pips.children[i] as HTMLElement, 'cur', i === b.phase);
      }
    }
    if (b.phaseName !== c.phaseName) { c.phaseName = b.phaseName; this.phaseEl.textContent = b.phaseName; }
    const mk = b.phaseMarks.join(',');
    if (mk !== c.marks) {
      c.marks = mk; this.marks.textContent = '';
      for (const f of b.phaseMarks) h('i', '', this.marks).style.left = `${(f * 100).toFixed(1)}%`;
    }
    if (b.hp !== c.hp || b.maxHp !== c.max) {
      const fresh = c.hp < 0;
      c.hp = b.hp; c.max = b.maxHp;
      const f = b.hp / b.maxHp;
      if (fresh) this.hp.snap(f);
      this.hp.set(f, `${Math.max(0, Math.ceil(b.hp))} · ${Math.round(f * 100)}%`);
    }
    if (b.warded !== c.warded) { c.warded = b.warded; toggle(this.el, 'warded', b.warded); }
    const en = b.enrageIn === null ? '' : b.enrageIn <= 0 ? 'ENRAGED' : `Enrage ${clockText(b.enrageIn)}`;
    if (en !== c.enrage) { c.enrage = en; this.enrage.textContent = en; toggle(this.el, 'enraged', en === 'ENRAGED'); toggle(this.el, 'enraging', en !== ''); }
    const sf = b.maxStagger > 0 ? b.stagger / b.maxStagger : 0;
    if (Math.abs(sf - c.stag) > 0.002) { c.stag = sf; this.stag.set(b.broken ? 1 : sf); }
    if (b.broken !== c.broken) {
      c.broken = b.broken; toggle(this.el, 'broken', b.broken);
      this.stagLabel.textContent = b.broken ? `BREAK · ×${BREAK_DAMAGE_MULT} DAMAGE` : 'STAGGER';
      if (b.broken) this.el.animate([{ filter: 'brightness(1.9)' }, { filter: 'none' }], { duration: 600 });
      this.stag.set(b.broken ? 1 : sf);
    }
    const immune = b.staggerImmune > 0 && !b.broken;
    if (immune !== c.immune) { c.immune = immune; toggle(this.el, 'immune', immune); }
    const cast = b.cast?.name ?? '';
    if (cast !== c.cast) { c.cast = cast; this.castName.textContent = cast; toggle(this.castEl, 'on', !!cast); if (cast) this.castBar.snap(b.cast!.frac); }
    if (b.cast) {
      if (b.cast.interruptible !== c.intr) { c.intr = b.cast.interruptible; toggle(this.castEl, 'intr', c.intr); }
      if (b.cast.unavoidable !== c.unav) { c.unav = b.cast.unavoidable; toggle(this.castEl, 'unav', c.unav); }
      this.castBar.set(b.cast.frac);
    }
    if (b.transition !== c.trans) { c.trans = b.transition; toggle(this.el, 'transition', b.transition); }
    if (b.targeted !== c.targeted) { c.targeted = b.targeted; toggle(this.el, 'targeted', b.targeted); }
    return true;
  }
}

export const BOSS_CSS = /* css */ `
.sg-bf{position:fixed;top:calc(var(--st) + var(--g));left:50%;transform:translateX(-50%);width:min(92vw,520px);display:none;flex-direction:column;gap:4px;
  padding:6px 12px 8px;border-radius:14px;background:linear-gradient(180deg,rgba(40,14,30,.62),rgba(18,22,48,.42));box-shadow:inset 0 0 0 1px rgba(255,190,140,.25)}
.sg-bf.on{display:flex}
.sg-bf.targeted{box-shadow:inset 0 0 0 1.5px rgba(255,214,120,.75)}
.sg-bf-head{display:flex;align-items:center;gap:8px}
.sg-bf-pips{display:flex;gap:4px;flex:none}
.sg-bf-pips i{width:9px;height:9px;transform:rotate(45deg);border:1.5px solid rgba(255,226,160,.8);border-radius:1px}
.sg-bf-pips i.done{background:rgba(255,226,160,.35);border-color:rgba(255,226,160,.45)}
.sg-bf-pips i.cur{background:var(--gold2);box-shadow:0 0 6px rgba(255,207,90,.9)}
.sg-bf-name{flex:1;min-width:0;text-align:center;font:italic 600 19px/1.1 var(--serif);color:#fff2dc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-bf-close{display:none;position:relative;flex:none;width:24px;height:24px;padding:4px;border-radius:50%;color:var(--cream);background:rgba(255,255,255,.12)}
.sg-bf-close::before{content:"";position:absolute;inset:-12px}
.sg-bf.targeted .sg-bf-close{display:block}
.sg-bf-hpwrap{position:relative}
.sg-bf-hp{height:16px}
.sg-bf-marks{position:absolute;inset:0;pointer-events:none}
.sg-bf-marks i{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;background:#fff6e6;box-shadow:0 0 3px rgba(0,0,0,.8)}
.sg-bf-sub{display:flex;align-items:center;gap:8px;min-height:16px;font-size:11.5px;font-weight:700}
.sg-bf-phase{flex:1;min-width:0;color:var(--goldl);letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-bf-tags{display:flex;gap:6px;flex:none}
.sg-bf-ward,.sg-bf-enrage{display:none;padding:1px 7px;border-radius:8px;white-space:nowrap}
.sg-bf.warded .sg-bf-ward{display:inline;color:#cfe8ff;background:rgba(71,154,242,.35);box-shadow:inset 0 0 0 1px rgba(150,200,255,.7)}
.sg-bf.enraging .sg-bf-enrage{display:inline;color:#ffe2c0;background:rgba(236,106,76,.3);font-variant-numeric:tabular-nums}
.sg-bf.enraged .sg-bf-enrage{color:#fff;background:#c8322a;animation:sg-pulse .5s ease-in-out infinite alternate}
.sg-bf.warded .sg-bf-hp{--bar:linear-gradient(90deg,#4a6aa8,#8fb4ea)}
.sg-bf.transition .sg-bf-hp{filter:grayscale(.6) brightness(1.2)}
.sg-bf-stagwrap{display:flex;align-items:center;gap:8px;margin:0 6%}
.sg-bf-staglabel{flex:none;font-size:9px;font-weight:800;letter-spacing:.16em;color:var(--goldl)}
.sg-bf-stag{flex:1;height:7px}
.sg-bf.broken .sg-bf-staglabel{color:#fff3c4;text-shadow:0 0 8px #F2B742}
.sg-bf.broken .sg-bf-stag{animation:sg-pulse .4s ease-in-out infinite alternate}
.sg-bf.immune .sg-bf-stag{filter:grayscale(1);opacity:.5}
.sg-bf-cast{display:none;flex-direction:column;align-items:center;gap:2px}
.sg-bf-cast.on{display:flex}
.sg-bf-castname{font-size:12px;font-weight:700;letter-spacing:.04em}
.sg-bf-castbar{width:70%;height:7px;--bar:linear-gradient(90deg,#ffb08a,#EC6A4C)}
.sg-bf-castbar .sg-bar-trail{display:none}.sg-bf-castbar .sg-bar-fill{transition:none}
.sg-bf-cast.intr .sg-bf-castbar{--bar:linear-gradient(90deg,#8fd0ff,#479AF2)}
.sg-bf-cast.intr .sg-bf-castname::after{content:"  !  INTERRUPT";color:#9fd6ff;animation:sg-blink .6s steps(2) infinite}
.sg-bf-warn{display:none;padding:2px 10px;border-radius:9px;font-size:12px;font-weight:800;color:#fff3c4;background:rgba(160,40,30,.7);
  box-shadow:inset 0 0 0 1px rgba(255,214,120,.8);text-align:center}
.sg-bf-cast.unav .sg-bf-warn{display:block;animation:sg-pulse .45s ease-in-out infinite alternate}
.sg-has-bossframe .sg-banner{top:calc(var(--st) + 22vh)}
@media (max-width:700px) and (orientation:portrait){
  .sg-bf{position:relative;left:auto;top:auto;transform:none;width:auto;padding:5px 8px 6px;pointer-events:auto}
  .sg-bf-name{font-size:15px}
  /* folded (until tapped): one line, the name and the health bar; an unavoidable cast's warning still shows */
  .sg-bf:not(.expanded){flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:4px 8px}
  .sg-bf:not(.expanded) .sg-bf-head{flex:1 1 auto;min-width:0}
  .sg-bf:not(.expanded) .sg-bf-name{text-align:left;font-size:14px}
  .sg-bf:not(.expanded) .sg-bf-hpwrap{flex:0 0 36%;min-width:0}
  .sg-bf:not(.expanded) .sg-bf-hp{height:11px}
  .sg-bf:not(.expanded) .sg-bf-hp .sg-bar-text{display:none}
  .sg-bf:not(.expanded) .sg-bf-sub,.sg-bf:not(.expanded) .sg-bf-stagwrap,.sg-bf:not(.expanded) .sg-bf-cast:not(.unav){display:none}
  .sg-bf:not(.expanded) .sg-bf-cast.unav{flex-basis:100%}
  .sg-bf:not(.expanded) .sg-bf-cast.unav .sg-bf-castname,.sg-bf:not(.expanded) .sg-bf-cast.unav .sg-bf-castbar{display:none}

  .sg-bf-hp{height:13px}
  .sg-bf-sub{font-size:10.5px}
  .sg-bf-warn{font-size:11px}
}
@media (max-height:500px){
  .sg-bf{left:auto;right:calc(var(--sr) + var(--g) + 112px);transform:none;width:min(44vw,400px);padding:4px 10px 5px;gap:3px}

  .sg-has-bossframe .sg-tf{top:calc(var(--st) + var(--g) + 124px)}
  .sg-bf-name{font-size:15px}
  .sg-bf-hp{height:12px}
}
`;
