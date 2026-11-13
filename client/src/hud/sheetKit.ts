// The parts the gear sheets share: the frame (head, tabs, note, scrolling body), a click registry (one listener per
// sheet, rebuilt with each draw), buttons that show a wait while their op is with the server, item tiles, and the item
// card's blocks (stats, set progress, the comparison). Plain DOM, text through textContent only.
import type { InvOp, JobId } from '@sg2/shared';
import type { Comparison, ItemView, SetProgress } from '../core/gearViews';
import { opKey } from '../net/inventory';
import { h, ICONS } from './dom';
import { iconUrl } from './itemIcon';
import { JOB_COLOR } from './jobs';

/** Click actions by index (data-a), rebuilt on every draw: one delegated listener per sheet, nothing to unhook. */
export class Acts {
  private list: (() => void)[] = [];
  pending: ReadonlySet<string> = new Set();
  reset(): void { this.list.length = 0; }
  /** Makes `el` run `f` when tapped. */
  on(el: HTMLElement, f: () => void): HTMLElement { el.dataset.a = String(this.list.length); this.list.push(f); return el; }
  /** Runs the action under a click inside `root`; true when one ran. */
  run(target: EventTarget | null, root: HTMLElement): boolean {
    const el = (target as HTMLElement | null)?.closest?.('[data-a]') as HTMLElement | null;
    if (!el || !root.contains(el) || el.classList.contains('off') || el.classList.contains('wait')) return false;
    const f = this.list[Number(el.dataset.a)];
    if (!f) return false;
    f();
    return true;
  }
}

/** The card's close button (an X, 48 px). */
export function closeBtn(parent: HTMLElement): HTMLButtonElement {
  const b = h('button', 'sg-gs-btn sg-card-close', parent) as HTMLButtonElement;
  b.type = 'button';
  b.setAttribute('aria-label', 'Close');
  b.innerHTML = ICONS.close;
  return b;
}
export function btn(parent: HTMLElement, label: string, cls = ''): HTMLButtonElement {
  const b = h('button', `sg-gs-btn ${cls}`.trim(), parent, label);
  b.type = 'button';
  return b;
}
/** A button that sends `op`: it shows a wait (and ignores taps) while the same op is with the server. */
export function opBtn(acts: Acts, parent: HTMLElement, label: string, op: InvOp, send: (op: InvOp) => void, cls = '', enabled = true): HTMLButtonElement {
  const b = btn(parent, label, cls);
  const key = opKey(op);
  b.dataset.k = key;
  if (!enabled) b.classList.add('off');
  if (acts.pending.has(key)) b.classList.add('wait');
  acts.on(b, () => send(op));
  return b;
}
/** Marks every op button in `root` waiting or not (the server answered, or a new op went out). */
export function markPending(root: HTMLElement, pending: ReadonlySet<string>): void {
  root.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => { b.classList.toggle('wait', pending.has(b.dataset.k!)); });
}

/** An item tile: its icon on the tier colour, the glyphs of the jobs that wear it. */
export function tile(parent: HTMLElement, v: ItemView | null, sel = false, jobs = true): HTMLElement {
  const t = h('button', 'sg-tile', parent) as HTMLButtonElement;
  t.type = 'button';
  if (!v) { t.classList.add('empty'); t.setAttribute('aria-label', 'Empty'); return t; }
  t.style.setProperty('--rc', v.colour);
  t.style.setProperty('--rg', `${v.colour}55`);
  const url = iconUrl(v.icon);
  if (url) t.style.backgroundImage = `url(${url})`;
  if (v.icon.tier >= 3 || v.icon.named) t.classList.add('t3');
  if (sel) t.classList.add('sel');
  t.setAttribute('aria-label', v.name);
  t.title = v.name;
  if (jobs && v.worn.length) {
    const j = h('div', 'sg-tile-jobs', t);
    for (const w of v.worn.slice(0, 3)) jobDot(j, w.job, w.glyph);
  }
  return t;
}
function jobDot(parent: HTMLElement, job: JobId, glyph: string): void {
  const s = h('span', '', parent, glyph);
  s.style.setProperty('--jb', JOB_COLOR[job].bg); s.style.setProperty('--jf', JOB_COLOR[job].fg);
}

/** "Wickthread 3/6" with both bonus lines, lit when active. */
export function setBlock(parent: HTMLElement, s: SetProgress): void {
  const b = h('div', 'sg-set', parent);
  b.style.setProperty('--sc', s.colour);
  const n = h('div', 'sg-set-name', b, s.name);
  h('small', '', n, `${s.pieces}/${s.of} pieces`);
  for (const l of s.bonuses) {
    const line = h('div', 'sg-set-line' + (l.on ? ' on' : ''), b);
    h('b', '', line, `(${l.at})`);
    line.append(' ' + l.text);
  }
}

/** The summary with its plus parts green and minus parts red. */
function colouredSummary(parent: HTMLElement, s: string): void {
  const parts = s.split(', ');
  parts.forEach((p, k) => {
    if (k) parent.append(', ');
    h('span', p.startsWith('+') ? 'up' : p.startsWith('−') ? 'down' : '', parent, p);
  });
}
/** The comparison: the summary ("+3 Power, −12 hp"), what it replaces, the kit's totals before → after, set changes. */
export function cmpBlock(parent: HTMLElement, c: Comparison, compact = false): void {
  const b = h('div', 'sg-cmp', parent);
  colouredSummary(h('div', 'sg-cmp-sum', b), c.summary);
  if (c.replaces) h('div', 'sg-cmp-was', b, `Instead of ${c.replaces}`);
  if (!compact) {
    const g = h('div', 'sg-cmp-rows', b);
    for (const l of c.lines) {
      h('span', '', g, l.label);
      h('span', '', g, `${l.before} → ${l.after}`);
      h('span', l.up === true ? 'up' : l.up === false ? 'down' : 'same', g, l.delta || '=');
    }
  }
  for (const s of c.sets) h('div', 'sg-cmp-set ' + (s.startsWith('Gains') ? 'gain' : 'lose'), b, s);
}
/** A one-line comparison for a list row. */
export function cmpLine(parent: HTMLElement, c: Comparison): void {
  colouredSummary(h('div', 'sg-row-cmp', parent), c.summary);
}

/** The card's top: the tile, the name in its tier colour, tier, item level and kind, and its own stats. */
export function cardTop(parent: HTMLElement, v: ItemView): void {
  const top = h('div', 'sg-card-top', parent);
  tile(top, v);
  const t = h('div', 'sg-card-ttl', top);
  const n = h('div', 'sg-card-name', t, v.name);
  n.style.setProperty('--rc', v.colour);
  h('div', 'sg-card-meta', t, `${v.tierLabel} · item level ${v.ilvl}`);
  h('div', 'sg-card-meta', t, v.kindLabel);
  h('div', 'sg-card-stats', parent, v.stats);
  if (v.namedLine) h('div', 'sg-named', parent, v.namedLine);
  if (v.set) setBlock(parent, v.set);
  if (v.worn.length) {
    const w = h('div', 'sg-card-worn', parent, 'Worn by ');
    for (const j of v.worn) {
      const c = h('span', 'sg-chipj', w);
      const i = h('i', '', c, j.glyph);
      i.style.setProperty('--jb', JOB_COLOR[j.job].bg); i.style.setProperty('--jf', JOB_COLOR[j.job].fg);
      c.append(j.name);
    }
  }
}

/** A coin or a Seal and an amount. */
export function money(parent: HTMLElement, n: number, kind: 'gold' | 'seals', cls = 'sg-price'): HTMLElement {
  const p = h('span', cls, parent);
  h('i', kind === 'gold' ? 'sg-coin' : 'sg-seal', p);
  p.append(String(n));
  return p;
}

/** The sheet frame: the dim backdrop, the panel, the head row, the tab row, a note, the scrolling body. */
export interface Frame {
  root: HTMLElement; panel: HTMLElement; head: HTMLElement; tabs: HTMLElement; note: HTMLElement; body: HTMLElement; close: HTMLElement;
}
export function frame(layer: HTMLElement, cls: string): Frame {
  const root = h('div', `sg-gs sg-ctl ${cls}`, layer);
  const panel = h('div', 'sg-gs-panel', root);
  const head = h('div', 'sg-gs-head', panel);
  const close = h('button', 'sg-gs-x', null);
  (close as HTMLButtonElement).type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = ICONS.close;
  const tabs = h('div', 'sg-gs-tabs', panel);
  tabs.setAttribute('role', 'tablist');
  const note = h('div', 'sg-gs-note', panel);
  note.hidden = true;
  const body = h('div', 'sg-gs-body', panel);
  return { root, panel, head, tabs, note, body, close };
}
export function setNote(f: Frame, text: string | null, calm = false): void {
  f.note.hidden = !text;
  f.note.textContent = text ?? '';
  f.note.classList.toggle('calm', calm);
}
