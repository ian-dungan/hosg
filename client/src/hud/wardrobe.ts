// The Wardrobe tab: the current job's costume slots (body, head, back), each with "Show my gear" and the owned
// costumes for it (event costumes carry a star), and the Hide head switch. Wearing works anywhere out of a fight;
// costumes change only the look, never a stat.
import type { InvOp } from '@sg2/shared';
import type { WardrobeView } from '../core/gearViews';
import { h } from './dom';
import { Acts, btn, opBtn } from './sheetKit';

export function drawWardrobe(body: HTMLElement, v: WardrobeView, acts: Acts, send: (op: InvOp) => void): void {
  h('div', 'sg-gs-hintln', body, 'Costumes change your look only: your gear and its stats stay. Each job keeps its own outfit.');
  if (v.why) h('div', 'sg-gs-why', body, v.why);
  for (const s of v.slots) {
    const head = h('div', 'sg-gs-h', body, s.label);
    h('small', '', head, s.worn ? `Wearing ${s.worn}` : 'Showing your gear');
    const row = h('div', 'sg-wrow', body);
    // the option in use is lit (a check, no action); the others wear on one tap
    const opt = (label: string, on: boolean, op: InvOp) => {
      if (on) { const b = btn(row, `✔ ${label}`, 'sg-wopt on'); b.setAttribute('aria-pressed', 'true'); return b; }
      return opBtn(acts, row, label, op, send, 'sg-wopt', !v.why);
    };
    opt('Show my gear', !s.worn, { op: 'wear', slot: s.slot, costume: null });
    for (const o of s.options) {
      const b = opt(o.event ? `★ ${o.name}` : o.name, o.worn, { op: 'wear', slot: s.slot, costume: o.id as never });
      if (o.event) b.title = 'Event costume';
    }
  }
  if (v.owned === 0) h('div', 'sg-gs-empty', body, 'No costumes yet. Bobbin & Thimble, by the Plaza of the Two, sells them; events give rare ones.');
  const sw = h('button', 'sg-switchrow', body) as HTMLButtonElement;
  sw.type = 'button';
  h('span', '', sw, 'Hide head piece');
  h('i', 'sg-sw' + (v.hideHead ? ' on' : ''), sw);
  const op: InvOp = { op: 'hideHead', hide: !v.hideHead };
  sw.dataset.k = `hideHead:${!v.hideHead}`;
  if (v.why) sw.classList.add('off');
  acts.on(sw, () => send(op));
}
