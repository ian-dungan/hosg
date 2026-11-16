// The Wardrobe tab: the current job's six saved outfits with their fixed labels (never free text). Save the current
// look in an empty place (pick a label), Wear one (free, anywhere out of a fight), Overwrite one (asks first; the
// label can change). No preview: an outfit is what the slots show, and wearing it changes the adventurer at once.
import type { InvOp } from '@sg2/shared';
import type { AppearanceView } from '../core/lookViews';
import { h } from './dom';
import { Acts, btn, opBtn } from './sheetKit';
import { ensureLookCss } from './showAsStyle';

/** The place being saved or overwritten and the label picked for it. */
export interface OutfitUi { edit: number | null; label: number | null }
export const newOutfitUi = (): OutfitUi => ({ edit: null, label: null });

export function drawOutfits(body: HTMLElement, a: AppearanceView, ui: OutfitUi, acts: Acts, send: (op: InvOp) => void, redraw: () => void): void {
  ensureLookCss();
  h('div', 'sg-gs-hintln', body, 'Save how you look now and switch with one tap. Outfits change looks only: your gear and its stats stay. Each job keeps its own six. Change single slots on the Gear tab.');
  if (a.why) h('div', 'sg-gs-why', body, a.why);
  const hd = h('div', 'sg-gs-h', body, 'Outfits');
  h('small', '', hd, `${a.outfits.filter((o) => o.label !== null).length} of ${a.outfits.length} saved`);
  const rows = h('div', 'sg-rows', body);
  for (const o of a.outfits) {
    const r = h('div', 'sg-orow' + (o.wearing ? ' cur' : '') + (o.label === null ? ' empty' : ''), rows);
    const top = h('div', 'sg-orow-top', r);
    const mid = h('div', 'sg-row-mid', top);
    h('div', 'sg-row-name', mid, o.label ?? `Place ${o.index + 1} · empty`);
    if (o.label !== null) h('div', 'sg-row-sub', mid, o.summary);
    const end = h('div', 'sg-orow-acts', top);
    const editing = ui.edit === o.index;
    if (o.label === null) {
      if (!editing) acts.on(btn(end, 'Save current look'), () => { ui.edit = o.index; ui.label = null; redraw(); });
    } else {
      if (o.wearing) h('div', 'sg-owned', end, '✔ Wearing');
      else opBtn(acts, end, 'Wear', { op: 'wearOutfit', index: o.index }, send, 'gold', a.why === null);
      if (!editing) acts.on(btn(end, 'Overwrite'), () => { ui.edit = o.index; ui.label = o.labelIndex; redraw(); });
    }
    if (!editing) continue;
    // the label picker, then the confirm (overwriting asks first)
    const ed = h('div', 'sg-oedit', r);
    h('div', 'sg-gs-hintln', ed, o.label === null ? 'Name it, then save your current look here:' : `Overwrite ${o.label} with your current look? Pick its name:`);
    const chips = h('div', 'sg-olabels', ed);
    a.labels.forEach((l, k) => {
      const c = btn(chips, l, 'sg-filter' + (ui.label === k ? ' on' : ''));
      c.setAttribute('aria-pressed', String(ui.label === k));
      acts.on(c, () => { ui.label = k; redraw(); });
    });
    const go = h('div', 'sg-card-acts', ed);
    const label = ui.label;
    if (label === null) btn(go, 'Pick a name first', 'off');
    else {
      const op: InvOp = { op: 'saveOutfit', index: o.index, label };
      opBtn(acts, go, o.label === null ? `Save as ${a.labels[label]}` : `Overwrite as ${a.labels[label]}`, op, (x) => { ui.edit = null; ui.label = null; send(x); }, o.label === null ? 'gold' : 'warn');
    }
    acts.on(btn(go, 'Cancel'), () => { ui.edit = null; ui.label = null; redraw(); });
  }
}
