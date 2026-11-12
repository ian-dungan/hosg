// The job board: every starting job (glyph, name, role, level and xp, weapon, its trait, its five buttons and
// its four picks) and the jobs still to unlock, shown locked. A full-screen sheet on phones (56 px rows), a
// 420 px panel on desktop. Tapping a row opens it; "Become a …" chooses that job (the server decides whether
// it may change here: outside a town the sheet says so at the top, and the button stays on). Esc or J closes it.
// Every name, line and number comes from the shared job and ability data.
import {
  FUTURE_JOBS, JOBS, JOB_IDS, MELEE_REACH, REASON_JOB_NOT_HERE, WEAPONS, XP_TO_NEXT, JOB_LEVEL_CAP, jobSwitchAt, levelForXp, totalTo, zoneDef,
  type AbilityId, type FutureJobId, type JobData, type JobId, type JobsView, type ZoneId,
} from '@sg2/shared';
import type { AbilityDef, JobBoardView } from '../core/contracts';
import { ABILITY_DEFS } from '../combat/abilityDefs';
import { h, ICONS } from './dom';

// ───────────────────────── pure (tested) ─────────────────────────

const ROLE: Record<string, string> = { damage: 'Damage', tank: 'Tank', healer: 'Healer', hybrid: 'Hybrid' };
/** A role tag as a word. */
export const roleLabel = (r: string): string => ROLE[r] ?? r;

/** "a Ninja", "an Archer": for "Become a …" with a job name from the data. */
export function article(name: string): string { return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`; }

/** The disc colour behind a job's glyph (PALETTE colours), and the glyph's own colour on it. */
export const JOB_COLOR: Record<JobId, { bg: string; fg: string }> = {
  warrior: { bg: '#EC6A4C', fg: '#fff6e6' }, ranger: { bg: '#8FD16A', fg: '#1f3a12' }, paladin: { bg: '#479AF2', fg: '#fff6e6' },
  dark_knight: { bg: '#5D4675', fg: '#ffe2a0' }, ninja: { bg: '#3FB0A6', fg: '#0f2a28' }, white_mage: { bg: '#FFFAF3', fg: '#2a3a6a' },
  black_mage: { bg: '#1754D1', fg: '#ffcf5a' },
};

/** An ability's meta line: "Instant" or "Cast 1.2 s" (Charged Shot: "Hold"), its cooldown and reach. */
export function abilityMeta(d: AbilityDef): string {
  const cast = d.id === 'charged_shot' ? `Hold ${d.castTime} s` : d.castTime > 0 ? `Cast ${d.castTime} s` : 'Instant';
  const reach = d.range <= 0 ? 'Self' : d.range <= MELEE_REACH ? 'Melee' : `${d.range} m`;
  return `${cast} · ${d.cooldown} s cooldown · ${reach}`;
}

/**
 * The job board from the server's `jobs` (null before it arrives: every job at level 1, `opts.current` as the
 * current one) in `zone`; at `opts.pos` when given (a sanctuary counts there). `opts.jobs` stands in for JOBS
 * in tests. The note is REASON_JOB_NOT_HERE where jobs cannot change, else null.
 */
export function jobBoardView(
  jobs: JobsView | null, zone: ZoneId,
  opts: { current?: JobId; pos?: { x: number; z: number }; jobs?: Readonly<Record<JobId, JobData>> } = {},
): JobBoardView {
  const table = opts.jobs ?? JOBS;
  const def = zoneDef(zone);
  const canSwitch = opts.pos ? jobSwitchAt(def, opts.pos.x, opts.pos.z) : def.town;
  const defs = (ids: readonly AbilityId[]) => ids.map((id) => ABILITY_DEFS[id]);
  return {
    current: jobs?.current ?? opts.current ?? 'warrior',
    canSwitch, note: canSwitch ? null : REASON_JOB_NOT_HERE,
    rows: JOB_IDS.map((id) => {
      const j = table[id], rec = jobs?.jobs[id];
      const xp = rec?.xp ?? 0, level = levelForXp(xp);
      return {
        id, name: j.name, glyph: j.glyph, role: roleLabel(j.role), level,
        xpFrac: level >= JOB_LEVEL_CAP ? 1 : (xp - totalTo(level)) / XP_TO_NEXT[level - 1]!,
        weaponName: WEAPONS[j.weapon].name, traitName: j.trait.name, trait: j.trait.desc,
        bar: defs(j.bar), picks: defs(j.pool), chosen: [...(rec?.picks ?? j.picks.solo)],
      };
    }),
    locked: (Object.keys(FUTURE_JOBS) as FutureJobId[]).map((id) => {
      const f = FUTURE_JOBS[id];
      return { id, name: f.name, glyph: f.glyph, role: roleLabel(f.role), weaponName: f.weaponName, unique: f.unique };
    }),
  };
}

// ───────────────────────── the sheet (DOM) ─────────────────────────

/** An ability card: its glyph on its job's disc, name, meta line and description. */
export function abilityCard(parent: HTMLElement, d: AbilityDef, cls = ''): HTMLElement {
  const c = h('div', 'sg-jb-ab ' + cls, parent);
  const g = h('div', 'sg-jb-abg', c, d.glyph);
  g.dataset.kind = d.kind;
  const body = h('div', 'sg-jb-abb', c);
  h('div', 'sg-jb-abn', body, d.name);
  h('div', 'sg-jb-abm', body, abilityMeta(d));
  h('div', 'sg-jb-abd', body, d.desc);
  return c;
}

/**
 * Opens the sheet in `layer`; resolves with the job chosen, or null when closed. `push` registers its key
 * handler as the top-most modal and returns the function that removes it.
 */
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five'];
const countWord = (n: number) => WORDS[n] ?? String(n);

export function openJobBoard(
  layer: HTMLElement, v: JobBoardView, push: (kind: string, keys: (e: KeyboardEvent) => boolean) => () => void,
  show: (el: HTMLElement) => void, close: (el: HTMLElement) => void, register?: (cancel: () => void) => void,
): Promise<JobId | null> {
  return new Promise((resolve) => {
    const root = h('div', 'sg-jobs sg-ctl', layer);
    const panel = h('div', 'sg-jb-panel', root);
    const head = h('div', 'sg-jb-head', panel);
    const titles = h('div', 'sg-jb-titles', head);
    h('div', 'sg-jb-title', titles, 'Guild Board');
    h('div', 'sg-jb-sub', titles, 'Choose your job');
    const x = h('div', 'sg-jb-close', head);
    x.innerHTML = ICONS.close;
    if (v.note) h('div', 'sg-jb-note', panel, v.note);
    const list = h('div', 'sg-jb-list', panel);
    let open: HTMLElement | null = null;
    let answered = false;
    const done = (id: JobId | null) => { if (answered) return; answered = true; off(); close(root); resolve(id); };
    register?.(() => done(null));
    for (const r of v.rows) {
      const row = h('div', 'sg-jb-row' + (r.id === v.current ? ' cur' : ''), list);
      row.dataset.job = r.id;
      const top = h('div', 'sg-jb-top', row);
      const disc = h('div', 'sg-jb-glyph', top, r.glyph);
      disc.style.setProperty('--jb', JOB_COLOR[r.id].bg); disc.style.setProperty('--jf', JOB_COLOR[r.id].fg);
      const mid = h('div', 'sg-jb-mid', top);
      const line = h('div', 'sg-jb-line', mid);
      h('span', 'sg-jb-name', line, r.name);
      h('span', 'sg-jb-role', line, r.role);
      if (r.id === v.current) h('span', 'sg-jb-cur', line, 'Current');
      h('div', 'sg-jb-pitch', mid, r.trait);
      const right = h('div', 'sg-jb-right', top);
      h('div', 'sg-jb-lv', right, `Lv ${r.level}`);
      const xp = h('div', 'sg-jb-xp', right);
      h('i', '', xp).style.transform = `scaleX(${r.xpFrac.toFixed(3)})`;
      h('div', 'sg-jb-wpn', right, r.weaponName);
      const more = h('div', 'sg-jb-more', row);
      const tr = h('div', 'sg-jb-trait', more);
      h('b', '', tr, r.traitName);
      tr.append(' ' + r.trait);
      h('div', 'sg-jb-h', more, `Buttons 1–${r.bar.length}`);
      const bar = h('div', 'sg-jb-abs', more);
      for (const d of r.bar) abilityCard(bar, d);
      h('div', 'sg-jb-h', more, `Picks · ${countWord(r.chosen.length)} at a time`);
      const picks = h('div', 'sg-jb-abs', more);
      for (const d of r.picks) {
        const c = abilityCard(picks, d, r.chosen.includes(d.id) ? 'picked' : '');
        if (r.chosen.includes(d.id)) h('span', 'sg-jb-badge', c, 'Picked');
      }
      const act = h('div', 'sg-btn sg-btn-gold sg-jb-go', more, r.id === v.current ? 'Change picks' : `Become ${article(r.name)}`);
      act.addEventListener('click', (e) => { e.stopPropagation(); done(r.id); });
      top.addEventListener('click', () => {
        if (open && open !== row) open.classList.remove('open');
        row.classList.toggle('open');
        open = row.classList.contains('open') ? row : null;
        if (open) requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      });
    }
    if (v.locked.length) h('div', 'sg-jb-h sg-jb-lockh', list, 'Unlock on your travels');
    for (const f of v.locked) {
      const row = h('div', 'sg-jb-row locked', list);
      const top = h('div', 'sg-jb-top', row);
      h('div', 'sg-jb-glyph', top, f.glyph);
      const mid = h('div', 'sg-jb-mid', top);
      const line = h('div', 'sg-jb-line', mid);
      h('span', 'sg-jb-name', line, f.name);
      h('span', 'sg-jb-role', line, f.role);
      h('span', 'sg-jb-lock', line, 'Locked');
      h('div', 'sg-jb-pitch', mid, f.unique);
      const right = h('div', 'sg-jb-right', top);
      h('div', 'sg-jb-wpn', right, f.weaponName);
    }
    // the current job opens by itself, so its buttons and picks show at once
    const cur = list.querySelector<HTMLElement>('.sg-jb-row.cur');
    if (cur) { cur.classList.add('open'); open = cur; }
    x.addEventListener('click', () => done(null));
    root.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === root) done(null); });
    const off = push('jobs', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyJ') { if (!e.repeat) done(null); return true; }
      return e.code !== 'Tab';
    });
    show(root);
  });
}

/** The board's CSS (injected with the HUD's). */
export const JOBS_CSS = /* css */ `
.sg-jobs{z-index:30;display:flex;justify-content:flex-end;align-items:stretch;padding:calc(var(--st) + 12px) calc(var(--sr) + 12px) calc(var(--sb) + 12px) 12px;
  background:rgba(14,14,36,.42);touch-action:manipulation}
.sg-jb-panel{display:flex;flex-direction:column;width:420px;max-width:100%;border-radius:18px;overflow:hidden;
  background:linear-gradient(180deg,rgba(26,30,64,.95),rgba(16,18,42,.97));box-shadow:0 0 0 1px rgba(255,214,140,.32),0 16px 50px rgba(0,0,0,.4);
  transform:translateX(24px);transition:transform .35s cubic-bezier(.2,.8,.2,1)}
.sg-jobs.in .sg-jb-panel{transform:none}
.sg-jb-head{display:flex;align-items:center;gap:10px;padding:14px 12px 8px 18px}
.sg-jb-titles{flex:1;min-width:0}
.sg-jb-title{font:italic 600 26px/1.1 var(--serif);color:var(--goldl)}
.sg-jb-sub{font-size:13px;opacity:.75}
.sg-jb-close{flex:none;width:48px;height:48px;padding:13px;border-radius:50%;color:var(--cream);background:rgba(255,255,255,.1);cursor:pointer}
.sg-jb-note{margin:0 14px 8px;padding:10px 14px;border-radius:12px;font-size:14px;font-weight:600;line-height:1.35;
  color:#ffe8c4;background:rgba(236,106,76,.22);box-shadow:inset 0 0 0 1px rgba(255,170,130,.5)}
.sg-jb-list{flex:1;min-height:0;overflow:auto;touch-action:pan-y;padding:4px 10px 14px;display:flex;flex-direction:column;gap:6px;overscroll-behavior:contain}
.sg-jb-row{border-radius:14px;background:rgba(255,246,230,.06);box-shadow:inset 0 0 0 1px rgba(255,226,160,.16);flex:none}
.sg-jb-row.cur{box-shadow:inset 0 0 0 2px var(--gold2);background:rgba(242,183,66,.12)}
.sg-jb-top{display:flex;align-items:center;gap:10px;min-height:56px;padding:6px 10px;cursor:pointer}
.sg-jb-glyph{flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;
  font:700 21px/1 var(--serif);font-variant-emoji:text;text-shadow:none;color:var(--jf,#fff6e6);background:var(--jb,#4a4a6a);
  box-shadow:inset 0 0 0 2px rgba(255,255,255,.35),0 2px 6px rgba(0,0,0,.3)}
.sg-jb-mid{flex:1;min-width:0}
.sg-jb-line{display:flex;align-items:center;gap:6px;min-width:0}
.sg-jb-name{font:600 17px/1.15 var(--serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-jb-role,.sg-jb-cur,.sg-jb-lock{flex:none;font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:2px 6px;border-radius:6px;background:rgba(255,246,230,.13)}
.sg-jb-cur{background:var(--gold2);color:#3a2508;text-shadow:none}
.sg-jb-lock{background:rgba(160,150,190,.3)}
.sg-jb-pitch{font-size:12px;line-height:1.3;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.sg-jb-row.open .sg-jb-pitch{display:none}
.sg-jb-right{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:3px;width:74px}
.sg-jb-lv{font:700 13px var(--sans);color:var(--goldl)}
.sg-jb-xp{width:64px;height:5px;border-radius:3px;overflow:hidden;background:rgba(10,10,26,.7)}
.sg-jb-xp i{display:block;height:100%;transform-origin:0 50%;background:linear-gradient(90deg,#d99a24,#ffd36a)}
.sg-jb-wpn{font-size:10.5px;opacity:.7;white-space:nowrap}
.sg-jb-more{display:none;padding:2px 12px 12px}
.sg-jb-row.open .sg-jb-more{display:block}
.sg-jb-trait{font-size:13px;line-height:1.4;padding:8px 10px;border-radius:10px;background:rgba(255,246,230,.07)}
.sg-jb-trait b{color:var(--goldl)}
.sg-jb-h{margin:10px 2px 5px;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--gold2)}
.sg-jb-lockh{margin-top:12px}
.sg-jb-abs{display:flex;flex-direction:column;gap:5px}
.sg-jb-ab{position:relative;display:flex;gap:9px;padding:7px 9px;border-radius:10px;background:rgba(10,12,32,.35)}
.sg-jb-ab.picked{box-shadow:inset 0 0 0 1.5px rgba(255,207,90,.8)}
.sg-jb-abg{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font:700 17px/1 var(--serif);font-variant-emoji:text;
  background:rgba(24,26,58,.95);box-shadow:inset 0 0 0 2px #F2B742}
.sg-jb-abg[data-kind=damage]{box-shadow:inset 0 0 0 2px #EC6A4C}.sg-jb-abg[data-kind=heal]{box-shadow:inset 0 0 0 2px #8FD16A}
.sg-jb-abg[data-kind=defence]{box-shadow:inset 0 0 0 2px #479AF2}.sg-jb-abg[data-kind=utility]{box-shadow:inset 0 0 0 2px #3FB0A6}
.sg-jb-abb{min-width:0;flex:1}
.sg-jb-abn{font:600 14.5px var(--serif)}
.sg-jb-abm{font-size:10.5px;opacity:.65;margin:1px 0 2px}
.sg-jb-abd{font-size:12px;line-height:1.35;opacity:.9}
.sg-jb-badge{position:absolute;right:8px;top:7px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:2px 6px;border-radius:6px;background:var(--gold2);color:#3a2508;text-shadow:none}
.sg-jb-go{display:flex;width:100%;margin-top:12px;min-height:52px;font-size:17px}
.sg-jb-row.locked{opacity:.62}
.sg-jb-row.locked .sg-jb-top{cursor:default}
.sg-jb-row.locked .sg-jb-glyph{background:rgba(90,86,120,.6);color:#d8d2ee;filter:grayscale(.4)}
@media (max-width:700px),(max-height:500px){
  /* the open row's button stays in reach at the bottom of the sheet while its abilities scroll past */
  .sg-jb-row.open .sg-jb-go{position:sticky;bottom:6px;z-index:1;box-shadow:0 -10px 18px 4px rgba(18,20,46,.92),0 4px 14px rgba(0,0,0,.35)}
  .sg-jobs{padding:0;background:none}
  .sg-jb-panel{width:100%;border-radius:0;padding:var(--st) var(--sr) var(--sb) var(--sl);transform:translateY(24px)}
  .sg-jb-title{font-size:22px}
}
`;
