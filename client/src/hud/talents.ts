// The Talents tab: three rows of three for the current job. A locked row says the level it opens at; an open row's
// card is tapped to see it, then chosen with its own button (where the server allows it: a town or sanctuary, out of
// a fight); a chosen card is lit. Each card says what it does (TALENTS[*].desc) and, when it changes an ability the
// job does not carry now, "Needs X on your bar". Retraining (at the Guild Board) shows its price, or that it is free.
import { RESPEC_PRICE, type InvOp } from '@sg2/shared';
import type { TalentsView } from '../core/gearViews';
import { h } from './dom';
import { Acts, btn, opBtn } from './sheetKit';

export interface TalentsUi { sel: string | null; select(id: string | null): void }

export function drawTalents(body: HTMLElement, v: TalentsView, ui: TalentsUi, acts: Acts, send: (op: InvOp) => void): void {
  h('div', 'sg-gs-hintln', body, 'Talents change how your job plays, not how strong it is. Choosing is free.');
  for (const r of v.rows) {
    const done = r.chosen !== null;
    const sec = h('div', 'sg-tr' + (r.unlocked ? '' : ' locked') + (done ? ' done' : ''), body);
    const head = h('div', 'sg-tr-h', sec, `Row ${r.row + 1}`);
    h('small', '', head, r.unlocked ? (done ? `Chosen: ${r.cards[r.chosen!]!.name}` : `Open · choose one of three`) : `Opens at level ${r.level}`);
    r.cards.forEach((c, k) => {
      const card = h('div', 'sg-tc' + (c.chosen ? ' chosen' : '') + (ui.sel === c.id ? ' sel' : ''), sec);
      card.setAttribute('role', 'button');
      h('div', 'sg-tc-name', card, c.name);
      h('div', 'sg-tc-desc', card, c.desc);
      if (c.needs) h('div', 'sg-tc-needs', card, c.needs);
      if (c.chosen) h('span', 'sg-tc-tag', card, 'Chosen');
      else if (!r.unlocked) h('span', 'sg-tc-tag', card, `Level ${r.level}`);
      if (!r.unlocked || done) return; // locked rows and chosen rows cannot be chosen (Retrain clears them)
      acts.on(card, () => ui.select(ui.sel === c.id ? null : c.id));
      if (ui.sel === c.id) {
        if (v.canChoose) {
          opBtn(acts, card, `Choose ${c.name}`, { op: 'talent', row: r.row, choice: k as 0 | 1 | 2 }, send, 'gold sg-tc-go');
        } else h('div', 'sg-gs-why', card, v.chooseNote ?? '');
      }
    });
  }
  const rs = h('div', 'sg-respec', body);
  const txt = h('div', '', rs);
  h('b', '', txt, 'Retrain');
  txt.append(` clears every ${v.jobName} talent. The first time is free, then ${RESPEC_PRICE} gold per chosen row.`);
  if (v.respec.why) h('div', 'sg-gs-why', txt, v.respec.why);
  const label = v.respec.free ? 'Retrain · free' : `Retrain · ${v.respec.price} gold`;
  if (ui.sel === 'respec' && v.respec.ok) {
    opBtn(acts, rs, 'Yes, retrain', { op: 'respec' }, send, 'warn');
  } else {
    const b = btn(rs, label, v.respec.ok ? '' : 'off');
    acts.on(b, () => ui.select('respec'));
  }
}
