// The journal (Plan 6): Q, or a tap on the quest tracker. Three tabs: Active (each quest with its past steps
// struck, the current one with its counts and hint, its rewards, Track, Skip step on an optional step, Drop
// quest for anything but the main quest, each with a confirm), Offers (who gives it, or Accept for a quest
// offered anywhere) and Done (times, today, the title it gave). Full screen on phones (portrait and
// landscape), a 420 px panel on desktop (the job board's panel). Every control is at least 48 px. All text
// is set as text (the view's lines come from the shared story text).
import type { JournalAnswer, JournalView } from '../core/contracts';
import { h, ICONS } from './dom';

type Tab = 'active' | 'offers' | 'done';
const KIND: Record<JournalView['active'][number]['kind'], string> = { main: 'Main quest', side: 'Side quest', daily: 'Daily', epilogue: 'Epilogue' };

/** The confirm line for dropping a quest or skipping a step (the skip says plainly that it gives no reward). */
export function confirmText(kind: 'abandon' | 'skip', quest: string): { line: string; yes: string; no: string } {
  return kind === 'abandon'
    ? { line: `Drop ${quest}? Its progress is lost. You can take it again later.`, yes: 'Drop quest', no: 'Keep it' }
    : { line: 'Skip this step? You get no reward for it.', yes: 'Skip step', no: 'Keep going' };
}

/** The tab labels with their counts. */
export function tabLabels(v: JournalView): Record<Tab, string> {
  return { active: `Active ${v.active.length}`, offers: `Offers ${v.offers.length}`, done: `Done ${v.done.length}` };
}

/** "Done once", "Done 3 times". */
export const timesText = (n: number): string => (n === 1 ? 'Done once' : `Done ${n} times`);

export function openJournal(
  layer: HTMLElement, v: JournalView, push: (kind: string, keys: (e: KeyboardEvent) => boolean) => () => void,
  show: (el: HTMLElement) => void, close: (el: HTMLElement) => void, register?: (cancel: () => void) => void,
): Promise<JournalAnswer | null> {
  return new Promise((resolve) => {
    const root = h('div', 'sg-jobs sg-journal sg-ctl', layer);
    const panel = h('div', 'sg-jb-panel sg-jn-panel', root);
    const head = h('div', 'sg-jb-head', panel);
    const titles = h('div', 'sg-jb-titles', head);
    h('div', 'sg-jb-title', titles, 'Journal');
    h('div', 'sg-jb-sub', titles, 'Your quests');
    const x = h('button', 'sg-jb-close', head);
    x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.innerHTML = ICONS.close;
    const tabs = h('div', 'sg-jn-tabs', panel);
    const list = h('div', 'sg-jb-list sg-jn-list', panel);
    let answered = false;
    const done = (a: JournalAnswer | null) => { if (answered) return; answered = true; off(); close(root); resolve(a); };
    register?.(() => done(null));
    const labels = tabLabels(v);
    const tabEls = new Map<Tab, HTMLElement>();
    let tab: Tab = v.tab ?? (v.active.length ? 'active' : v.offers.length ? 'offers' : 'done');
    for (const t of ['active', 'offers', 'done'] as Tab[]) {
      const b = h('button', 'sg-jn-tab', tabs, labels[t]);
      b.type = 'button';
      b.dataset.tab = t;
      b.addEventListener('click', () => { tab = t; render(); });
      tabEls.set(t, b);
    }
    const btn = (parent: HTMLElement, text: string, cls: string, on: () => void) => {
      const b = h('button', 'sg-btn sg-jn-btn ' + cls, parent, text);
      b.type = 'button';
      b.addEventListener('click', (e) => { e.stopPropagation(); on(); });
      return b;
    };
    const empty = (text: string) => h('div', 'sg-jn-empty', list, text);
    /** Swaps a card's buttons for a confirm (yes answers, no puts the buttons back). */
    const confirm = (row: HTMLElement, kind: 'abandon' | 'skip', name: string, answer: JournalAnswer) => {
      row.textContent = '';
      row.classList.add('confirming');
      const c = confirmText(kind, name);
      h('div', 'sg-jn-confirm', row, c.line);
      const r = h('div', 'sg-jn-btns', row);
      btn(r, c.yes, 'sg-jn-danger', () => done(answer));
      btn(r, c.no, '', () => render());
    };
    const render = () => {
      for (const [t, b] of tabEls) b.classList.toggle('on', t === tab);
      list.textContent = '';
      list.scrollTop = 0;
      if (tab === 'active') {
        if (!v.active.length) empty('No quests under way. Look in Offers, or ask around town.');
        for (const a of v.active) {
          const card = h('div', 'sg-jn-card' + (a.tracked ? ' tracked' : ''), list);
          card.dataset.quest = a.id;
          const top = h('div', 'sg-jn-top', card);
          h('span', 'sg-jn-kind ' + a.kind, top, KIND[a.kind]);
          if (a.tracked) h('span', 'sg-jn-trk', top, 'Tracked');
          h('div', 'sg-jn-name', card, a.name);
          h('div', 'sg-jn-blurb', card, a.blurb);
          const steps = h('ul', 'sg-jn-steps', card);
          for (const s of a.steps) {
            if (s.state !== 'current') { const li = h('li', s.state, steps, s.text); if (s.state === 'skipped') h('span', 'sg-jn-skipped', li, 'skipped'); continue; }
            for (const l of s.lines ?? [{ text: s.text, done: false }]) { const li = h('li', l.done ? 'done cur' : 'cur', steps); h('i', '', li); h('span', '', li, l.text); }
            if (s.hint) h('div', 'sg-jn-hint', card, s.hint);
          }
          if (a.rewards) { const r = h('div', 'sg-jn-rew', card); h('b', '', r, 'Rewards '); r.append(a.rewards); }
          const row = h('div', 'sg-jn-btns', card);
          if (!a.tracked) btn(row, 'Track', 'sg-btn-gold sg-jn-track', () => done({ act: 'track', quest: a.id }));
          if (a.canSkip) btn(row, 'Skip step', 'sg-jn-skip', () => confirm(row, 'skip', a.name, { act: 'skip', quest: a.id }));
          if (a.canDrop) btn(row, 'Drop quest', 'sg-jn-drop', () => confirm(row, 'abandon', a.name, { act: 'abandon', quest: a.id }));
          if (!row.children.length) row.remove();
        }
      } else if (tab === 'offers') {
        if (!v.offers.length) empty('Nothing on offer right now.');
        for (const o of v.offers) {
          const card = h('div', 'sg-jn-card', list);
          card.dataset.quest = o.id;
          h('div', 'sg-jn-name', card, o.name);
          h('div', 'sg-jn-blurb', card, o.blurb);
          if (o.rewards) { const r = h('div', 'sg-jn-rew', card); h('b', '', r, 'Rewards '); r.append(o.rewards); }
          if (o.giver) h('div', 'sg-jn-giver', card, `Ask ${o.giver}`);
          if (o.canAccept) btn(h('div', 'sg-jn-btns', card), 'Accept', 'sg-btn-gold sg-jn-accept', () => done({ act: 'accept', quest: o.id }));
        }
      } else {
        if (!v.done.length) empty('Nothing finished yet. Every road starts with one step.');
        for (const d of v.done) {
          const card = h('div', 'sg-jn-card sg-jn-donecard', list);
          card.dataset.quest = d.id;
          const top = h('div', 'sg-jn-top', card);
          h('div', 'sg-jn-name', top, d.name);
          if (d.daily && d.today) h('span', 'sg-jn-today', top, 'Today');
          h('div', 'sg-jn-times', card, timesText(d.times) + (d.daily ? (d.today ? ' · back tomorrow' : ' · ready again') : ''));
          if (d.title) h('div', 'sg-jn-title', card, `Title: ${d.title}`);
        }
      }
    };
    render();
    x.addEventListener('click', () => done(null));
    root.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === root) done(null); });
    const off = push('journal', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyQ') { if (!e.repeat) done(null); return true; }
      return e.code !== 'Tab';
    });
    show(root);
  });
}

export const JOURNAL_CSS = /* css */ `
.sg-jn-tabs{display:flex;gap:6px;padding:0 12px 8px}
.sg-jn-tab{flex:1;min-height:48px;border:0;border-radius:14px;font:600 15px var(--sans);color:var(--cream);background:rgba(255,246,230,.07);
  box-shadow:inset 0 0 0 1px rgba(255,226,160,.18);cursor:pointer;touch-action:manipulation}
.sg-jn-tab.on{color:#3a2508;background:linear-gradient(180deg,#ffe49a,#F2B742);box-shadow:none;text-shadow:none}
.sg-jn-card{flex:none;display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:14px;background:rgba(255,246,230,.06);box-shadow:inset 0 0 0 1px rgba(255,226,160,.16)}
.sg-jn-card.tracked{box-shadow:inset 0 0 0 2px var(--gold2);background:rgba(242,183,66,.1)}
.sg-jn-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sg-jn-kind,.sg-jn-trk,.sg-jn-today{font-size:14px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:3px 7px;border-radius:7px;background:rgba(255,246,230,.13)}
.sg-jn-kind.main{background:rgba(242,183,66,.25);color:var(--goldl)}
.sg-jn-trk,.sg-jn-today{background:var(--gold2);color:#3a2508;text-shadow:none}
.sg-jn-name{font:600 19px/1.2 var(--serif);color:var(--cream)}
.sg-jn-donecard .sg-jn-name{flex:1;min-width:0}
.sg-jn-blurb{font:italic 400 14px/1.4 var(--serif);opacity:.85}
.sg-jn-steps{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.sg-jn-steps li{display:flex;align-items:baseline;gap:8px;font-size:14px;line-height:1.35}
.sg-jn-steps li.done:not(.cur),.sg-jn-steps li.skipped{opacity:.55;text-decoration:line-through;text-decoration-color:rgba(255,226,160,.6)}
.sg-jn-steps li.cur{font-weight:600;color:#fffaf0}
.sg-jn-steps li.cur i{flex:none;width:9px;height:9px;transform:rotate(45deg) translateY(-1px);border:1.5px solid var(--gold2);border-radius:1px}
.sg-jn-steps li.cur.done{opacity:.6;text-decoration:line-through}
.sg-jn-steps li.cur.done i{background:var(--gold2)}
.sg-jn-skipped{margin-left:6px;font-size:14px;font-style:italic;text-decoration:none;display:inline-block}
.sg-jn-hint{font-size:14px;line-height:1.4;padding:8px 10px;border-radius:10px;background:rgba(63,176,166,.16);box-shadow:inset 0 0 0 1px rgba(63,176,166,.5)}
.sg-jn-rew{font-size:14px;line-height:1.35;opacity:.92}
.sg-jn-rew b{color:var(--goldl);font-weight:700}
.sg-jn-giver{font-size:14px;font-style:italic;color:var(--goldl)}
.sg-jn-times{font-size:14px;opacity:.85}
.sg-jn-title{font:italic 600 15px var(--serif);color:var(--goldl)}
.sg-jn-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.sg-jn-btn{flex:1 1 auto;min-width:110px;min-height:48px;font-size:15px;padding:0 16px}
.sg-jn-danger{background:rgba(236,106,76,.3);box-shadow:inset 0 0 0 1.5px rgba(255,150,120,.7)}
.sg-jn-confirm{flex-basis:100%;font-size:14px;font-weight:600;line-height:1.35;color:#ffe8c4}
.sg-jn-empty{padding:24px 8px;text-align:center;font:italic 400 15px var(--serif);opacity:.8}
.sg-journal .sg-jb-close{border:0}
`;
