// The Tailor (Bobbin & Thimble), show-as: costumes sold as pieces, one per slot (prices from the shared data), each
// owned piece marked and the missing ones offered at once; and the Dyes tab as the slot dyes (pick a worn slot, then
// its three channels). A bought piece is a look for its slot at once (the Gear tab's Appearance), once the server says so.
import type { InvOp } from '@sg2/shared';
import type { AppearanceView, TailorCostume } from '../core/lookViews';
import { h } from './dom';
import { drawDyeRows, type LookSend, type LookUi } from './appearance';
import { Acts, btn, money, opBtn } from './sheetKit';
import { ensureLookCss } from './showAsStyle';

export function drawTailorPieces(body: HTMLElement, greeting: string, list: TailorCostume[], here: boolean, acts: Acts, send: (op: InvOp) => void): void {
  ensureLookCss();
  h('div', 'sg-greet', body, `“${greeting}”`);
  h('div', 'sg-gs-hintln', body, 'Costume pieces are yours for every job and change only how you look. Show them from your Gear tab: tap a slot, then Appearance.');
  for (const c of list) {
    const box = h('div', 'sg-tcost' + (c.missing === 0 ? ' cur' : ''), body);
    const top = h('div', 'sg-tcost-top', box);
    const n = h('div', 'sg-row-name', top, c.name);
    if (c.event) h('span', 'sg-badge star', n, '★ Event');
    if (c.missing === 0) h('div', 'sg-owned', top, '✔ All owned');
    for (const p of c.pieces) {
      const r = h('div', 'sg-tpiece', box);
      const mid = h('div', 'sg-row-mid', r);
      h('div', 'sg-lrow-slot', mid, p.slot);
      h('div', 'sg-tpiece-n', mid, p.name);
      if (!p.owned && p.why && !c.event) h('div', 'sg-gs-why', mid, p.why);
      const end = h('div', 'sg-row-end', r);
      if (p.owned) h('div', 'sg-owned', end, '✔ Owned');
      else if (c.event) h('div', 'sg-row-sub', end, 'Event only');
      else {
        const row = h('div', 'sg-tpiece-buy', end);
        const pr = money(row, p.price ?? 0, 'gold');
        if (!p.ok) pr.classList.add('short');
        opBtn(acts, row, 'Buy', { op: 'buyCostume', costume: p.id }, send, p.ok ? 'gold' : '', p.ok && here);
      }
    }
    if (c.missing > 1 && !c.event) {
      const all = h('div', 'sg-card-acts', box);
      const b = opBtn(acts, all, `Buy the ${c.missing} missing · `, { op: 'buyCostume', costume: c.id as never }, send, '', c.ok && here);
      money(b, c.missingPrice, 'gold', '');
      if (c.why && c.missing > 0) h('div', 'sg-gs-why', box, c.why);
    }
  }
}

/** The Tailor's Dyes tab: the worn slots as chips, then the chosen slot's three dye rows. */
export function drawTailorDyes(body: HTMLElement, a: AppearanceView, sel: { slot: string | null }, ui: LookUi, acts: Acts, s: LookSend, redraw: () => void): void {
  ensureLookCss();
  const worn = a.slots.filter((x) => x.worn);
  if (!worn.length) { h('div', 'sg-gs-empty', body, 'Nothing to dye.'); return; }
  if (!sel.slot || !worn.some((x) => x.slot === sel.slot)) sel.slot = worn[0]!.slot;
  h('div', 'sg-gs-hintln', body, 'Dye what each slot shows: three colours, primary, secondary and trim. "Own" gives the piece its own colours back.');
  h('div', 'sg-gs-h', body, 'Which slot');
  const chips = h('div', 'sg-chips2', body);
  for (const x of worn) {
    const c = btn(chips, '', 'sg-dchip' + (x.slot === sel.slot ? ' on' : ''));
    c.style.setProperty('--rc', x.shown?.colour ?? x.worn!.colour);
    for (const d of x.dyes) { const dot = h('i', 'sg-dot' + (d.hex ? '' : ' undyed'), c); if (d.hex) dot.style.setProperty('--dc', d.hex); }
    c.append(x.label);
    c.title = `${x.label}: ${x.shown?.name ?? x.worn!.name}`;
    acts.on(c, () => { sel.slot = x.slot; ui.pick = null; redraw(); });
  }
  const cur = worn.find((x) => x.slot === sel.slot)!;
  const nm = h('div', 'sg-row-name', body, `${cur.label} · ${cur.hidden ? 'hidden' : cur.shown?.name ?? cur.worn!.name}`);
  nm.style.cssText = `--rc:${cur.shown?.colour ?? cur.worn!.colour};margin:10px 2px 0`;
  drawDyeRows(body, cur, a, ui, acts, s, redraw);
}
