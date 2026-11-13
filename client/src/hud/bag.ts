// The character sheet: one sheet behind one button (and I, C, O, T on desktop) with the tabs Gear (the equipment doll,
// the stats, the active set bonuses), Bag (30 slots, sorted by newest or by tier), Talents, Wardrobe, and Vault at
// the Grove Vault. Tapping an item opens its card: tier, item level, set progress, its stats and the comparison with
// what the current job wears in that slot (the kit's totals before → after), and the buttons that make sense here
// (Equip, Sell at the Smithy with a confirm for tier 2 and up, Put in or Take out at the Vault), each saying why not
// when it cannot. Tapping a doll slot lists what in the bag fits there, each with its one-line comparison and Equip.
// It never makes an item: every redraw comes from the server's `inventory` (update()).
import type { GearSlot, InvOp } from '@sg2/shared';
import type { CharSheetView, CharTab, ItemView, SheetAct, SheetHandle } from '../core/gearViews';
import { h } from './dom';
import { JOB_COLOR } from './jobs';
import { Acts, btn, closeBtn, cardTop, cmpBlock, cmpLine, frame, markPending, money, opBtn, setBlock, setNote, tile, type Frame } from './sheetKit';
import { drawTalents } from './talents';
import { drawWardrobe } from './wardrobe';

export interface SheetDeps {
  push: (kind: string, keys: (e: KeyboardEvent) => boolean) => () => void;
  show: (el: HTMLElement) => void;
  close: (el: HTMLElement) => void;
}

const TAB_LABEL: Record<CharTab, string> = { gear: 'Gear', bag: 'Bag', talents: 'Talents', wardrobe: 'Wardrobe', vault: 'Vault' };
const KEY_TAB: Record<string, CharTab> = { KeyI: 'bag', KeyC: 'gear', KeyO: 'wardrobe', KeyT: 'talents' };
const LEFT: readonly GearSlot[] = ['head', 'chest', 'legs', 'feet'];
const RIGHT: readonly GearSlot[] = ['back', 'hands', 'weapon', 'offhand'];
const FIGURE = '<svg viewBox="0 0 100 150" fill="currentColor"><circle cx="50" cy="20" r="13"/><path d="M30 38h40l10 6 8 40-8 3-8-30v32l4 54H62l-6-44h-12l-6 44H24l4-54V57l-8 30-8-3 8-40z"/></svg>';

type Card = { kind: 'item'; uid: number } | { kind: 'slot'; slot: GearSlot } | null;

/** Opens the character sheet on `tab`; onAct gets the ops the player asks for, onClosed runs once when it closes. */
export function openCharSheet(layer: HTMLElement, first: CharSheetView, tab0: CharTab, onAct: (a: SheetAct) => void, onClosed: () => void, d: SheetDeps): SheetHandle & { setTab(t: CharTab): void; readonly tab: CharTab } {
  let v = first;
  let tab: CharTab = tab0 === 'vault' && !v.vault ? 'bag' : tab0;
  let card: Card = null;
  let sort: 'new' | 'tier' = 'new';
  let confirm: string | null = null;
  let talentSel: string | null = null;
  let flash: { text: string; until: number } | null = null;
  let lastEquip: { uid: number; slot: GearSlot; name: string; summary: string } | null = null;
  let open = true;
  const acts = new Acts();
  const f: Frame = frame(layer, 'sg-charsheet');
  const send = (op: InvOp) => {
    if (op.op === 'equip') {
      const it = findItem(op.uid);
      lastEquip = it ? { uid: op.uid, slot: op.slot, name: it.name, summary: it.equip?.cmp?.summary ?? '' } : null;
    }
    confirm = null;
    onAct({ kind: 'op', op });
  };
  const findItem = (uid: number): ItemView | undefined =>
    v.bag.find((i) => i.uid === uid) ?? v.wornElsewhere.find((i) => i.uid === uid) ?? v.vault?.find((i) => i.uid === uid) ?? v.slots.find((s) => s.item?.uid === uid)?.item ?? undefined;

  const setTab = (t: CharTab) => {
    if (t === 'vault' && !v.vault) t = 'bag';
    if (t !== tab) { tab = t; card = null; confirm = null; talentSel = null; f.body.scrollTop = 0; onAct({ kind: 'tab', tab: t }); }
    draw();
  };

  const drawHead = () => {
    f.head.textContent = '';
    const id = h('div', 'sg-gs-id', f.head);
    const g = h('div', 'sg-gs-glyph', id, v.jobGlyph);
    g.style.setProperty('--jb', JOB_COLOR[v.jobId].bg); g.style.setProperty('--jf', JOB_COLOR[v.jobId].fg);
    const t = h('div', 'sg-gs-titles', id);
    h('div', 'sg-gs-title', t, v.jobName);
    h('div', 'sg-gs-sub', t, `Level ${v.level} · ${v.xpText}`);
    h('i', '', h('div', 'sg-gs-xp', t)).style.transform = `scaleX(${v.xpFrac.toFixed(3)})`;
    const purse = h('div', 'sg-gs-purse', f.head);
    money(purse, v.gold, 'gold', '');
    if (v.seals > 0 || v.vault) money(purse, v.seals, 'seals', '');
    f.head.appendChild(f.close);
    f.tabs.textContent = '';
    const tabs: CharTab[] = v.vault ? ['gear', 'bag', 'vault', 'talents', 'wardrobe'] : ['gear', 'bag', 'talents', 'wardrobe'];
    for (const k of tabs) {
      const b = h('button', 'sg-gs-tab' + (k === tab ? ' on' : ''), f.tabs, TAB_LABEL[k]) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(k === tab));
      if (k === 'talents' && v.openRows > 0) h('b', '', b);
      if (k === 'bag') b.textContent = `Bag ${v.bag.length}/${v.bagSlots}`;
      acts.on(b, () => setTab(k));
    }
  };

  const drawGear = (body: HTMLElement) => {
    const split = h('div', 'sg-gear-split', body);
    const left = h('div', '', split), right = h('div', '', split);
    const stats = h('div', 'sg-stats', left);
    for (const s of v.stats) {
      const sp = s.key === 'focus' || s.key === 'flow' || s.key === 'guard';
      const c = h('div', 'sg-stat' + (sp ? ' sp' : '') + (sp && s.value === '0' ? ' zero' : ''), stats);
      c.title = s.hint;
      h('b', '', c, s.value);
      h('span', '', c, s.label);
    }
    const special = v.stats.find((s) => (s.key === 'focus' || s.key === 'flow' || s.key === 'guard') && s.value !== '0');
    h('div', 'sg-gs-hintln', left, special ? `${special.label}: ${special.hint.replace(/^\w+: /, '')}.` : 'Cloth gives Focus, light gives Flow, heavy gives Guard.');
    const doll = h('div', 'sg-doll', left);
    const col = (slots: readonly GearSlot[]) => {
      const c = h('div', 'sg-doll-col', doll);
      for (const s of slots) {
        const sv = v.slots.find((x) => x.slot === s)!;
        const w = h('div', 'sg-slot', c);
        const t = tile(w, sv.item, card?.kind === 'slot' && card.slot === s, false);
        if (!sv.item) { t.classList.remove('empty'); t.style.opacity = sv.none ? '.35' : '1'; }
        t.setAttribute('aria-label', `${sv.label}: ${sv.item?.name ?? sv.none ?? 'empty'}`);
        acts.on(t, () => { card = { kind: 'slot', slot: s }; confirm = null; draw(); });
        h('span', '', w, sv.label);
      }
    };
    col(LEFT);
    const mid = h('div', 'sg-doll-mid', doll);
    mid.style.setProperty('--jb', JOB_COLOR[v.jobId].bg);
    const fig = h('div', 'sg-doll-fig', mid);
    fig.innerHTML = FIGURE;
    h('div', 'sg-doll-lv', mid, `${v.jobName} · Level ${v.level}`);
    col(RIGHT);
    h('div', 'sg-gs-hintln', left, 'Tap a slot to see what you wear and what in your bag fits there.');
    h('div', 'sg-gs-h', right, 'Set bonuses');
    if (v.sets.length) for (const s of v.sets) setBlock(right, s);
    else h('div', 'sg-gs-empty', right, 'Wear three pieces of one set for its first bonus, five for its second. The Smithy sells Greenway sets; the Lampfall and the Warden drop better ones.');
    if (v.named) { h('div', 'sg-gs-h', right, 'Named weapon'); h('div', 'sg-named', right, v.named); }
  };

  const sorted = (items: ItemView[]): ItemView[] => {
    const out = items.slice();
    if (sort === 'new') return out.reverse();
    const order = ['weapon', 'offhand', 'head', 'chest', 'legs', 'hands', 'feet', 'back'];
    return out.sort((a, b) => (b.icon.tier - a.icon.tier) || (Number(b.icon.named) - Number(a.icon.named)) || (order.indexOf(a.icon.slot) - order.indexOf(b.icon.slot)) || a.name.localeCompare(b.name));
  };
  const grid = (body: HTMLElement, items: ItemView[], slots: number) => {
    const g = h('div', 'sg-grid bag', body);
    for (const it of items) acts.on(tile(g, it, card?.kind === 'item' && card.uid === it.uid), () => { card = { kind: 'item', uid: it.uid }; confirm = null; draw(); });
    for (let k = items.length; k < slots; k++) tile(g, null);
  };
  const drawBag = (body: HTMLElement) => {
    const bar = h('div', 'sg-dyebar', body);
    h('div', '', bar, v.at === 'Kettleworth Smithy' ? 'Tap an item to see it, compare it or sell it.' : 'Tap an item to see it and compare it with what you wear.');
    acts.on(btn(bar, sort === 'new' ? 'Sort: newest' : 'Sort: best tier'), () => { sort = sort === 'new' ? 'tier' : 'new'; draw(); });
    grid(body, sorted(v.bag), v.bagSlots);
    if (v.wornElsewhere.length) {
      const hd = h('div', 'sg-gs-h', body, 'Worn by your other jobs');
      h('small', '', hd, 'no bag slot');
      const g = h('div', 'sg-grid', body);
      for (const it of v.wornElsewhere) acts.on(tile(g, it, card?.kind === 'item' && card.uid === it.uid), () => { card = { kind: 'item', uid: it.uid }; draw(); });
    }
  };
  const drawVault = (body: HTMLElement) => {
    const items = v.vault ?? [];
    const hd = h('div', 'sg-gs-h', body, 'The Grove Vault');
    h('small', '', hd, `${items.length}/${v.vaultSlots}`);
    h('div', 'sg-gs-hintln', body, 'Tap an item to take it out. Put things in from the Bag tab (not what a job wears).');
    grid(body, sorted(items), v.vaultSlots);
  };

  const drawItemCard = (box: HTMLElement, it: ItemView) => {
    cardTop(box, it);
    if (it.wornHere) h('div', 'sg-gs-hintln', box, `You wear this as your ${v.jobName}.`);
    if (it.equip?.cmp) cmpBlock(box, it.equip.cmp);
    // a piece this job cannot wear says why (no button); one it can wear but not now shows the button off, and why
    else if (it.equip?.why) h('div', 'sg-gs-why', box, it.equip.why);
    const acts2 = h('div', 'sg-card-acts', box);
    if (it.equip?.cmp) {
      opBtn(acts, acts2, `Equip as ${v.jobName}`, { op: 'equip', uid: it.uid, slot: it.equip.slot }, send, 'gold', it.equip.ok);
      if (it.equip.why) h('div', 'sg-gs-why', box, it.equip.why);
    }
    if (it.sell) {
      const key = `sell:${it.uid}`;
      if (confirm === key && it.sell.ok) {
        opBtn(acts, acts2, `Yes, sell for ${it.sell.price} gold`, { op: 'sell', uid: it.uid }, send, 'warn');
        acts.on(btn(acts2, 'Keep it'), () => { confirm = null; draw(); });
      } else if (it.sell.confirm && it.sell.ok) acts.on(btn(acts2, `Sell · ${it.sell.price} gold`), () => { confirm = key; draw(); });
      else opBtn(acts, acts2, `Sell · ${it.sell.price} gold`, { op: 'sell', uid: it.uid }, send, '', it.sell.ok);
      if (it.sell.why) h('div', 'sg-gs-why', box, it.sell.why);
    }
    if (it.bank) {
      opBtn(acts, acts2, it.bank.dir === 'in' ? 'Put in the Vault' : 'Take out', { op: it.bank.dir === 'in' ? 'bank' : 'unbank', uid: it.uid }, send, '', it.bank.ok);
      if (it.bank.why) h('div', 'sg-gs-why', box, it.bank.why);
    }
  };
  const drawSlotCard = (box: HTMLElement, slot: GearSlot) => {
    const sv = v.slots.find((s) => s.slot === slot)!;
    h('div', 'sg-gs-h', box, sv.label);
    if (sv.item) drawItemCardWorn(box, sv.item);
    else h('div', 'sg-gs-empty', box, sv.none ?? 'Nothing worn here.');
    if (sv.item && sv.item.icon.tier > 0 && slot !== 'weapon' && slot !== 'offhand') {
      const row = h('div', 'sg-card-acts', box);
      opBtn(acts, row, 'Take off (wear the starter piece)', { op: 'unequip', slot }, send, '', sv.takeOff.ok);
      if (sv.takeOff.why) h('div', 'sg-gs-why', box, sv.takeOff.why);
    }
    const fitting = [...v.bag, ...v.wornElsewhere].filter((i) => i.equip?.slot === slot && i.equip.cmp);
    const hd = h('div', 'sg-gs-h', box, 'From your bag');
    h('small', '', hd, fitting.length ? `${fitting.length} fit${fitting.length === 1 ? 's' : ''}` : '');
    if (!fitting.length) { h('div', 'sg-gs-empty', box, 'Nothing in your bag fits here. Kettleworth Smithy sells Greenway gear, and enemies drop it.'); return; }
    const rows = h('div', 'sg-rows', box);
    for (const it of sorted(fitting)) {
      const r = h('div', 'sg-row', rows);
      acts.on(tile(r, it), () => { card = { kind: 'item', uid: it.uid }; draw(); });
      const mid = h('div', 'sg-row-mid', r);
      acts.on(mid, () => { card = { kind: 'item', uid: it.uid }; draw(); });
      const n = h('div', 'sg-row-name', mid, it.name);
      n.style.setProperty('--rc', it.colour);
      if (it.equip?.cmp) cmpLine(mid, it.equip.cmp);
      if (it.equip?.why) h('div', 'sg-gs-why', mid, it.equip.why);
      const end = h('div', 'sg-row-end', r);
      opBtn(acts, end, 'Equip', { op: 'equip', uid: it.uid, slot }, send, 'gold', !!it.equip?.ok);
    }
  };
  const drawItemCardWorn = (box: HTMLElement, it: ItemView) => { cardTop(box, it); };

  const drawCard = () => {
    if (!card) return;
    const it = card.kind === 'item' ? findItem(card.uid) : null;
    if (card.kind === 'item' && !it) { card = null; return; }
    const wrap = h('div', 'sg-card-wrap', f.panel);
    acts.on(wrap, () => { card = null; confirm = null; draw(); });
    const box = h('div', 'sg-card', wrap);
    box.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('[data-a]') || (e.target as HTMLElement).closest('[data-a]') === wrap) e.stopPropagation(); });
    const x = closeBtn(box);
    acts.on(x, () => { card = null; confirm = null; draw(); });
    if (card.kind === 'item') drawItemCard(box, it!);
    else drawSlotCard(box, card.slot);
  };

  const draw = () => {
    if (!open) return;
    acts.reset();
    const scroll = f.body.scrollTop;
    const cardScroll = (f.panel.querySelector('.sg-card') as HTMLElement | null)?.scrollTop ?? 0;
    f.panel.querySelector('.sg-card-wrap')?.remove();
    drawHead();
    const now = performance.now();
    if (flash && flash.until > now) setNote(f, flash.text, true);
    else if (tab === 'talents' && v.talents.chooseNote && v.talents.rows.some((r) => r.unlocked && r.chosen === null)) setNote(f, v.talents.chooseNote);
    else if (v.at) setNote(f, `At ${v.at}`, true);
    else setNote(f, null);
    f.body.textContent = '';
    if (tab === 'gear') drawGear(f.body);
    else if (tab === 'bag') drawBag(f.body);
    else if (tab === 'vault') drawVault(f.body);
    else if (tab === 'talents') drawTalents(f.body, v.talents, { sel: talentSel, select: (id) => { talentSel = id; draw(); } }, acts, send);
    else drawWardrobe(f.body, v.wardrobe, acts, send);
    f.body.scrollTop = scroll;
    drawCard();
    const c = f.panel.querySelector('.sg-card') as HTMLElement | null;
    if (c) c.scrollTop = cardScroll;
  };

  let off: () => void = () => {};
  const done = () => {
    if (!open) return;
    open = false;
    off();
    d.close(f.root);
    onClosed();
  };
  f.root.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === f.root) done(); });
  f.root.addEventListener('click', (e) => { if (e.target === f.close || f.close.contains(e.target as Node)) { done(); return; } acts.run(e.target, f.root); });
  off = d.push('charsheet', (e) => {
    if (e.repeat) return true;
    if (e.code === 'Escape') { if (card) { card = null; confirm = null; draw(); } else done(); return true; }
    const t = KEY_TAB[e.code];
    if (t) { if (t === tab && !card) done(); else { card = null; setTab(t); } return true; }
    return e.code !== 'Tab';
  });
  draw();
  d.show(f.root);

  return {
    get open() { return open; },
    get tab() { return tab; },
    update(nv: unknown) {
      v = nv as CharSheetView;
      if (tab === 'vault' && !v.vault) tab = 'bag';
      // an equip that landed: the card closes and the sheet says what changed
      if (lastEquip) {
        const now = v.slots.find((s) => s.slot === lastEquip!.slot)?.item;
        if (now && now.uid === lastEquip.uid) {
          flash = { text: `Equipped ${lastEquip.name}${lastEquip.summary ? ` · ${lastEquip.summary}` : ''}`, until: performance.now() + 3500 };
          if (card?.kind === 'item' && card.uid === lastEquip.uid) card = null;
          lastEquip = null;
          window.setTimeout(() => { if (open && flash && flash.until <= performance.now()) draw(); }, 3600);
        }
      }
      draw();
    },
    setPending(keys) { acts.pending = keys; markPending(f.root, keys); },
    setTab,
    close: done,
  };
}
