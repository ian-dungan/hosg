// The action buttons: 5 ability slots, Dodge, Jump (touch), the job board (Jobs) and loadout (the picks).
// Touch: a cluster under the right thumb, anchored at the bottom-right corner (an arc in landscape and on tablets,
// two columns on narrow portrait phones, so it never reaches the joystick's zone). Desktop: a centred bottom row.
// Buttons fire on pointerdown (ability presses, Dodge, Jump); an ability's release (pointerup) is its own event,
// for Charged Shot. Each pointer is independent (multi-touch).
import { JOBS, type JobId } from '@sg2/shared';
import type { AbilityDef, HudEvent, HudState } from '../core/contracts';
import { h, toggle, ICONS } from './dom';
import { JOB_COLOR, abilityMeta } from './jobs';

/** Touch offsets (px at scale 1) from the corner anchor, y negative = up: [slot 1..5, dodge, jump, jobs, loadout]. */
export const CLUSTER_ARC: [number, number][] = [[-96, 0], [-68, -68], [0, -96], [-162, -59], [-99, -141], [-196, 6], [0, 0], [0, -178], [-62, -214]];
/** Phones in landscape: three short rows (the screen is low and wide). */
export const CLUSTER_ROWS: [number, number][] = [[-92, 0], [-86, -84], [0, -90], [-172, -80], [-86, -168], [-178, 0], [0, 0], [0, -170], [-164, -160]];
/**
 * Narrow portrait phones: a compact grid under the right thumb, read left to right and bottom to top: Dodge and
 * Jump on the bottom row, slots 1–3 above them, 4–5 above 2–3. It stays within the bottom 30% of the screen and right
 * of the joystick's zone (38vw). Jobs and Picks are small, in the top row left of the gear (style.ts): their
 * entries here are unused.
 */
export const CLUSTER_COLUMNS: [number, number][] = [[-138, -70], [-69, -70], [0, -70], [-69, -140], [0, -140], [-69, 0], [0, 0], [0, 0], [0, 0]];
const KIND_C: Record<AbilityDef['kind'], string> = { damage: '#EC6A4C', heal: '#8FD16A', defence: '#479AF2', utility: '#3FB0A6' };

interface Slot { el: HTMLElement; glyph: HTMLElement; name: HTMLElement; sec: HTMLElement; id: string; cd: number; sTxt: string; usable: boolean; casting: boolean; def: AbilityDef | null }

export class AbilityBar {
  readonly el: HTMLElement;
  private slots: Slot[] = [];
  private jobsBtn: HTMLElement;
  private jobsGlyph: HTMLElement;
  private loadoutBtn: HTMLElement;
  private dodgeBtn: HTMLElement;
  private dodgePipsEl: HTMLElement;
  private dodgePips: HTMLElement[] = [];
  private jumpBtn: HTMLElement;
  private job = '';
  private empty = -1;
  private tip: HTMLElement;
  private tipTimer = 0;
  private c = { dodge: '', locked: false, dodgeOn: false };
  constructor(parent: HTMLElement, private emit: (e: HudEvent) => void, dodgeDir: () => { x: number; y: number } | null) {
    this.el = h('div', 'sg-abar', parent);
    this.jobsBtn = this.button('sg-ab-jobs', 'J', () => emit({ type: 'openJobs' }));
    this.jobsGlyph = h('span', 'sg-ab-jobglyph', this.jobsBtn);
    h('span', 'sg-ab-name', this.jobsBtn, 'Jobs');
    for (let i = 0; i < 5; i++) {
      const el = this.button('sg-ab-skill', String(i + 1), () => this.press(i), () => emit({ type: 'abilityUp', slot: i }));
      const glyph = h('span', 'sg-ab-glyph', el);
      const name = h('span', 'sg-ab-name', el);
      h('span', 'sg-ab-cd', el);
      const sec = h('span', 'sg-ab-sec', el);
      this.slots.push({ el, glyph, name, sec, id: '', cd: -1, sTxt: '', usable: true, casting: false, def: null });
      el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.showTip(i, 260); });
      el.addEventListener('pointerleave', () => this.hideTip());
    }
    this.dodgeBtn = this.button('sg-ab-dodge', '⇧', () => emit({ type: 'dodge', dir: dodgeDir() }));
    h('span', 'sg-ab-ring', this.dodgeBtn);
    h('span', 'sg-ab-glyph', this.dodgeBtn, '↯');
    h('span', 'sg-ab-name', this.dodgeBtn, 'Dodge');
    this.dodgePipsEl = h('span', 'sg-ab-pips', this.dodgeBtn);
    this.jumpBtn = this.button('sg-ab-jump', 'Space', () => emit({ type: 'jump' }));
    h('span', 'sg-ab-name', this.jumpBtn, 'Jump');
    this.loadoutBtn = this.button('sg-ab-loadout', 'L', () => emit({ type: 'openLoadout' }));
    h('span', 'sg-ab-icon', this.loadoutBtn).innerHTML = ICONS.book;
    h('span', 'sg-ab-name', this.loadoutBtn, 'Picks');
    // cluster offsets as CSS variables: the layout's media queries pick the set
    const all = [...this.slots.map((s) => s.el), this.dodgeBtn, this.jumpBtn, this.jobsBtn, this.loadoutBtn];
    all.forEach((el, i) => {
      el.style.setProperty('--ax', String(CLUSTER_ARC[i][0])); el.style.setProperty('--ay', String(CLUSTER_ARC[i][1]));
      el.style.setProperty('--cx', String(CLUSTER_COLUMNS[i][0])); el.style.setProperty('--cy', String(CLUSTER_COLUMNS[i][1]));
      el.style.setProperty('--lx', String(CLUSTER_ROWS[i][0])); el.style.setProperty('--ly', String(CLUSTER_ROWS[i][1]));
    });
    this.tip = h('div', 'sg-tip', parent);
  }
  private button(cls: string, key: string, fire: () => void, release?: () => void): HTMLElement {
    const el = h('div', 'sg-ab sg-ctl ' + cls, this.el);
    h('span', 'sg-key', el, key);
    let held: number | null = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (held !== null) return; // a second finger on the same button
      held = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      el.classList.add('down');
      fire();
      if (e.pointerType !== 'mouse') {
        const i = this.slots.findIndex((s) => s.el === el);
        if (i >= 0) this.showTip(i, 480);
      }
    });
    const up = (e: PointerEvent) => {
      if (held !== e.pointerId) return;
      held = null;
      el.classList.remove('down'); this.hideTip();
      release?.();
    };
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
  flash(el: 'jobs' | 'loadout' | 'dodge' | number): void {
    const t = typeof el === 'number' ? this.slots[el]?.el : el === 'jobs' ? this.jobsBtn : el === 'dodge' ? this.dodgeBtn : this.loadoutBtn;
    t?.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 220 });
  }
  private showTip(i: number, delay: number): void {
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => {
      const s = this.slots[i]; const d = s?.def; if (!d) return;
      this.tip.textContent = '';
      h('div', 'sg-tip-name', this.tip, d.name);
      h('div', 'sg-tip-meta', this.tip, `${JOBS[d.job]?.name ?? ''} · ${abilityMeta(d)}`);
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

  update(slots: HudState['slots'], player: HudState['player']): void {
    const empty = slots.length === 0 ? 1 : 0;
    if (empty !== this.empty) { this.empty = empty; toggle(this.el, 'off', !!empty); }
    const job = player.job?.id ?? '';
    if (job !== this.job) {
      this.job = job;
      this.jobsGlyph.textContent = player.job?.glyph ?? '';
      const c = job ? JOB_COLOR[job as JobId] : null;
      this.el.style.setProperty('--jb', c?.bg ?? '#3b3f7a');
      this.el.style.setProperty('--jf', c?.fg ?? '#fff6e6');
      this.jobsBtn.title = player.job ? `Jobs · ${player.job.name}` : 'Jobs';
    }
    const locked = !!player.jobLocked || !!player.dead;
    if (locked !== this.c.locked) { this.c.locked = locked; toggle(this.jobsBtn, 'locked', locked); toggle(this.loadoutBtn, 'locked', locked); }
    const dodgeOn = !!player.dodge;
    if (dodgeOn !== this.c.dodgeOn) { this.c.dodgeOn = dodgeOn; toggle(this.el, 'has-dodge', dodgeOn); }
    if (player.dodge) {
      const d = player.dodge, key = `${d.charges}/${d.max}|${d.refill.toFixed(2)}|${player.dead ? 1 : 0}`;
      if (key !== this.c.dodge) {
        this.c.dodge = key;
        while (this.dodgePips.length < d.max) this.dodgePips.push(h('i', '', this.dodgePipsEl));
        while (this.dodgePips.length > d.max) this.dodgePips.pop()!.remove();
        this.dodgePips.forEach((p, i) => toggle(p, 'on', i < d.charges));
        this.dodgeBtn.style.setProperty('--rf', d.charges >= d.max ? '1' : d.refill.toFixed(3));
        toggle(this.dodgeBtn, 'unusable', d.charges <= 0 || !!player.dead);
      }
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
        const txt = cd <= 0.05 ? '' : cd < 1 ? cd.toFixed(1) : String(Math.ceil(cd));
        if (txt !== s.sTxt) { s.sTxt = txt; s.sec.textContent = txt; }
        toggle(s.el, 'cooling', cd > 0);
        if (was > 0.6 && cd === 0) s.el.animate([{ boxShadow: '0 0 0 0 rgba(255,214,110,.9)' }, { boxShadow: '0 0 0 14px rgba(255,214,110,0)' }], { duration: 500 });
      }
      if (d.usable !== s.usable) { s.usable = d.usable; toggle(s.el, 'unusable', !d.usable); }
      const casting = !!player.cast && player.cast.name === d.ability.name;
      if (casting !== s.casting) { s.casting = casting; toggle(s.el, 'casting', casting); }
    }
  }
}
