// Unit frames: player, target (+ boss bar), party. Every update() diffs against a cache.
import type { HudBar, HudState, StatusId, WeaponId } from '../core/contracts';
import { h, toggle, ICONS } from './dom';

const STATUS: Record<StatusId, { g: string; label: string; c: string }> = {
  soaked: { g: '≈', label: 'Soaked', c: '#3FB0A6' },
  burning: { g: '✷', label: 'Burning', c: '#EC6A4C' },
  marked: { g: '◎', label: 'Marked', c: '#F2B742' },
  stunned: { g: '✦', label: 'Stunned', c: '#b9a6f2' },
  staggered: { g: '✧', label: 'Staggered', c: '#FCB380' },
  guard: { g: '◆', label: 'Guard', c: '#479AF2' },
  regen: { g: '+', label: 'Regen', c: '#8FD16A' },
  slowed: { g: '↓', label: 'Slowed', c: '#9aa6c8' },
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
      h('b', '', c, s.g);
      if (this.labels) h('span', '', c, s.label);
    }
  }
}

class CastBar {
  readonly el: HTMLElement;
  private bar: Bar;
  private name = '';
  private nameEl: HTMLElement;
  private on = false;
  private intr = false;
  constructor(parent: HTMLElement, cls: string) {
    this.el = h('div', 'sg-cast ' + cls, parent);
    this.nameEl = h('div', 'sg-cast-name', this.el);
    this.bar = new Bar(this.el, 'sg-cast-bar', false);
  }
  set(c: { name: string; frac: number; interruptible?: boolean } | null): void {
    const on = !!c;
    if (on !== this.on) { this.on = on; toggle(this.el, 'on', on); }
    if (!c) return;
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
  private chips: Chips;
  readonly cast: CastBar;
  private c = { name: '', level: -1, hp: -1, max: -1, weapon: '' as WeaponId | '', low: false };
  constructor(parent: HTMLElement, castParent: HTMLElement) {
    this.el = h('div', 'sg-pf', parent);
    const em = h('div', 'sg-pf-emblem', this.el);
    this.lvl = h('span', '', em);
    const main = h('div', 'sg-pf-main', this.el);
    const top = h('div', 'sg-pf-top', main);
    this.nameEl = h('div', 'sg-pf-name', top);
    this.weaponEl = h('div', 'sg-pf-weapon', top);
    this.hp = new Bar(main, 'sg-hp-player');
    this.chips = new Chips(main, false);
    this.cast = new CastBar(castParent, 'sg-cast-player');
  }
  update(p: HudState['player']): void {
    const c = this.c;
    if (p.name !== c.name) { c.name = p.name; this.nameEl.textContent = p.name; }
    if (p.level !== c.level) { c.level = p.level; this.lvl.textContent = String(p.level); }
    if (p.weapon !== c.weapon) { c.weapon = p.weapon; this.weaponEl.innerHTML = ICONS[p.weapon] ?? ''; this.weaponEl.title = p.weapon; }
    if (p.hp !== c.hp || p.maxHp !== c.max) {
      c.hp = p.hp; c.max = p.maxHp;
      const f = p.maxHp > 0 ? p.hp / p.maxHp : 0;
      this.hp.set(f, hpText(p.hp, p.maxHp));
      const low = f < 0.3 && f > 0;
      if (low !== c.low) { c.low = low; toggle(this.el, 'low', low); }
    }
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
      this.bChips.set(t.statuses);
      this.bCast.set(t.cast);
    } else {
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
