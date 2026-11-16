// Show-as on the character sheet (no dressing room): the Gear tab's slot rows (the equipped item and its stats, and
// "Shown as: <look>" when another look shows), the "Show a whole set" and "Show my equipped gear" bar, a slot card's
// Appearance part (show the equipped item, hide where allowed, every unlocked look that fits in one scrolling grid,
// the three dye rows), and the set picker. One tap sends; the slot only changes when the server's `inventory` says
// so (the sheet redraws from it). Plain DOM, text through textContent only.
import type { InvOp } from '@sg2/shared';
import type { CharSheetView } from '../core/gearViews';
import type { AppearanceView, LookOption, SlotAppearance } from '../core/lookViews';
import { opKey } from '../net/inventory';
import { QUEUE_KEY, showOpsFor } from '../net/showAs';
import { h } from './dom';
import { iconUrl } from './itemIcon';
import { Acts, btn, money, tile } from './sheetKit';
import { ensureLookCss } from './showAsStyle';

export const HANGER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7.5a2 2 0 1 1 2-2"/><path d="M12 7.5v1.5L3 16.5c-.8.7-.3 2 .8 2h16.4c1.1 0 1.6-1.3.8-2L12 9"/></svg>';

/** What the sheet keeps between draws for the looks (the card's part, a dye being picked). */
export interface LookUi { part: 'item' | 'look'; pick: { ch: 0 | 1 | 2; dye: number } | null }
export const newLookUi = (): LookUi => ({ part: 'item', pick: null });

export interface LookSend { one: (op: InvOp) => void; many: (ops: InvOp[]) => void }
/** Sends what a tap means: nothing, one op through the gate, or several through the queue. */
const go = (s: LookSend, ops: InvOp[]) => { if (ops.length === 1) s.one(ops[0]!); else if (ops.length > 1) s.many(ops); };
/** A button that sends `ops`; it waits (and ignores taps) while its first op is with the server. */
function opsBtn(acts: Acts, parent: HTMLElement, label: string, ops: InvOp[], s: LookSend, cls: string, enabled: boolean, key?: string): HTMLButtonElement {
  const b = btn(parent, label, cls);
  b.dataset.k = key ?? (ops[0] ? opKey(ops[0]) : '');
  if (!enabled || !ops.length) b.classList.add('off');
  if (acts.pending.has(b.dataset.k)) b.classList.add('wait');
  // the set and clear-all buttons always go through the queue (their wait is the queue's)
  acts.on(b, () => { if (key === QUEUE_KEY) s.many(ops); else go(s, ops); });
  return b;
}

// ───────── the Gear tab ─────────

/** The bar over the slot rows: "Show a whole set" and "Show my equipped gear". */
export function drawLookBar(body: HTMLElement, a: AppearanceView, acts: Acts, s: LookSend, openSets: () => void): void {
  ensureLookCss();
  const hd = h('div', 'sg-gs-h', body, 'Equipment');
  h('small', '', hd, a.changed ? `${a.changed} shown as another look` : 'stats and looks');
  const bar = h('div', 'sg-lbar', body);
  const set = btn(bar, 'Show a whole set', 'sg-lbar-set');
  set.insertAdjacentHTML('afterbegin', HANGER);
  set.dataset.k = QUEUE_KEY;
  if (acts.pending.has(QUEUE_KEY)) set.classList.add('wait');
  if (!a.sets.length) set.classList.add('off');
  acts.on(set, openSets);
  opsBtn(acts, bar, 'Show my equipped gear', a.clearOps, s, '', a.why === null, QUEUE_KEY);
  if (a.why && a.changed) h('div', 'sg-gs-why', body, a.why);
}

/** The eight slot rows: tile, slot, item (tier colour), its stats, and "Shown as" when another look shows; a Look button. */
export function drawSlotRows(body: HTMLElement, v: CharSheetView, a: AppearanceView, sel: string | null, acts: Acts, open: (slot: string, part: 'item' | 'look') => void): void {
  const rows = h('div', 'sg-lrows', body);
  for (const sv of v.slots) {
    const sa = a.slots.find((x) => x.slot === sv.slot)!;
    const r = h('div', 'sg-lrow' + (sel === sv.slot ? ' sel' : '') + (sa.line ? ' shown' : ''), rows);
    const t = tile(r, sv.item, false, false);
    if (!sv.item) t.classList.add('none');
    t.setAttribute('aria-label', `${sv.label}: ${sv.item?.name ?? sv.none ?? 'empty'}`);
    acts.on(t, () => open(sv.slot, 'item'));
    const mid = h('div', 'sg-lrow-mid', r);
    acts.on(mid, () => open(sv.slot, 'item'));
    h('div', 'sg-lrow-slot', mid, sv.label);
    if (sv.item) {
      const n = h('div', 'sg-row-name', mid, sv.item.name);
      n.style.setProperty('--rc', sv.item.colour);
      h('div', 'sg-lrow-stats', mid, sv.item.stats);
    } else h('div', 'sg-row-sub', mid, sv.none ?? 'Nothing worn');
    if (sa.line) {
      const l = h('div', 'sg-lrow-as' + (sa.hidden ? ' hid' : ''), mid);
      l.insertAdjacentHTML('afterbegin', HANGER);
      if (sa.shown) { l.append('Shown as: '); const b = h('b', '', l, sa.shown.name); b.style.setProperty('--rc', sa.shown.colour); }
      else l.append(sa.line);
    }
    if (sa.worn) {
      const lb = btn(r, '', 'sg-lrow-look');
      lb.innerHTML = HANGER;
      h('span', '', lb, 'Look');
      lb.setAttribute('aria-label', `${sv.label} appearance`);
      acts.on(lb, () => open(sv.slot, 'look'));
    }
  }
}

// ───────── a slot card's two parts ─────────

/** "Item" | "Appearance" at the top of a slot card. */
export function drawPartSwitch(box: HTMLElement, ui: LookUi, sa: SlotAppearance | undefined, acts: Acts, redraw: () => void): void {
  ensureLookCss();
  const sw = h('div', 'sg-lparts', box);
  for (const [p, label] of [['item', 'Item'], ['look', 'Appearance']] as const) {
    const b = btn(sw, label, 'sg-lpart' + (ui.part === p ? ' on' : ''));
    b.setAttribute('aria-pressed', String(ui.part === p));
    if (p === 'look' && !sa?.worn) b.classList.add('off');
    acts.on(b, () => { ui.part = p; ui.pick = null; redraw(); });
  }
}

/** The Appearance part: show the equipped item, hide, the unlocked looks (one tap each), the dyes. */
export function drawAppearance(box: HTMLElement, sa: SlotAppearance, a: AppearanceView, ui: LookUi, acts: Acts, s: LookSend, redraw: () => void): void {
  ensureLookCss();
  if (!sa.worn) { h('div', 'sg-gs-empty', box, 'Nothing is worn here, so nothing shows.'); return; }
  const w = h('div', 'sg-lworn', box, 'Equipped: ');
  const n = h('b', '', w, sa.worn.name);
  n.style.setProperty('--rc', sa.worn.colour);
  w.append(' (its stats count, whatever shows)');
  if (a.why) h('div', 'sg-gs-why', box, a.why);
  const ok = a.why === null;
  const row = h('div', 'sg-wrow', box);
  const showOn = !sa.shown && !sa.hidden;
  const show = opsBtn(acts, row, showOn ? '✔ Show equipped item' : 'Show equipped item', sa.showOps, s, 'sg-wopt' + (showOn ? ' on' : ''), ok);
  if (showOn) show.classList.remove('off');
  if (sa.canHide) {
    const hide = opsBtn(acts, row, sa.hidden ? '✔ Hidden' : 'Hide', sa.hideOp ? [sa.hideOp] : [], s, 'sg-wopt' + (sa.hidden ? ' on' : ''), ok);
    if (sa.hidden) hide.classList.remove('off');
  }
  const hd = h('div', 'sg-gs-h', box, 'Looks');
  h('small', '', hd, `${sa.unlocked} of ${sa.total} looks unlocked`);
  if (!sa.options.length) h('div', 'sg-gs-empty', box, 'No other look for this slot yet. Every piece you hold unlocks its look for good; the Tailor sells costume pieces.');
  else {
    const g = h('div', 'sg-lgrid', box);
    for (const o of sa.options) lookCell(g, o, sa, ok, acts, s);
  }
  drawDyeRows(box, sa, a, ui, acts, s, redraw);
}

function lookCell(g: HTMLElement, o: LookOption, sa: SlotAppearance, ok: boolean, acts: Acts, s: LookSend): void {
  const ops = showOpsFor(sa, o.id);
  const c = btn(g, '', 'sg-lcell' + (o.on ? ' on' : ''));
  c.style.setProperty('--rc', o.colour);
  c.dataset.k = ops[0] ? opKey(ops[0]) : '';
  if (acts.pending.has(c.dataset.k)) c.classList.add('wait');
  if (!ok && !o.on) c.classList.add('off');
  c.setAttribute('aria-pressed', String(o.on));
  const ic = h('i', 'sg-lcell-ic', c);
  const url = iconUrl(o.icon);
  if (url) ic.style.backgroundImage = `url(${url})`;
  const t = h('span', 'sg-lcell-t', c);
  h('b', '', t, o.event ? `★ ${o.name}` : o.name);
  h('small', '', t, o.on ? 'Showing' : o.source);
  if (!o.on) acts.on(c, () => go(s, ops));
}

/** Three swatch rows (primary, secondary, trim) with "Own colours" first; a pick asks to pay, at the Tailor only. */
export function drawDyeRows(box: HTMLElement, sa: SlotAppearance, a: AppearanceView, ui: LookUi, acts: Acts, s: LookSend, redraw: () => void): void {
  ensureLookCss();
  const hd = h('div', 'sg-gs-h', box, 'Dyes');
  h('small', '', hd, `${a.dye.price} gold a change`);
  if (a.dye.why) h('div', 'sg-gs-why', box, a.dye.why);
  const can = a.dye.why === null;
  for (const d of sa.dyes) {
    const lab = h('div', 'sg-ldye-lab', box);
    h('span', '', lab, d.label);
    const now = h('span', '', lab);
    const dot = h('i', 'sg-dot' + (d.hex ? '' : ' undyed'), now);
    if (d.hex) dot.style.setProperty('--dc', d.hex);
    now.append(d.dye === 0 ? 'Own colours' : d.name);
    const sw = h('div', 'sg-ldye', box);
    for (const p of a.dye.palette) {
      const picked = ui.pick?.ch === d.ch && ui.pick.dye === p.id;
      const b = h('button', 'sg-swatch' + (p.hex ? '' : ' undyed') + (d.dye === p.id ? ' cur' : '') + (picked ? ' sel' : '') + (can ? '' : ' off'), sw) as HTMLButtonElement;
      b.type = 'button';
      if (p.hex) b.style.setProperty('--dc', p.hex);
      const name = p.id === 0 ? 'Own colours' : p.name;
      b.title = name; b.setAttribute('aria-label', `${d.label}: ${name}`);
      if (p.id === 0) h('span', '', b, 'Own');
      if (can && d.dye !== p.id) acts.on(b, () => { ui.pick = picked ? null : { ch: d.ch, dye: p.id }; redraw(); });
    }
    if (ui.pick?.ch === d.ch && can) {
      const pk = a.dye.palette[ui.pick.dye]!;
      const bar = h('div', 'sg-dyebar', box);
      const txt = h('div', '', bar, `${d.label} → `);
      const dd = h('i', 'sg-dot' + (pk.hex ? '' : ' undyed'), txt);
      if (pk.hex) dd.style.setProperty('--dc', pk.hex);
      txt.append(` ${pk.id === 0 ? 'Own colours' : pk.name}`);
      const op: InvOp = { op: 'dyeSlot', slot: sa.slot, ch: d.ch, dye: pk.id };
      const b = opsBtn(acts, bar, '', [op], s, 'gold', true);
      b.textContent = 'Dye · ';
      money(b, a.dye.price, 'gold', '');
      b.dataset.k = opKey(op);
    }
  }
}

// ───────── "Show a whole set" ─────────

export function drawSetPicker(box: HTMLElement, a: AppearanceView, acts: Acts, s: LookSend): void {
  ensureLookCss();
  h('div', 'sg-gs-h', box, 'Show a whole set');
  h('div', 'sg-gs-hintln', box, 'Each unlocked piece goes to its slot; slots without one stay as they are. Your gear and its stats stay.');
  if (a.why) h('div', 'sg-gs-why', box, a.why);
  const all = h('div', 'sg-card-acts', box);
  opsBtn(acts, all, a.changed ? 'Show my equipped gear' : '✔ Showing my equipped gear', a.clearOps, s, '', a.why === null, QUEUE_KEY);
  const rows = h('div', 'sg-rows', box);
  for (const o of a.sets) {
    const r = h('div', 'sg-row' + (o.ops.length ? '' : ' cur'), rows);
    const mid = h('div', 'sg-row-mid', r);
    const n = h('div', 'sg-row-name', mid, o.name);
    n.style.setProperty('--rc', o.colour);
    h('div', 'sg-row-sub', mid, `${o.kind === 'set' ? 'Set' : 'Costume'} · ${o.pieces} of ${o.of} · ${o.slots}`);
    const end = h('div', 'sg-row-end', r);
    if (!o.ops.length) h('div', 'sg-owned', end, '✔ Shown');
    else opsBtn(acts, end, 'Show', o.ops, s, 'gold', a.why === null, QUEUE_KEY);
  }
}
