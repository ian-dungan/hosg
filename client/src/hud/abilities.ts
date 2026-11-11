// Ability bar: 5 slots + weapon swap + loadout. Touch = arc in the bottom-right corner,
// desktop = centred bottom row. Buttons fire on pointerdown; each pointer is independent (multi-touch).
import type { AbilityDef, HudEvent, HudState, WeaponId } from '../core/contracts';
import { h, toggle, ICONS } from './dom';

/** Touch arc offsets (px at scale 1) from the corner anchor; y negative = up. */
const ARC: [number, number][] = [[-96, 0], [-68, -68], [0, -96], [-162, -59], [-99, -141]];
const KIND_C: Record<AbilityDef['kind'], string> = { damage: '#EC6A4C', heal: '#8FD16A', defence: '#479AF2', utility: '#3FB0A6' };

interface Slot { el: HTMLElement; glyph: HTMLElement; name: HTMLElement; sec: HTMLElement; id: string; cd: number; sTxt: string; usable: boolean; def: AbilityDef | null }

export class AbilityBar {
  readonly el: HTMLElement;
  private slots: Slot[] = [];
  private swap: HTMLElement;
  private swapIcon: HTMLElement;
  private swapLbl: HTMLElement;
  private weapon = '';
  private empty = -1;
  private tip: HTMLElement;
  private tipTimer = 0;
  constructor(parent: HTMLElement, private emit: (e: HudEvent) => void) {
    this.el = h('div', 'sg-abar', parent);
    this.swap = this.button('sg-ab-swap', 'Q', () => emit({ type: 'swapWeapon' }));
    this.swapIcon = h('span', 'sg-ab-icon', this.swap);
    this.swapLbl = h('span', 'sg-ab-name', this.swap);
    h('span', 'sg-ab-swapmark', this.swap).innerHTML = ICONS.swap;
    for (let i = 0; i < 5; i++) {
      const el = this.button('sg-ab-skill', String(i + 1), () => this.press(i));
      el.style.setProperty('--px', String(ARC[i][0]));
      el.style.setProperty('--py', String(ARC[i][1]));
      const glyph = h('span', 'sg-ab-glyph', el);
      const name = h('span', 'sg-ab-name', el);
      h('span', 'sg-ab-cd', el);
      const sec = h('span', 'sg-ab-sec', el);
      this.slots.push({ el, glyph, name, sec, id: '', cd: -1, sTxt: '', usable: true, def: null });
      el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.showTip(i, 260); });
      el.addEventListener('pointerleave', () => this.hideTip());
    }
    const lo = this.button('sg-ab-loadout', 'L', () => emit({ type: 'openLoadout' }));
    h('span', 'sg-ab-icon', lo).innerHTML = ICONS.book;
    h('span', 'sg-ab-name', lo, 'Loadout');
    this.tip = h('div', 'sg-tip', parent);
  }
  private button(cls: string, key: string, fire: () => void): HTMLElement {
    const el = h('div', 'sg-ab sg-ctl ' + cls, this.el);
    h('span', 'sg-key', el, key);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      el.classList.add('down');
      fire();
      if (e.pointerType !== 'mouse') {
        const i = this.slots.findIndex((s) => s.el === el);
        if (i >= 0) this.showTip(i, 480);
      }
    });
    const up = () => { el.classList.remove('down'); this.hideTip(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    return el;
  }
  /** Called for both taps and keys 1-5. */
  press(i: number): void {
    const s = this.slots[i];
    if (s && (s.cd > 0 || !s.usable)) s.el.animate([{ translate: '0 0' }, { translate: '-4px 0' }, { translate: '4px 0' }, { translate: '0 0' }], { duration: 200 });
    this.emit({ type: 'ability', slot: i });
  }
  flash(el: 'swap' | 'loadout' | number): void {
    const t = typeof el === 'number' ? this.slots[el]?.el : el === 'swap' ? this.swap : this.el.querySelector<HTMLElement>('.sg-ab-loadout');
    t?.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 220 });
  }
  private showTip(i: number, delay: number): void {
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => {
      const s = this.slots[i]; const d = s?.def; if (!d) return;
      this.tip.textContent = '';
      h('div', 'sg-tip-name', this.tip, d.name);
      const meta = [d.weapon === 'any' ? 'Any weapon' : d.weapon === 'blade' ? 'Blade' : 'Bow', `${d.cooldown}s cooldown`];
      if (d.castTime > 0) meta.push(`${d.castTime}s cast`);
      if (d.range > 0) meta.push(`${d.range} m`);
      h('div', 'sg-tip-meta', this.tip, meta.join(' · '));
      h('div', 'sg-tip-desc', this.tip, d.desc);
      const r = s.el.getBoundingClientRect();
      const w = Math.min(260, window.innerWidth - 24);
      const x = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
      this.tip.style.width = w + 'px';
      this.tip.style.left = x + 'px';
      this.tip.style.top = r.top - 10 + 'px';
      this.tip.classList.add('on');
    }, delay);
  }
  private hideTip(): void { clearTimeout(this.tipTimer); this.tip.classList.remove('on'); }

  update(slots: HudState['slots'], weapon: WeaponId): void {
    const empty = slots.length === 0 ? 1 : 0;
    if (empty !== this.empty) { this.empty = empty; toggle(this.el, 'off', !!empty); }
    if (weapon !== this.weapon) {
      this.weapon = weapon;
      this.swapIcon.innerHTML = ICONS[weapon] ?? '';
      this.swapLbl.textContent = weapon === 'blade' ? 'Blade' : 'Bow';
    }
    for (let i = 0; i < 5; i++) {
      const s = this.slots[i]; const d = slots[i];
      toggle(s.el, 'off', !d);
      if (!d) continue;
      if (d.ability.id !== s.id) {
        s.id = d.ability.id; s.def = d.ability;
        s.glyph.textContent = d.ability.glyph; s.name.textContent = d.ability.name;
        s.el.style.setProperty('--kc', KIND_C[d.ability.kind] ?? '#F2B742');
      }
      const cd = Math.max(0, d.cdRemaining);
      if (cd !== s.cd) {
        const was = s.cd;
        s.cd = cd;
        const frac = d.ability.cooldown > 0 ? Math.min(1, cd / d.ability.cooldown) : 0;
        s.el.style.setProperty('--cd', frac.toFixed(3));
        const txt = cd <= 0 ? '' : cd < 1 ? cd.toFixed(1) : String(Math.ceil(cd));
        if (txt !== s.sTxt) { s.sTxt = txt; s.sec.textContent = txt; }
        toggle(s.el, 'cooling', cd > 0);
        if (was > 0 && cd === 0) s.el.animate([{ boxShadow: '0 0 0 0 rgba(255,214,110,.9)' }, { boxShadow: '0 0 0 14px rgba(255,214,110,0)' }], { duration: 500 });
      }
      if (d.usable !== s.usable) { s.usable = d.usable; toggle(s.el, 'unusable', !d.usable); }
    }
  }
}
