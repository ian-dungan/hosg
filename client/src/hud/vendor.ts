// The stall sheets: Kettleworth Smithy (Greenway gear for gold, with type filters and each piece compared with what the
// current job wears; and Sell from the bag, a confirm for tier 2 and up), the Lampwright (Warden gear for Warden's
// Seals) and Bobbin & Thimble (costumes, and dyes: pick a piece or a costume, a colour channel and a dye, then pay).
// Prices, what can be afforded and what is owned all come from the view (shared data and the server's inventory);
// a purchase is one tap, and its button waits for the server's answer (never a second send).
import type { CostumeSlot, InvOp } from '@sg2/shared';
import type { SheetAct, SheetHandle, ShopRow, VendorView } from '../core/gearViews';
import { h } from './dom';
import { Acts, btn, closeBtn, cardTop, cmpBlock, cmpLine, frame, markPending, money, opBtn, setNote, tile, type Frame } from './sheetKit';
import type { SheetDeps } from './bag';

const STALL_COLOUR: Record<VendorView['stall'], string> = { smithy: '#EC6A4C', lampwright: '#9b7ad8', tailor: '#3FB0A6', vault: '#479AF2', barber: '#8FD16A' };

export function openVendor(layer: HTMLElement, first: VendorView, onAct: (a: SheetAct) => void, onClosed: () => void, d: SheetDeps): SheetHandle {
  let v = first;
  let open = true;
  let tab: 'buy' | 'sell' | 'costumes' | 'dye' = v.stall === 'tailor' ? 'costumes' : 'buy';
  let filter = v.defaultFilter;
  let card: string | null = null;      // an item id from the lists
  let confirm: string | null = null;
  let target: string | null = null;    // a dye target key
  let ch: 0 | 1 = 0;
  let pick: number | null = null;      // a dye id
  const acts = new Acts();
  const f: Frame = frame(layer, 'sg-vendor');
  const send = (op: InvOp) => { confirm = null; onAct({ kind: 'op', op }); };

  const drawHead = () => {
    f.head.textContent = '';
    const id = h('div', 'sg-gs-id', f.head);
    const g = h('div', 'sg-gs-glyph', id, v.name.charAt(0));
    g.style.setProperty('--jb', STALL_COLOUR[v.stall]);
    const t = h('div', 'sg-gs-titles', id);
    h('div', 'sg-gs-title', t, v.name);
    h('div', 'sg-gs-sub', t, v.keeper);
    const purse = h('div', 'sg-gs-purse', f.head);
    money(purse, v.gold, 'gold', '');
    if (v.stall === 'lampwright' || v.seals > 0) money(purse, v.seals, 'seals', '');
    f.head.appendChild(f.close);
    f.tabs.textContent = '';
    const tabs: { id: typeof tab; label: string }[] = v.stall === 'smithy' ? [{ id: 'buy', label: 'Buy' }, { id: 'sell', label: `Sell (${v.sell.length})` }]
      : v.stall === 'tailor' ? [{ id: 'costumes', label: 'Costumes' }, { id: 'dye', label: 'Dyes' }] : [];
    f.tabs.hidden = tabs.length === 0;
    for (const k of tabs) {
      const b = h('button', 'sg-gs-tab' + (k.id === tab ? ' on' : ''), f.tabs, k.label) as HTMLButtonElement;
      b.type = 'button';
      acts.on(b, () => { tab = k.id; card = null; confirm = null; f.body.scrollTop = 0; draw(); });
    }
  };

  const buyOp = (r: ShopRow): InvOp => ({ op: 'buy', stall: v.stall as 'smithy' | 'lampwright', item: r.item.item });
  const priceTag = (parent: HTMLElement, r: ShopRow) => {
    const p = money(parent, r.price, r.currency);
    if (!r.ok) p.classList.add('short');
  };
  const drawShop = (body: HTMLElement) => {
    h('div', 'sg-greet', body, `“${v.greeting}”`);
    const fl = h('div', 'sg-filters', body);
    for (const x of v.filters) {
      const b = h('button', 'sg-filter' + (x.id === filter ? ' on' : ''), fl, x.label) as HTMLButtonElement;
      b.type = 'button';
      acts.on(b, () => { filter = x.id; card = null; f.body.scrollTop = 0; draw(); });
    }
    const rows = h('div', 'sg-rows', body);
    for (const r of v.rows[filter] ?? []) {
      const row = h('div', 'sg-row' + (r.forMe ? '' : ' other'), rows);
      acts.on(tile(row, r.item), () => { card = r.item.item; draw(); });
      const mid = h('div', 'sg-row-mid', row);
      acts.on(mid, () => { card = r.item.item; draw(); });
      const n = h('div', 'sg-row-name', mid, r.item.name);
      n.style.setProperty('--rc', r.item.colour);
      h('div', 'sg-row-sub', mid, r.fitsLabel ? `${r.item.kindLabel} · for ${r.fitsLabel}` : r.item.stats);
      if (r.wearing) h('div', 'sg-owned', mid, 'You wear this');
      else if (r.item.equip?.cmp) cmpLine(mid, r.item.equip.cmp);
      const end = h('div', 'sg-row-end', row);
      priceTag(end, r);
      if (r.owned) h('div', 'sg-owned', end, r.owned > 1 ? `Owned ×${r.owned}` : 'Owned');
      opBtn(acts, end, 'Buy', buyOp(r), send, r.ok && v.here ? 'gold' : '', r.ok && v.here && !v.why);
    }
  };
  const drawShopCard = (box: HTMLElement, r: ShopRow) => {
    cardTop(box, r.item);
    if (r.fitsLabel) h('div', 'sg-gs-hintln', box, `For ${r.fitsLabel}.`);
    if (r.item.equip?.cmp) cmpBlock(box, r.item.equip.cmp);
    else h('div', 'sg-gs-hintln', box, 'Your current job cannot wear this.');
    const a = h('div', 'sg-card-acts', box);
    opBtn(acts, a, `Buy · ${r.price} ${r.currency === 'gold' ? 'gold' : r.price === 1 ? 'Seal' : 'Seals'}`, buyOp(r), send, 'gold', r.ok && v.here && !v.why);
    if (r.why) h('div', 'sg-gs-why', box, r.why);
    else if (!v.here || v.why) h('div', 'sg-gs-why', box, v.why ?? '');
    if (r.owned) h('div', 'sg-owned', box, `You own ${r.owned}.`);
  };

  const drawSell = (body: HTMLElement) => {
    if (!v.sell.length) { h('div', 'sg-gs-empty', body, 'Nothing to sell: worn gear and starter pieces stay with you. Loot from the Greenway and the Lampfall sells here.'); return; }
    h('div', 'sg-gs-hintln', body, 'Only what no job wears. Tier 2 and up asks before it sells.');
    const rows = h('div', 'sg-rows', body);
    for (const it of v.sell) {
      const s = it.sell!;
      const row = h('div', 'sg-row', rows);
      tile(row, it);
      const mid = h('div', 'sg-row-mid', row);
      const n = h('div', 'sg-row-name', mid, it.name);
      n.style.setProperty('--rc', it.colour);
      h('div', 'sg-row-sub', mid, it.stats);
      if (s.why) h('div', 'sg-gs-why', mid, s.why);
      const end = h('div', 'sg-row-end', row);
      money(end, s.price, 'gold');
      const key = `sell:${it.uid}`;
      if (confirm === key) {
        opBtn(acts, end, 'Yes, sell', { op: 'sell', uid: it.uid }, send, 'warn', s.ok && v.here);
        acts.on(btn(end, 'Keep'), () => { confirm = null; draw(); });
      } else if (s.confirm) acts.on(btn(end, 'Sell', s.ok && v.here ? '' : 'off'), () => { confirm = key; draw(); });
      else opBtn(acts, end, 'Sell', { op: 'sell', uid: it.uid }, send, '', s.ok && v.here);
    }
  };

  const drawCostumes = (body: HTMLElement) => {
    h('div', 'sg-greet', body, `“${v.greeting}”`);
    h('div', 'sg-gs-hintln', body, 'Costumes are kept in your wardrobe for every job, and change only how you look. Wear them from the Wardrobe tab, or here.');
    const rows = h('div', 'sg-rows', body);
    for (const c of v.costumes) {
      const row = h('div', 'sg-row' + (c.owned ? ' cur' : ''), rows);
      const mid = h('div', 'sg-row-mid', row);
      h('div', 'sg-row-name', mid, c.name);
      const sub = h('div', 'sg-row-sub', mid, `${c.slot} costume `);
      if (c.event) h('span', 'sg-badge star', sub, '★ Event');
      if (!c.owned && c.why && !c.event) h('div', 'sg-gs-why', mid, c.why);
      const end = h('div', 'sg-row-end', row);
      if (c.owned) {
        h('div', 'sg-owned', end, 'Owned');
        opBtn(acts, end, 'Wear', { op: 'wear', slot: c.slot.toLowerCase() as CostumeSlot, costume: c.id as never }, send);
      } else if (c.event) h('div', 'sg-row-sub', end, 'Event only');
      else {
        const p = money(end, c.price ?? 0, 'gold');
        if (!c.ok) p.classList.add('short');
        opBtn(acts, end, 'Buy', { op: 'buyCostume', costume: c.id as never }, send, c.ok && v.here ? 'gold' : '', c.ok && v.here && !v.why);
      }
    }
  };

  const drawDye = (body: HTMLElement) => {
    if (!v.dyeTargets.length) { h('div', 'sg-gs-empty', body, 'Nothing to dye.'); return; }
    if (!target || !v.dyeTargets.some((t) => t.key === target)) target = v.dyeTargets[0]!.key;
    const t = v.dyeTargets.find((x) => x.key === target)!;
    h('div', 'sg-gs-h', body, 'What to dye');
    const dot = (parent: HTMLElement, id: number) => {
      const dye = v.dyes[id];
      const el = h('i', 'sg-dot' + (dye?.hex ? '' : ' undyed'), parent);
      if (dye?.hex) el.style.setProperty('--dc', dye.hex);
    };
    // the targets as compact chips (the worn pieces of this job, then the costumes): the swatches stay in view
    const chips = h('div', 'sg-chips2', body);
    for (const x of v.dyeTargets) {
      const c = h('button', 'sg-dchip' + (x.key === target ? ' on' : ''), chips) as HTMLButtonElement;
      c.type = 'button';
      c.style.setProperty('--rc', x.colour);
      c.title = x.label;
      dot(c, x.dye[0]); dot(c, x.dye[1]);
      c.append(x.short);
      acts.on(c, () => { target = x.key; pick = null; draw(); });
    }
    const cur = h('div', 'sg-row-name', body, t.label);
    cur.style.cssText = `--rc:${t.colour};margin:10px 2px 6px`;
    const chRow = h('div', 'sg-wrow', body);
    for (const k of [0, 1] as const) {
      const b = btn(chRow, '', 'sg-wopt' + (ch === k ? ' on' : ''));
      dot(b, t.dye[k]);
      b.append(`Colour ${k + 1}: ${v.dyes[t.dye[k]]?.name ?? 'Undyed'}`);
      acts.on(b, () => { ch = k; pick = null; draw(); });
    }
    const hd = h('div', 'sg-gs-h', body, 'Dyes');
    h('small', '', hd, `${v.dyePrice} gold a change`);
    const sw = h('div', 'sg-swatches', body);
    for (const dye of v.dyes) {
      const s = h('button', 'sg-swatch' + (dye.hex ? '' : ' undyed') + (t.dye[ch] === dye.id ? ' cur' : '') + (pick === dye.id ? ' sel' : ''), sw) as HTMLButtonElement;
      s.type = 'button';
      if (dye.hex) s.style.setProperty('--dc', dye.hex);
      s.title = dye.name; s.setAttribute('aria-label', dye.name);
      acts.on(s, () => { pick = dye.id; draw(); });
    }
    const bar = h('div', 'sg-dyebar', body);
    const chosen = pick !== null ? v.dyes[pick] : null;
    const txt = h('div', '', bar);
    if (!chosen) txt.textContent = `Pick a dye for colour ${ch + 1}. "Undyed" (striped) gives the piece its own colours back.`;
    else if (chosen.id === t.dye[ch]) txt.textContent = `${chosen.name} is already colour ${ch + 1}.`;
    else {
      txt.append(`Colour ${ch + 1} → `);
      const dot = h('i', 'sg-dot' + (chosen.hex ? '' : ' undyed'), txt);
      if (chosen.hex) dot.style.setProperty('--dc', chosen.hex);
      txt.append(` ${chosen.name}`);
      const op: InvOp = t.kind === 'item' ? { op: 'dye', uid: t.uid!, ch, dye: chosen.id } : { op: 'dyeCostume', costume: t.costume as never, ch, dye: chosen.id };
      const short = v.dyePrice - v.gold;
      opBtn(acts, bar, `Dye · ${v.dyePrice} gold`, op, send, 'gold', v.here && !v.why && short <= 0);
      if (short > 0) h('div', 'sg-gs-why', body, `Need ${short} more gold`);
    }
  };

  const drawCard = () => {
    if (!card) return;
    const r = Object.values(v.rows).flat().find((x) => x.item.item === card);
    if (!r) { card = null; return; }
    const wrap = h('div', 'sg-card-wrap', f.panel);
    acts.on(wrap, () => { card = null; draw(); });
    const box = h('div', 'sg-card', wrap);
    box.addEventListener('click', (e) => { const a = (e.target as HTMLElement).closest('[data-a]'); if (!a || a === wrap) e.stopPropagation(); });
    acts.on(closeBtn(box), () => { card = null; draw(); });
    drawShopCard(box, r);
  };

  const draw = () => {
    if (!open) return;
    acts.reset();
    const scroll = f.body.scrollTop;
    f.panel.querySelector('.sg-card-wrap')?.remove();
    drawHead();
    setNote(f, !v.here ? v.why : v.why ? v.why : null);
    f.body.textContent = '';
    if (v.stall === 'tailor') (tab === 'dye' ? drawDye : drawCostumes)(f.body);
    else if (tab === 'sell') drawSell(f.body);
    else drawShop(f.body);
    f.body.scrollTop = scroll;
    drawCard();
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
  off = d.push('vendor', (e) => {
    if (e.repeat) return true;
    if (e.code === 'Escape' || e.code === 'KeyE') { if (card) { card = null; draw(); } else done(); return true; }
    return e.code !== 'Tab';
  });
  draw();
  d.show(f.root);
  return {
    get open() { return open; },
    update(nv: unknown) { v = nv as VendorView; if (!v.rows[filter] && v.filters.length) filter = v.defaultFilter; draw(); },
    setPending(keys) { acts.pending = keys; markPending(f.root, keys); },
    close: done,
  };
}
