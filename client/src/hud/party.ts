// Parties in the HUD: the party frames (one row per other member), the invite card (Accept / Decline, never
// modal), and the party sheet (members; for the leader, Kick and Make leader and an invite by name; Leave).
// Pure parts first (tested): the frames' rows from the party view and the room's adventurers, and the sheet's
// view. Names are always set as text, never as HTML.
import { ALLY_RANGE, JOBS, RANGE_FUZZ, isJobId, zoneDef, type JobId, type PartyView, type ZoneId } from '@sg2/shared';
import type { PartyAction, PartyBar, PartySheetView } from '../core/contracts';
import { h, toggle, ICONS } from './dom';
import { Bar } from './frames';
import { JOB_COLOR } from './jobs';

// ───────────────────────── pure (tested) ─────────────────────────

/** A party member standing in this room, as its PlayerState shows it (hp, dead and job are fresher there than in the view). */
export interface MemberHere { x: number; z: number; hp: number; maxHp: number; dead?: boolean; job?: string; searing?: number; level?: number }

/** Where a member is, as its frame says: null here; "Offline"; else the zone's name. */
export function zoneLabel(online: boolean, zone: ZoneId | null, here: boolean): string | null {
  if (here) return null;
  if (!online || !zone) return 'Offline';
  return zoneDef(zone).name;
}

/**
 * The party frames' rows: every member but `me`, in join order. A member in this room (eid ≥ 0 and `here(eid)`
 * finds it) reads hp, dead, job, level and Searing from its PlayerState, and is in range within ALLY_RANGE of
 * `pos`; any other reads the view (relayed at 2 Hz) and is dimmed with where it is. Rows are written into `out`
 * (entries reused: nothing allocated per frame once warm) and returned.
 */
export function partyBars(
  view: PartyView | null, me: string, here: (eid: number) => MemberHere | null | undefined, pos: { x: number; z: number }, out: PartyBar[] = [],
): PartyBar[] {
  let n = 0;
  if (view) {
    for (const m of view.members) {
      if (m.name === me) continue;
      const p = m.eid >= 0 ? here(m.eid) ?? null : null;
      const b = (out[n] ??= { name: '', hp: 0, maxHp: 1, statuses: [], eid: -1, dead: false, leader: false, online: true, zoneLabel: null, inRange: false, glyph: '', job: null, level: 1, searing: 0 });
      n++;
      const job = p?.job ?? m.job;
      b.name = m.name; b.eid = p ? m.eid : -1; b.leader = m.leader; b.online = m.online;
      b.hp = p ? p.hp : m.hp; b.maxHp = Math.max(1, p ? p.maxHp : m.maxHp);
      b.dead = p ? !!p.dead : m.dead;
      b.searing = p ? p.searing ?? 0 : m.searing;
      b.level = p?.level ?? m.level;
      b.job = isJobId(job) ? job : null;
      b.glyph = b.job ? JOBS[b.job].glyph : '?';
      b.zoneLabel = zoneLabel(m.online, m.zone, !!p);
      b.inRange = !!p && !b.dead && Math.hypot(p.x - pos.x, p.z - pos.z) <= ALLY_RANGE + RANGE_FUZZ;
      b.statuses.length = 0;
    }
  }
  out.length = n;
  return out;
}

/** The party sheet's view: every member (self marked), whether `me` leads, and whether `me` may invite. */
export function partySheetView(view: PartyView | null, me: string, canInvite: boolean): PartySheetView {
  const members = (view?.members ?? []).map((m) => ({
    name: m.name, leader: m.leader, online: m.online, zone: zoneLabel(m.online, m.zone, false), job: isJobId(m.job) ? JOBS[m.job].name : m.job,
    level: m.level, glyph: isJobId(m.job) ? JOBS[m.job].glyph : '?', me: m.name === me,
  }));
  return { members, amLeader: members.some((m) => m.me && m.leader), canInvite };
}

/** The line on the invite card. */
export const inviteLine = (from: string, size: number) => `${from} invites you to a party (${size}/4)`;

// ───────────────────────── the party frames ─────────────────────────

interface Row {
  el: HTMLElement; disc: HTMLElement; glyph: HTMLElement; name: HTMLElement; crown: HTMLElement; where: HTMLElement; bar: Bar; flames: HTMLElement;
  c: { name: string; glyph: string; job: string; hp: number; max: number; dead: boolean; dim: boolean; leader: boolean; where: string; searing: number; far: boolean };
}

/** One row per other member: a job disc, the name (a crown for the leader), hp, a skull when down, Searing flames, where it is. */
export class PartyFrames {
  readonly el: HTMLElement;
  private rows: Row[] = [];
  private count = -1;
  private list: readonly PartyBar[] = [];
  constructor(parent: HTMLElement, onTap: (bar: PartyBar) => void) {
    this.el = h('div', 'sg-party', parent);
    this.el.addEventListener('pointerdown', (e) => {
      const row = (e.target as HTMLElement).closest('.sg-party-row') as HTMLElement | null;
      if (!row) return;
      e.preventDefault(); e.stopPropagation();
      const i = this.rows.findIndex((r) => r.el === row), b = this.list[i];
      if (!b) return;
      row.animate([{ transform: 'scale(.94)' }, { transform: 'none' }], { duration: 160 });
      onTap(b);
    });
  }
  update(list: readonly PartyBar[]): void {
    this.list = list;
    if (list.length !== this.count) {
      this.count = list.length;
      while (this.rows.length < list.length) {
        const el = h('div', 'sg-party-row sg-ctl', this.el);
        const disc = h('div', 'sg-pr-disc', el);
        const glyph = h('b', '', disc);
        h('i', 'sg-pr-skull', disc, '☠');
        const main = h('div', 'sg-pr-main', el);
        const top = h('div', 'sg-pr-top', main);
        const crown = h('span', 'sg-pr-crown', top, '♛');
        const name = h('span', 'sg-pr-name', top);
        const flames = h('span', 'sg-pr-flames', top);
        const bar = new Bar(main, 'sg-hp-party', false);
        const where = h('div', 'sg-pr-where', main);
        this.rows.push({ el, disc, glyph, name, crown, where, bar, flames, c: { name: '', glyph: '', job: '', hp: -1, max: -1, dead: false, dim: false, leader: false, where: '', searing: -1, far: false } });
      }
      this.rows.forEach((r, i) => toggle(r.el, 'off', i >= list.length));
      toggle(this.el, 'on', list.length > 0);
    }
    for (let i = 0; i < list.length; i++) {
      const m = list[i], r = this.rows[i], c = r.c;
      if (c.name !== m.name) { c.name = m.name; r.name.textContent = m.name; r.el.title = m.name; }
      if (c.glyph !== m.glyph) { c.glyph = m.glyph; r.glyph.textContent = m.glyph; }
      const job = m.job ?? '';
      if (c.job !== job) {
        c.job = job;
        const col = m.job ? JOB_COLOR[m.job as JobId] : null;
        r.disc.style.setProperty('--jb', col?.bg ?? '#3b3f7a'); r.disc.style.setProperty('--jf', col?.fg ?? '#fff6e6');
      }
      if (c.hp !== m.hp || c.max !== m.maxHp) { c.hp = m.hp; c.max = m.maxHp; r.bar.set(m.maxHp > 0 ? m.hp / m.maxHp : 0); r.el.style.setProperty('--hpf', (m.maxHp > 0 ? m.hp / m.maxHp : 0).toFixed(3)); }
      if (c.dead !== m.dead) { c.dead = m.dead; toggle(r.el, 'dead', m.dead); }
      const dim = m.zoneLabel !== null;
      if (c.dim !== dim) { c.dim = dim; toggle(r.el, 'away', dim); }
      const far = !dim && !m.inRange && !m.dead;
      if (c.far !== far) { c.far = far; toggle(r.el, 'far', far); }
      if (c.leader !== m.leader) { c.leader = m.leader; toggle(r.el, 'leader', m.leader); }
      const where = m.zoneLabel ?? '';
      if (c.where !== where) { c.where = where; r.where.textContent = where; }
      if (c.searing !== m.searing) { c.searing = m.searing; r.flames.textContent = '♨'.repeat(Math.max(0, Math.min(5, m.searing))); r.flames.title = m.searing ? `Searing ×${m.searing}` : ''; }
    }
  }
}

// ───────────────────────── the invite card ─────────────────────────

/** Invite cards: one at a time (the next waits its turn), Accept / Decline, gone when the invite times out. */
export class InviteCards {
  private queue: { from: string; size: number; until: number; done: (ok: boolean) => void }[] = [];
  private el: HTMLElement;
  private text: HTMLElement;
  private timer = 0;
  private showing: (typeof this.queue)[number] | null = null;
  constructor(parent: HTMLElement) {
    this.el = h('div', 'sg-invite sg-ctl', parent);
    h('div', 'sg-invite-kicker', this.el, 'Party invite');
    this.text = h('div', 'sg-invite-text', this.el);
    const row = h('div', 'sg-invite-btns', this.el);
    const yes = h('button', 'sg-btn sg-btn-gold sg-invite-yes', row, 'Accept');
    const no = h('button', 'sg-btn sg-invite-no', row, 'Decline');
    yes.type = no.type = 'button';
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    yes.addEventListener('click', () => this.answer(true));
    no.addEventListener('click', () => this.answer(false));
  }
  open(from: string, size: number, seconds: number): Promise<boolean> {
    return new Promise((done) => {
      const had = this.queue.find((q) => q.from === from);
      if (had) {
        // the same inviter again (a refreshed invite): one card, a new clock; both answers are the card's
        const first = had.done;
        had.size = size; had.until = performance.now() + seconds * 1000; had.done = (ok) => { first(ok); done(ok); };
        if (had === this.showing) this.render();
        return;
      }
      this.queue.push({ from, size, until: performance.now() + seconds * 1000, done });
      if (!this.showing) this.next();
    });
  }
  close(from: string | null): void {
    for (const q of [...this.queue]) if (from === null || q.from === from) { this.queue.splice(this.queue.indexOf(q), 1); q.done(false); }
    if (this.showing && !this.queue.includes(this.showing)) { this.showing = null; this.next(); }
  }
  /** The card's Accept / Decline (a key: the open party sheet does not take them). */
  answer(ok: boolean): void {
    const q = this.showing;
    if (!q) return;
    this.queue.splice(this.queue.indexOf(q), 1);
    this.showing = null;
    q.done(ok);
    this.next();
  }
  /** A card is showing. */
  get showingCard(): boolean { return this.showing !== null; }
  private render(): void { if (this.showing) this.text.textContent = inviteLine(this.showing.from, this.showing.size); }
  private next(): void {
    clearInterval(this.timer); this.timer = 0;
    const now = performance.now();
    while (this.queue.length && this.queue[0].until <= now) this.queue.shift()!.done(false);
    this.showing = this.queue[0] ?? null;
    toggle(this.el, 'on', !!this.showing);
    if (!this.showing) return;
    this.render();
    this.el.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    this.timer = window.setInterval(() => {
      if (this.showing && performance.now() >= this.showing.until) { const q = this.showing; this.queue.splice(this.queue.indexOf(q), 1); this.showing = null; q.done(false); this.next(); }
    }, 500);
  }
}

// ───────────────────────── the party sheet ─────────────────────────

/** The party sheet: full-screen on phones, a 380 px panel on desktop. Esc (or P) closes it. */
export function openPartySheet(
  layer: HTMLElement, v: PartySheetView, push: (kind: string, keys: (e: KeyboardEvent) => boolean) => () => void,
  show: (el: HTMLElement) => void, close: (el: HTMLElement) => void, register?: (cancel: () => void) => void,
): Promise<PartyAction | null> {
  return new Promise((resolve) => {
    const root = h('div', 'sg-psheet sg-ctl', layer);
    const panel = h('div', 'sg-ps-panel', root);
    const head = h('div', 'sg-ps-head', panel);
    const titles = h('div', 'sg-ps-titles', head);
    h('div', 'sg-ps-title', titles, 'Party');
    h('div', 'sg-ps-sub', titles, v.members.length ? `${v.members.length} of 4` : 'Adventure together: up to 4');
    const x = h('button', 'sg-ps-close', head);
    x.type = 'button'; x.innerHTML = ICONS.close; x.setAttribute('aria-label', 'Close');
    let answered = false;
    const done = (a: PartyAction | null) => { if (answered) return; answered = true; off(); close(root); resolve(a); };
    register?.(() => done(null));
    const list = h('div', 'sg-ps-list', panel);
    if (!v.members.length) h('div', 'sg-ps-empty', list, 'You are not in a party. Tap another adventurer and choose Invite, or invite one by name below.');
    for (const m of v.members) {
      const row = h('div', 'sg-ps-row' + (m.me ? ' me' : '') + (m.online ? '' : ' away'), list);
      h('div', 'sg-ps-glyph', row, m.glyph);
      const mid = h('div', 'sg-ps-mid', row);
      const line = h('div', 'sg-ps-line', mid);
      if (m.leader) h('span', 'sg-pr-crown', line, '♛');
      h('span', 'sg-ps-name', line, m.name + (m.me ? ' (you)' : ''));
      h('div', 'sg-ps-meta', mid, `${m.job} · Lv ${m.level}${m.zone ? ' · ' + m.zone : ''}`);
      if (v.amLeader && !m.me) {
        const acts = h('div', 'sg-ps-acts', row);
        const lead = h('button', 'sg-btn sg-ps-act', acts, 'Make leader');
        const kick = h('button', 'sg-btn sg-ps-act sg-ps-kick', acts, 'Kick');
        lead.type = kick.type = 'button';
        lead.addEventListener('click', () => done({ kind: 'lead', name: m.name }));
        kick.addEventListener('click', () => done({ kind: 'kick', name: m.name }));
      }
    }
    let input: HTMLInputElement | null = null;
    if (v.canInvite) {
      const form = h('form', 'sg-ps-invite', panel);
      input = h('input', 'sg-ps-input', form);
      Object.assign(input, { type: 'text', maxLength: 16, placeholder: 'Invite by name', autocomplete: 'off', enterKeyHint: 'send' });
      const go = h('button', 'sg-btn sg-btn-gold sg-ps-go', form, 'Invite');
      go.type = 'submit';
      form.addEventListener('submit', (e) => { e.preventDefault(); const n = input!.value.trim(); if (n) done({ kind: 'invite', name: n }); });
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); });
    } else if (v.members.length) h('div', 'sg-ps-note', panel, 'Only the party leader can invite.');
    const foot = h('div', 'sg-ps-foot', panel);
    if (v.members.length) {
      const leave = h('button', 'sg-btn sg-ps-leave', foot, 'Leave party');
      leave.type = 'button';
      leave.addEventListener('click', () => done({ kind: 'leave' }));
    }
    const shut = h('button', 'sg-btn', foot, 'Close');
    shut.type = 'button';
    shut.addEventListener('click', () => done(null));
    x.addEventListener('click', () => done(null));
    root.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === root) done(null); });
    const off = push('party', (e) => { if (e.code === 'Escape' || e.code === 'KeyP') done(null); return true; });
    show(root);
  });
}

export const PARTY_CSS = /* css */ `
/* ───────── party frames ───────── */
.sg-party{display:none;flex-direction:column;gap:6px;padding-left:16px}
.sg-party.on{display:flex}
.sg-party-row{position:relative;display:flex;align-items:center;gap:8px;width:230px;min-height:48px;padding:4px 10px 4px 4px;border-radius:24px 12px 12px 24px;
  background:linear-gradient(90deg,rgba(18,22,48,.58),rgba(18,22,48,.2));box-shadow:inset 0 0 0 1px rgba(63,176,166,.45)}
.sg-party-row.off{display:none}
.sg-party-row.away{opacity:.55;filter:grayscale(.6)}
.sg-party-row.far{box-shadow:inset 0 0 0 1px rgba(63,176,166,.18)}
.sg-party-row.dead{box-shadow:inset 0 0 0 1.5px rgba(236,106,76,.8)}
.sg-pr-disc{position:relative;flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--jb,#3b3f7a);
  box-shadow:inset 0 0 0 2px rgba(255,255,255,.35)}
.sg-pr-disc b{font:700 19px/1 var(--serif);font-variant-emoji:text;color:var(--jf,#fff);text-shadow:none}
.sg-pr-skull{display:none;position:absolute;inset:0;border-radius:50%;place-items:center;font-style:normal;font-size:22px;color:#ffd2c6;background:rgba(40,10,20,.72)}
.sg-party-row.dead .sg-pr-skull{display:grid}
.sg-pr-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.sg-pr-top{display:flex;align-items:center;gap:4px;min-width:0}
.sg-pr-name{flex:1;min-width:0;font:600 13px var(--serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-pr-crown{display:none;flex:none;font-size:12px;color:var(--gold2)}
.sg-party-row.leader .sg-pr-crown,.sg-ps-line .sg-pr-crown{display:inline}
.sg-pr-flames{flex:none;font-size:11px;letter-spacing:-1px;color:#ff9a4c;text-shadow:0 0 4px rgba(255,120,40,.8)}
.sg-pr-flames:empty{display:none}
.sg-pr-where{font-size:10.5px;font-weight:600;color:var(--goldl);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-pr-where:empty{display:none}
.sg-party-row .sg-hp-party{height:7px}
/* phones: a strip of small tiles under the player frame (portrait and short landscape screens) */
@media (max-width:700px),(max-height:500px){
  .sg-party{flex-direction:row;gap:4px;padding-left:0;width:min(250px,calc(100vw - 2 * var(--g) - 64px))}
  .sg-party-row{flex:1 1 0;min-width:0;width:auto;gap:4px;padding:4px 6px 4px 4px;border-radius:24px 10px 10px 24px}
  .sg-pr-disc{width:30px;height:30px}
  .sg-pr-disc b{font-size:15px}
  .sg-pr-skull{font-size:17px}
  .sg-pr-name{font-size:11px}
  .sg-pr-crown{font-size:10px}
  .sg-pr-flames{font-size:9px}
  .sg-pr-where{font-size:9px}
  .sg-party-row .sg-hp-party{height:5px}
}

/* ───────── the party button and the invite card ───────── */
.sg-party-btn{position:absolute;top:calc(var(--st) + var(--g));right:calc(var(--sr) + var(--g) + 56px);display:none;width:48px;height:48px;padding:11px;border:0;border-radius:50%;
  color:var(--goldl);background:rgba(16,18,42,.5);box-shadow:inset 0 0 0 1px rgba(255,226,160,.35)}
.sg-social .sg-party-btn{display:block}
.sg-party-btn.inparty{color:#7fe0d6;box-shadow:inset 0 0 0 1.5px rgba(63,176,166,.9)}
.sg-party-btn i{position:absolute;right:-2px;top:-2px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;font:800 11px/18px var(--sans);font-style:normal;
  color:#3a2508;background:var(--gold2);text-shadow:none;display:none}
.sg-party-btn.invited i{display:block}
.sg-invite{position:absolute;top:calc(var(--st) + var(--g));left:calc(var(--sl) + var(--g) + 320px);width:340px;display:none;flex-direction:column;gap:8px;
  padding:12px 14px 14px;border-radius:16px;background:linear-gradient(180deg,rgba(20,52,58,.92),rgba(16,18,42,.94));
  box-shadow:0 0 0 1.5px rgba(63,176,166,.85),0 8px 26px rgba(0,0,0,.35);z-index:5}
.sg-invite.on{display:flex}
.sg-invite-kicker{font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#7fe0d6}
.sg-invite-text{font:600 16px/1.3 var(--serif);overflow-wrap:anywhere}
.sg-invite-btns{display:flex;gap:10px}
.sg-invite-btns .sg-btn{flex:1;min-width:0;min-height:56px;padding:0 12px}
@media (max-width:700px) and (orientation:portrait){
  .sg-party-btn{top:calc(var(--st) + var(--g) + 242px);right:calc(var(--sr) + var(--g) + 2px)}
  .sg-invite{left:calc(var(--sl) + var(--g));top:calc(var(--st) + var(--g) + 60px);width:calc(100% - 2 * var(--g) - 64px)}
}
@media (max-height:500px){
  .sg-invite{left:calc(var(--sl) + var(--g) + 232px);width:min(320px,calc(100% - 2 * var(--g) - 360px))}
}

/* ───────── the party sheet ───────── */
.sg-psheet{display:flex;align-items:center;justify-content:center;padding:calc(var(--st) + 12px) calc(var(--sr) + 12px) calc(var(--sb) + 12px) calc(var(--sl) + 12px);
  background:rgba(14,14,36,.5);touch-action:manipulation}
.sg-ps-panel{display:flex;flex-direction:column;width:380px;max-width:100%;max-height:100%;border-radius:18px;overflow:hidden;
  background:linear-gradient(180deg,rgba(26,30,64,.95),rgba(16,18,42,.97));box-shadow:0 0 0 1px rgba(63,176,166,.5),0 16px 50px rgba(0,0,0,.4)}
.sg-ps-head{display:flex;align-items:center;gap:10px;padding:14px 14px 8px 18px}
.sg-ps-titles{flex:1}
.sg-ps-title{font:italic 600 24px var(--serif);color:#9fe8de}
.sg-ps-sub{font-size:12.5px;opacity:.75}
.sg-ps-close{flex:none;width:48px;height:48px;padding:12px;border:0;border-radius:50%;color:var(--cream);background:rgba(255,255,255,.1);cursor:pointer}
.sg-ps-list{flex:1;min-height:0;overflow:auto;touch-action:pan-y;padding:4px 14px 10px;display:flex;flex-direction:column;gap:8px}
.sg-ps-empty,.sg-ps-note{font-size:13.5px;line-height:1.4;opacity:.85;padding:4px 18px}
.sg-ps-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;min-height:56px;padding:8px 10px;border-radius:12px;background:rgba(255,246,230,.06);box-shadow:inset 0 0 0 1px rgba(63,176,166,.3)}
.sg-ps-row.me{box-shadow:inset 0 0 0 1.5px rgba(242,183,66,.6)}
.sg-ps-row.away{opacity:.6}
.sg-ps-glyph{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font:700 19px var(--serif);font-variant-emoji:text;background:rgba(24,26,58,.9);box-shadow:inset 0 0 0 2px #3FB0A6}
.sg-ps-mid{flex:1;min-width:120px}
.sg-ps-line{display:flex;align-items:center;gap:5px}
.sg-ps-name{font:600 16px var(--serif);overflow-wrap:anywhere}
.sg-ps-meta{font-size:12px;opacity:.75}
.sg-ps-acts{display:flex;gap:8px;width:100%}
.sg-ps-act{flex:1;min-width:0;padding:0 10px;font-size:14px}
.sg-ps-kick{color:#ffd2c6;box-shadow:inset 0 0 0 1.5px rgba(236,106,76,.6)}
.sg-ps-invite{display:flex;gap:8px;padding:6px 14px 10px}
.sg-ps-input{flex:1;min-width:0;min-height:48px;padding:0 14px;border:0;border-radius:12px;outline:none;font:500 16px var(--sans);color:var(--cream);
  background:rgba(16,18,42,.78);box-shadow:inset 0 0 0 2px rgba(63,176,166,.6);-webkit-user-select:text;user-select:text}
.sg-ps-go{min-width:0;padding:0 18px}
.sg-ps-foot{display:flex;gap:10px;padding:12px 14px calc(12px + var(--sb));border-top:1px solid rgba(255,226,160,.15)}
.sg-ps-foot .sg-btn{flex:1;min-width:0}
.sg-ps-leave{color:#ffd2c6;box-shadow:inset 0 0 0 1.5px rgba(236,106,76,.6)}
@media (max-width:700px){
  .sg-psheet{padding:0}
  .sg-ps-panel{width:100%;height:100%;max-height:none;border-radius:0;padding-top:var(--st)}
}
`;
