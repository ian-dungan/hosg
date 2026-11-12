// Unit frames: player, target (+ boss bar), party. Every update() diffs against a cache.
import type { JobId } from '@sg2/shared';
import type { HudBar, HudState, StatusId, WeaponId } from '../core/contracts';
import { h, toggle, ICONS } from './dom';
import { JOB_COLOR } from './jobs';

const STATUS: Record<StatusId, { g: string; label: string; c: string }> = {
  soaked: { g: '≈', label: 'Soaked', c: '#3FB0A6' },
  burning: { g: '✷', label: 'Burning', c: '#EC6A4C' },
  marked: { g: '◎', label: 'Marked', c: '#F2B742' },
  stunned: { g: '✦', label: 'Stunned', c: '#b9a6f2' },
  staggered: { g: '✧', label: 'Staggered', c: '#FCB380' },
  guard: { g: '◆', label: 'Guard', c: '#479AF2' },
  regen: { g: '+', label: 'Regen', c: '#8FD16A' },
  slowed: { g: '↓', label: 'Slowed', c: '#9aa6c8' },
  // marks and debuffs on enemies
  rooted: { g: '⤓', label: 'Rooted', c: '#8FD16A' },
  dazed: { g: '⊛', label: 'Dazed', c: '#c9a6ff' },
  blinded: { g: '◑', label: 'Blinded', c: '#b8b4c8' },
  weakpoint: { g: '⊙', label: 'Weak Point', c: '#ff8a6a' },
  // buffs on adventurers
  roar: { g: '⇑', label: 'Roar', c: '#EC6A4C' },
  aegis: { g: '⬡', label: 'Aegis', c: '#479AF2' },
  sheltered: { g: '⌂', label: 'Sheltered', c: '#7fb8ff' },
  rain: { g: '⁘', label: 'Soft Rain', c: '#5fd0c4' },
  pact: { g: '⊗', label: 'Pact', c: '#c0605a' },
  mist: { g: '░', label: 'Mist', c: '#c8d6f0' },
  bloodbond: { g: '∞', label: 'Bloodbond', c: '#e8728a' },
};

export class Bar {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private trail: HTMLElement;
  private txt: HTMLElement | null;
  private f = -1;
  private t = '';
  constructor(parent: HTMLElement, cls: string, withText = true) {
    this.el = h('div', 'sg-bar ' + cls, parent);
    this.trail = h('div', 'sg-bar-trail', this.el);
    this.fill = h('div', 'sg-bar-fill', this.el);
    this.txt = withText ? h('div', 'sg-bar-text', this.el) : null;
  }
  set(frac: number, text?: string): void {
    frac = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    if (Math.abs(frac - this.f) > 0.0008) {
      this.f = frac;
      const s = `scaleX(${frac.toFixed(4)})`;
      this.fill.style.transform = s;
      this.trail.style.transform = s;
    }
    if (text !== undefined && this.txt && text !== this.t) { this.t = text; this.txt.textContent = text; }
  }
  /** Jump without the damage trail (target switched). */
  snap(frac: number): void {
    this.fill.style.transition = this.trail.style.transition = 'none';
    this.f = -1; this.set(frac);
    requestAnimationFrame(() => requestAnimationFrame(() => { this.fill.style.transition = this.trail.style.transition = ''; }));
  }
}

export class Chips {
  readonly el: HTMLElement;
  private key = '';
  constructor(parent: HTMLElement, private labels: boolean) { this.el = h('div', 'sg-chips', parent); }
  set(list: StatusId[]): void {
    const k = list.join(',');
    if (k === this.key) return;
    this.key = k;
    this.el.textContent = '';
    for (const id of list) {
      const s = STATUS[id]; if (!s) continue;
      const c = h('span', 'sg-chip', this.el);
      c.style.setProperty('--c', s.c);
      c.title = s.label;
      c.dataset.status = id;
      h('b', '', c, s.g);
      if (this.labels) h('span', '', c, s.label);
    }
  }
}

class CastBar {
  readonly el: HTMLElement;
  private bar: Bar;
  private markEl: HTMLElement | null = null;
  private mark = -1;
  private name = '';
  private nameEl: HTMLElement;
  private on = false;
  private intr = false;
  constructor(parent: HTMLElement, cls: string) {
    this.el = h('div', 'sg-cast ' + cls, parent);
    this.nameEl = h('div', 'sg-cast-name', this.el);
    this.bar = new Bar(this.el, 'sg-cast-bar', false);
  }
  set(c: { name: string; frac: number; interruptible?: boolean; mark?: number } | null): void {
    const on = !!c;
    if (on !== this.on) { this.on = on; toggle(this.el, 'on', on); }
    if (!c) return;
    const mark = c.mark ?? -1;
    if (mark !== this.mark) {
      this.mark = mark;
      if (mark >= 0 && !this.markEl) this.markEl = h('i', 'sg-cast-mark', this.bar.el);
      if (this.markEl) { this.markEl.style.left = `${(mark * 100).toFixed(1)}%`; this.markEl.hidden = mark < 0; }
    }
    if (this.markEl) toggle(this.el, 'past-mark', mark >= 0 && c.frac >= mark);
    if (c.name !== this.name) { this.name = c.name; this.nameEl.textContent = c.name; this.bar.snap(c.frac); }
    const intr = !!c.interruptible;
    if (intr !== this.intr) { this.intr = intr; toggle(this.el, 'intr', intr); }
    this.bar.set(c.frac);
  }
}

function hpText(hp: number, max: number): string { return `${Math.max(0, Math.ceil(hp))} / ${Math.ceil(max)}`; }

export class PlayerFrame {
  readonly el: HTMLElement;
  private lvl: HTMLElement;
  private nameEl: HTMLElement;
  private weaponEl: HTMLElement;
  private hp: Bar;
  private mom: Bar;
  private chips: Chips;
  readonly cast: CastBar;
  private em: HTMLElement;
  private jobGlyph: HTMLElement;
  private c = { name: '', level: -1, hp: -1, max: -1, weapon: '' as WeaponId | '', low: false, mom: -1, momOn: false, momState: '', job: '', jobLevel: -1 };
  constructor(parent: HTMLElement, castParent: HTMLElement) {
    this.el = h('div', 'sg-pf', parent);
    const em = this.em = h('div', 'sg-pf-emblem', this.el);
    this.jobGlyph = h('b', 'sg-pf-job', em);
    this.lvl = h('span', '', em);
    const main = h('div', 'sg-pf-main', this.el);
    const top = h('div', 'sg-pf-top', main);
    this.nameEl = h('div', 'sg-pf-name', top);
    this.weaponEl = h('div', 'sg-pf-weapon', top);
    this.hp = new Bar(main, 'sg-hp-player');
    // Momentum: gold, with the finisher threshold (50) marked; it pulses at 50 and at 100
    this.mom = new Bar(main, 'sg-mom', false);
    h('i', 'sg-mom-mark', this.mom.el);
    this.chips = new Chips(main, false);
    this.cast = new CastBar(castParent, 'sg-cast-player');
  }
  update(p: HudState['player']): void {
    const c = this.c;
    if (p.name !== c.name) { c.name = p.name; this.nameEl.textContent = p.name; }
    // the job badge: its glyph on the job's colour, with its level (the offline demo: the level alone)
    const job = p.job?.id ?? '';
    if (job !== c.job) {
      c.job = job;
      toggle(this.el, 'has-job', !!p.job);
      this.jobGlyph.textContent = p.job?.glyph ?? '';
      this.em.title = p.job?.name ?? '';
      const col = job ? JOB_COLOR[job as JobId] : null;
      this.em.style.setProperty('--jb', col?.bg ?? '');
      this.em.style.setProperty('--jf', col?.fg ?? '');
      c.jobLevel = p.job?.level ?? -1;
    } else if (p.job && p.job.level !== c.jobLevel) {
      if (p.job.level > c.jobLevel && c.jobLevel > 0) this.em.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.35)', filter: 'brightness(2.2)', offset: 0.3 }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 900, easing: 'ease-out' });
      c.jobLevel = p.job.level;
    }
    const level = p.job?.level ?? p.level;
    if (level !== c.level) { c.level = level; this.lvl.textContent = String(level); }
    if (p.weapon !== c.weapon) { c.weapon = p.weapon; this.weaponEl.innerHTML = (ICONS as Record<string, string>)[p.weapon] ?? ''; this.weaponEl.title = p.weapon; }
    if (p.hp !== c.hp || p.maxHp !== c.max) {
      c.hp = p.hp; c.max = p.maxHp;
      const f = p.maxHp > 0 ? p.hp / p.maxHp : 0;
      this.hp.set(f, hpText(p.hp, p.maxHp));
      const low = f < 0.3 && f > 0;
      if (low !== c.low) { c.low = low; toggle(this.el, 'low', low); }
    }
    const momOn = p.momentum !== undefined;
    if (momOn !== c.momOn) { c.momOn = momOn; toggle(this.el, 'has-mom', momOn); }
    if (momOn && p.momentum !== c.mom) {
      c.mom = p.momentum!;
      this.mom.set(c.mom / 100);
      const st = c.mom >= 100 ? 'full' : c.mom >= 50 ? 'ready' : '';
      if (st !== c.momState) {
        if (st && st !== c.momState) this.mom.el.animate([{ filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }], { duration: 500 });
        c.momState = st; toggle(this.mom.el, 'ready', st !== ''); toggle(this.mom.el, 'full', st === 'full');
      }
    }
    toggle(this.el, 'dead', !!p.dead);
    this.chips.set(p.statuses);
    this.cast.set(p.cast);
  }
}

export class TargetFrame {
  readonly el: HTMLElement;
  readonly boss: HTMLElement;
  private nameEl: HTMLElement;
  private hp: Bar;
  private chips: Chips;
  private cast: CastBar;
  private bName: HTMLElement;
  private bHp: Bar;
  private bStag: Bar;
  private bChips: Chips;
  private bCast: CastBar;
  private bBreak: HTMLElement;
  private c = { id: '', hp: -1, max: -1, stag: -1, mode: 0 as 0 | 1 | 2, staggered: false };
  constructor(parent: HTMLElement, bossParent: HTMLElement, onClose: () => void) {
    this.el = h('div', 'sg-tf', parent);
    const head = h('div', 'sg-tf-head', this.el);
    this.nameEl = h('div', 'sg-tf-name', head);
    const x = h('div', 'sg-tf-close sg-ctl', head);
    x.innerHTML = ICONS.close;
    x.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onClose(); });
    this.hp = new Bar(this.el, 'sg-hp-enemy');
    this.chips = new Chips(this.el, true);
    this.cast = new CastBar(this.el, 'sg-cast-target');

    this.boss = h('div', 'sg-boss', bossParent);
    this.bName = h('div', 'sg-boss-name', this.boss);
    this.bHp = new Bar(this.boss, 'sg-hp-boss');
    const sw = h('div', 'sg-stag-wrap', this.boss);
    h('div', 'sg-stag-label', sw, 'STAGGER');
    this.bStag = new Bar(sw, 'sg-stag', false);
    this.bBreak = h('div', 'sg-break', sw, 'BREAK!');
    this.bChips = new Chips(this.boss, true);
    this.bCast = new CastBar(this.boss, 'sg-cast-boss');
  }
  update(t: HudState['target']): number {
    const c = this.c;
    const mode = !t ? 0 : t.isBoss ? 2 : 1;
    if (mode !== c.mode) { c.mode = mode; toggle(this.el, 'on', mode === 1); toggle(this.boss, 'on', mode === 2); }
    if (!t) { c.id = ''; return mode; }
    const id = t.name + '|' + t.maxHp;
    const fresh = id !== c.id;
    if (fresh) { c.id = id; this.nameEl.textContent = t.name; this.bName.textContent = t.name; }
    if (fresh || t.hp !== c.hp || t.maxHp !== c.max) {
      c.hp = t.hp; c.max = t.maxHp;
      const f = t.maxHp > 0 ? t.hp / t.maxHp : 0;
      const bar = t.isBoss ? this.bHp : this.hp;
      const txt = t.isBoss ? `${Math.round(f * 100)}%` : hpText(t.hp, t.maxHp);
      if (fresh) bar.snap(f);
      bar.set(f, txt);
    }
    if (t.isBoss) {
      const sf = t.maxStagger > 0 ? t.stagger / t.maxStagger : 0;
      const staggered = t.statuses.includes('staggered');
      if ((c.stag >= 0.9 && sf < 0.2 && !fresh) || (staggered && !c.staggered)) this.flashBreak();
      if (staggered !== c.staggered) { c.staggered = staggered; toggle(this.boss, 'staggered', staggered); }
      if (Math.abs(sf - c.stag) > 0.001) { c.stag = sf; this.bStag.set(sf); }
      toggle(this.boss, 'immune', (t.staggerImmune ?? 0) > 0);
      toggle(this.boss, 'surge', !!t.surging);
      this.bChips.set(t.statuses);
      this.bCast.set(t.cast);
    } else {
      toggle(this.el, 'surge', !!t.surging);
      this.chips.set(t.statuses);
      this.cast.set(t.cast);
    }
    return mode;
  }
  private flashBreak(): void {
    this.bBreak.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(2.2)' },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.18 },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1.05)', offset: 0.7 },
      { opacity: 0, transform: 'translate(-50%,-80%) scale(1)' },
    ], { duration: 1400, easing: 'ease-out' });
    this.boss.animate([
      { transform: 'translateX(-50%) translateX(0)' }, { transform: 'translateX(-50%) translateX(-6px)' },
      { transform: 'translateX(-50%) translateX(5px)' }, { transform: 'translateX(-50%) translateX(-3px)' },
      { transform: 'translateX(-50%) translateX(0)' },
    ], { duration: 360 });
    this.bStag.el.animate([{ filter: 'brightness(3)' }, { filter: 'brightness(1)' }], { duration: 700 });
  }
}

export class PartyFrames {
  readonly el: HTMLElement;
  private rows: { el: HTMLElement; name: HTMLElement; bar: Bar; chips: Chips; n: string; hp: number; max: number }[] = [];
  private count = -1;
  constructor(parent: HTMLElement) { this.el = h('div', 'sg-party', parent); }
  update(list: HudBar[]): void {
    if (list.length !== this.count) {
      this.count = list.length;
      while (this.rows.length < list.length) {
        const el = h('div', 'sg-party-row', this.el);
        const name = h('div', 'sg-party-name', el);
        const bar = new Bar(el, 'sg-hp-party', false);
        const chips = new Chips(el, false);
        this.rows.push({ el, name, bar, chips, n: '', hp: -1, max: -1 });
      }
      this.rows.forEach((r, i) => toggle(r.el, 'off', i >= list.length));
    }
    list.forEach((m, i) => {
      const r = this.rows[i];
      if (r.n !== m.name) { r.n = m.name; r.name.textContent = m.name; }
      if (r.hp !== m.hp || r.max !== m.maxHp) { r.hp = m.hp; r.max = m.maxHp; r.bar.set(m.maxHp > 0 ? m.hp / m.maxHp : 0); }
      r.chips.set(m.statuses);
    });
  }
}

/**
 * The focused ally (a tap on another adventurer): job glyph, name, health, buffs, their cast, and a close
 * button. Greyed while out of reach of ally abilities; "Down" while dead (a revive prompt shows near them).
 */
export class FocusFrame {
  readonly el: HTMLElement;
  private glyph: HTMLElement;
  private nameEl: HTMLElement;
  private tag: HTMLElement;
  private hp: Bar;
  private chips: Chips;
  private cast: CastBar;
  private act: HTMLElement;
  private actText = '';
  private c = { on: false, name: '', glyph: '', hp: -1, max: -1, dead: false, far: false };
  constructor(parent: HTMLElement, onClose: () => void, onAct: () => void) {
    this.el = h('div', 'sg-af', parent);
    const head = h('div', 'sg-af-head', this.el);
    this.glyph = h('b', 'sg-af-glyph', head);
    this.nameEl = h('div', 'sg-af-name', head);
    this.tag = h('span', 'sg-af-tag', head);
    const x = h('div', 'sg-af-close sg-ctl', head);
    x.innerHTML = ICONS.close;
    x.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onClose(); });
    this.hp = new Bar(this.el, 'sg-hp-ally', false);
    this.chips = new Chips(this.el, false);
    this.cast = new CastBar(this.el, 'sg-cast-ally');
    // on portrait phones the context prompt (a revive) shows here instead of under the frames
    this.act = h('div', 'sg-af-act sg-ctl', this.el);
    this.act.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onAct(); });
  }
  /** The context prompt's text, shown as this frame's button on portrait phones (null hides it). */
  prompt(text: string | null): void {
    if ((text ?? '') === this.actText) return;
    this.actText = text ?? '';
    this.act.textContent = this.actText;
    toggle(this.act, 'on', !!text);
  }
  update(a: HudState['ally']): void {
    const c = this.c, on = !!a;
    if (on !== c.on) { c.on = on; toggle(this.el, 'on', on); }
    if (!a) return;
    if (a.name !== c.name) { c.name = a.name; this.nameEl.textContent = a.name; }
    if (a.glyph !== c.glyph) { c.glyph = a.glyph; this.glyph.textContent = a.glyph; }
    if (a.hp !== c.hp || a.maxHp !== c.max) { c.hp = a.hp; c.max = a.maxHp; this.hp.set(a.maxHp > 0 ? a.hp / a.maxHp : 0); }
    const far = !a.inRange;
    if (a.dead !== c.dead || far !== c.far) {
      c.dead = a.dead; c.far = far;
      toggle(this.el, 'dead', a.dead); toggle(this.el, 'far', far);
      this.tag.textContent = a.dead ? 'Down' : far ? 'Too far' : 'Focus';
    }
    this.chips.set(a.statuses);
    this.cast.set(a.cast);
  }
}
