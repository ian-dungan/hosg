// Plan 5: the client's inventory, pure (no DOM, no Babylon). It follows the server's `inventory` (the only source of
// what the adventurer owns: no item is ever made here), `loot`, `levelUp` and `invRefused`, gates operations so a
// double tap never sends twice (each send carries a fresh random op id), and builds every view the gear screens
// draw (core/gearViews.ts) from the view and the shared item, set, costume, dye, talent and kit data.
import {
  ABILITIES, ARMOUR_SLOTS, BANK_SLOTS, BAG_SLOTS, COSTUMES, COSTUME_IDS, DYES, DYE_PRICE, GEAR_SLOTS, GUILD_BOARD, INV_TEXT, ITEMS, ITEM_IDS,
  JOBS, JOB_ARMOUR, JOB_IDS, JOB_LEVEL_CAP, OFFHAND_FOR, RESPEC_PRICE, SETS, SET_IDS, STALL_REACH, TALENT_LEVELS, TOWN_STALLS, WEAPONS, XP_TO_NEXT,
  baseStats, fits, isItemId, isJobId, itemStats, jobSwitchAt, kitFor, setCounts, stallAt, talentsFor, totalTo, zoneDef,
  type CostumeSlot, type GearSlot, type InvOp, type InventoryView, type ItemId, type JobId, type JobOutfit, type JobsView, type SetId,
  type StallId, type Stats, type ZoneId,
} from '@sg2/shared';
import type {
  CharSheetView, Comparison, IconSpec, ItemView, LevelShow, LootShow, SetProgress, ShopRow, StatDelta, TalentsView, VendorView, WardrobeView,
} from '../core/gearViews';

// ───────────────────────── words and colours ─────────────────────────

/** Rarity colours by tier: starter grey, T1 green, T2 blue, T3 violet (named weapons gold). Every T3 piece, the
 *  unnamed off-hands included, reads as T3. */
export const TIER_COLOUR = { starter: '#b4b0c4', 1: '#7ed36a', 2: '#5aa8ff', 3: '#c290ff', named: '#ffc94a' } as const;
export function itemColour(id: ItemId): string {
  const it = ITEMS[id];
  if (!it || it.tier === 0) return TIER_COLOUR.starter;
  if (it.named) return TIER_COLOUR.named;
  return TIER_COLOUR[it.tier];
}
const TIER_WORD = ['Starter', 'Tier 1 · Greenway', 'Tier 2 · Lampfall', 'Tier 3 · Warden'] as const;
export const SLOT_LABEL: Readonly<Record<GearSlot, string>> = {
  head: 'Head', chest: 'Chest', legs: 'Legs', hands: 'Hands', feet: 'Feet', back: 'Back', weapon: 'Weapon', offhand: 'Off-hand',
};
const TYPE_WORD = { cloth: 'Cloth', light: 'Light', heavy: 'Heavy', plain: 'Plain' } as const;
const OFFHAND_WORD = { buckler: 'Buckler', quiver: 'Quiver', shield: 'Shield', tome: 'Tome' } as const;

export type StatKey = StatDelta['key'];
export const STAT_KEYS: readonly StatKey[] = ['power', 'defence', 'maxHp', 'focus', 'flow', 'guard'];
const STAT_LABEL: Readonly<Record<StatKey, string>> = { power: 'Power', defence: 'Defence', maxHp: 'Health', focus: 'Focus', flow: 'Flow', guard: 'Guard' };
/** The short words of a summary ("+3 Power, −12 hp"). */
const STAT_SHORT: Readonly<Record<StatKey, string>> = { power: 'Power', defence: 'Defence', maxHp: 'hp', focus: 'Focus', flow: 'Flow', guard: 'Guard' };
const STAT_HINT: Readonly<Record<StatKey, string>> = {
  power: 'Your damage, heals and shields',
  defence: 'Less damage from every hit',
  maxHp: 'Your health',
  focus: 'Cloth: +1% ability damage, heals and shields per point',
  flow: 'Light: +1% Momentum gained per point',
  guard: 'Heavy: +1% threat and 1% less knockback per point',
};
const MINUS = '−';
/** A stat's value as shown: power and defence to 0.1, the rest whole. */
export const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, ''));
const signed = (d: number): string => (d > 0 ? `+${fmt(d)}` : d < 0 ? `${MINUS}${fmt(-d)}` : '');
const tenth = (v: number) => Math.round(v * 10) / 10;

/** An item's own stats in plain words ("+4.1 Defence · +11 hp · +3 Flow"). */
export function statLine(s: Partial<Record<StatKey, number>>): string {
  const out: string[] = [];
  for (const k of STAT_KEYS) { const v = s[k] ?? 0; if (v) out.push(`${signed(v)} ${STAT_SHORT[k]}`); }
  return out.length ? out.join(' · ') : 'No stats';
}

// ───────────────────────── where the adventurer stands ─────────────────────────

/** Everything the views need to know about the adventurer now (the server decides; these only explain). */
export interface GearCtx {
  zone: ZoneId; job: JobId; level: number; xp: number;
  talents: readonly string[]; picks: readonly string[]; outfit: JobOutfit | null;
  inCombat: boolean; dead: boolean; busy: boolean;
  /** Inside a sealed boss arena (Plan 5 ruling P5-h: no gear, talent or pick changes there). */
  sealed: boolean;
  /** The stall in reach, a town or sanctuary, the Guild Board in reach. */
  stall: StallId | null; jobSwitch: boolean; townBoard: boolean;
  x: number; z: number;
}
export function ctxFor(jobs: JobsView | null, w: { zone: ZoneId; x: number; z: number; inCombat: boolean; dead: boolean; busy: boolean; sealed: boolean }): GearCtx {
  const job: JobId = jobs && isJobId(jobs.current) ? jobs.current : 'warrior';
  const r = jobs?.jobs[job];
  const grove = w.zone === 'grove';
  return {
    zone: w.zone, job, level: r?.level ?? 1, xp: r?.xp ?? 0,
    talents: r?.talents ?? [], picks: r?.picks ?? JOBS[job].picks.solo, outfit: r?.outfit ?? null,
    inCombat: w.inCombat, dead: w.dead, busy: w.busy, sealed: w.sealed,
    stall: grove ? stallAt('grove', w.x, w.z) : null,
    jobSwitch: jobSwitchAt(zoneDef(w.zone), w.x, w.z),
    townBoard: grove && Math.hypot(w.x - GUILD_BOARD.x, w.z - GUILD_BOARD.z) <= STALL_REACH,
    x: w.x, z: w.z,
  };
}
/** Why nothing can change now (in the order the server checks), or null. */
function stateBlock(c: GearCtx): string | null {
  if (c.dead) return 'Not while knocked out';
  if (c.sealed) return 'Not inside a sealed boss arena';
  if (c.inCombat) return 'Not while fighting';
  if (c.busy) return 'Not while casting or charging';
  return null;
}

// ───────────────────────── gear, comparisons, sets ─────────────────────────

type Inst = InventoryView['bag'][number];
const bagInst = (v: InventoryView, uid: number | undefined): Inst | undefined => (uid === undefined ? undefined : v.bag.find((i) => i.uid === uid));
/** What `job` wears, slot by slot (bag instances). */
export function wornOf(v: InventoryView, job: JobId): Partial<Record<GearSlot, Inst>> {
  const out: Partial<Record<GearSlot, Inst>> = {};
  const g = v.gear?.[job] ?? {};
  for (const s of GEAR_SLOTS) { const i = bagInst(v, g[s]); if (i && fits(i.item, s, job)) out[s] = i; }
  return out;
}
const wornIds = (v: InventoryView, job: JobId): Partial<Record<GearSlot, ItemId>> => {
  const w = wornOf(v, job), out: Partial<Record<GearSlot, ItemId>> = {};
  for (const s of GEAR_SLOTS) { const i = w[s]; if (i) out[s] = i.item; }
  return out;
};
const kitStats = (c: GearCtx, gear: Partial<Record<GearSlot, ItemId>>): Required<Stats> => {
  const s = kitFor({ job: c.job, level: c.level, gear, talents: c.talents }).stats;
  return { power: s.power, defence: s.defence, maxHp: s.maxHp, focus: s.focus ?? 0, flow: s.flow ?? 0, guard: s.guard ?? 0 };
};
const BONUS_AT = [3, 5] as const;

/** Wearing item `id` in its slot on the current job instead of what is there: the kit's totals before → after. */
function compareItem(v: InventoryView, id: ItemId, c: GearCtx): Comparison | null {
  const it = ITEMS[id];
  if (!it || !fits(id, it.slot, c.job)) return null;
  const cur = wornIds(v, c.job);
  const after = { ...cur, [it.slot]: id };
  const a = kitStats(c, cur), b = kitStats(c, after);
  const lines: StatDelta[] = [];
  const sum: string[] = [];
  for (const k of STAT_KEYS) {
    if (!a[k] && !b[k]) continue;
    const d = tenth(b[k] - a[k]);
    lines.push({ key: k, label: STAT_LABEL[k], before: fmt(a[k]), after: fmt(b[k]), delta: signed(d), up: d > 0 ? true : d < 0 ? false : null });
    if (d) sum.push(`${signed(d)} ${STAT_SHORT[k]}`);
  }
  const ca = setCounts(cur), cb = setCounts(after);
  const sets: string[] = [];
  for (const set of SET_IDS) {
    if (set === 'plain') continue;
    const na = ca[set] ?? 0, nb = cb[set] ?? 0;
    for (const at of BONUS_AT) {
      const desc = at === 3 ? SETS[set].desc3 : SETS[set].desc5;
      if (na < at && nb >= at) sets.push(`Gains ${SETS[set].name} (${at}): ${desc}`);
      else if (na >= at && nb < at) sets.push(`Loses ${SETS[set].name} (${at}): ${desc}`);
    }
  }
  const was = cur[it.slot];
  return { replaces: was ? ITEMS[was]!.name : null, lines, summary: sum.length ? sum.join(', ') : 'No change to your stats', sets };
}
/** compare(view, uid, ctx): the bag item `uid` on the current job (null when it does not fit). */
export function compare(v: InventoryView, uid: number, c: GearCtx): Comparison | null {
  const i = bagInst(v, uid);
  return i ? compareItem(v, i.item, c) : null;
}

/** Each set the job wears pieces of: the count and both bonus lines, lit when active. */
export function setProgress(v: InventoryView, job: JobId): SetProgress[] {
  const counts = setCounts(wornIds(v, job));
  const out: SetProgress[] = [];
  for (const set of SET_IDS) {
    const n = counts[set] ?? 0;
    if (set === 'plain' || n === 0) continue;
    out.push(setOf(set, n));
  }
  return out;
}
function setOf(set: SetId, n: number): SetProgress {
  const d = SETS[set];
  const colour = d.tier === 0 ? TIER_COLOUR.starter : TIER_COLOUR[d.tier as 1 | 2 | 3];
  return { name: d.name, colour, pieces: n, of: ARMOUR_SLOTS.length, bonuses: [{ at: 3, text: d.desc3, on: n >= 3 }, { at: 5, text: d.desc5, on: n >= 5 }] };
}

const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
/** Why the bag item `uid` cannot go on the current job now, in plain words, or null when it can. */
export function equipBlock(v: InventoryView, uid: number, c: GearCtx): string | null {
  const i = bagInst(v, uid);
  if (!i) return 'That is not in your bag';
  const it = ITEMS[i.item]!;
  const job = JOBS[c.job], mine = WEAPONS[job.weapon].name;
  if (!fits(i.item, it.slot, c.job)) {
    if (it.slot === 'weapon') {
      const w = WEAPONS[it.weapon!].name;
      return `${article(job.name).replace(/^a/, 'A')} ${job.name} can't use ${article(w)} ${w}: ${job.name}s fight with ${article(mine)} ${mine}`;
    }
    const kind = OFFHAND_FOR[job.weapon];
    if (!kind) return `${job.name}s carry no off-hand: the ${mine} needs both hands`;
    return `${job.name}s carry ${article(kind)} ${kind} with the ${mine}, not ${article(it.offhand ?? '')} ${it.offhand}`;
  }
  const s = stateBlock(c);
  if (s) return s;
  // the piece it replaces goes back to the bag when no other job wears it
  const old = bagInst(v, v.gear?.[c.job]?.[it.slot]);
  if (old && old.uid !== i.uid) {
    const used = v.bag.filter((x) => x.worn.length === 0).length;
    const oldFrees = old.worn.length === 1 && old.worn[0] === c.job;
    const after = used - (i.worn.length === 0 ? 1 : 0) + (oldFrees ? 1 : 0);
    if (after > BAG_SLOTS) return 'Your bag is full: sell or bank something first';
  }
  return null;
}

const iconOf = (id: ItemId): IconSpec => {
  const it = ITEMS[id]!;
  return {
    slot: it.slot, type: it.type ?? null, kind: it.weapon ?? it.offhand ?? null, tier: it.tier, named: !!it.named, colour: itemColour(id),
  };
};
function kindLabel(id: ItemId): string {
  const it = ITEMS[id]!;
  if (it.slot === 'weapon') return WEAPONS[it.weapon!].name;
  if (it.slot === 'offhand') return `${OFFHAND_WORD[it.offhand!]} (off-hand)`;
  return `${TYPE_WORD[it.type!]} armour · ${SLOT_LABEL[it.slot]}`;
}
type Where = 'bag' | 'vault' | 'slot' | 'shop';
/** One item as a card: its words, its set on the current job, and what can be done with it here. */
export function itemView(v: InventoryView, inst: { uid: number; item: ItemId; dye: [number, number]; worn?: JobId[] }, c: GearCtx, where: Where): ItemView {
  const it = ITEMS[inst.item]!;
  const worn = (inst.worn ?? []).filter(isJobId);
  const wornHere = worn.includes(c.job);
  const sets = it.set && it.set !== 'plain' ? setProgress(v, c.job).find((s) => s.name === SETS[it.set!].name) ?? setOf(it.set, 0) : null;
  let equip: ItemView['equip'] = null;
  if (where === 'shop') {
    const cmp = compareItem(v, inst.item, c);
    equip = cmp ? { slot: it.slot, ok: false, why: null, cmp } : null;
  } else if (where === 'bag' && !wornHere) {
    const why = equipBlock(v, inst.uid, c);
    equip = { slot: it.slot, ok: why === null, why, cmp: compareItem(v, inst.item, c) };
  }
  let sell: ItemView['sell'] = null;
  if (where === 'bag' && c.stall === 'smithy') {
    const why = it.sell <= 0 ? INV_TEXT.starter : worn.length ? `Worn by ${worn.map((j) => JOBS[j].name).join(', ')}: take it off first` : stateBlock(c);
    sell = { price: it.sell, confirm: it.tier >= 2, ok: why === null, why };
  }
  let bank: ItemView['bank'] = null;
  if (c.stall === 'vault' && (where === 'bag' || where === 'vault')) {
    if (where === 'bag') {
      const why = it.tier === 0 ? INV_TEXT.starter : worn.length ? `Worn by ${worn.map((j) => JOBS[j].name).join(', ')}: take it off first`
        : v.bank.length >= BANK_SLOTS ? INV_TEXT['bank-full'] : stateBlock(c);
      bank = { dir: 'in', ok: why === null, why };
    } else {
      const free = BAG_SLOTS - v.bag.filter((x) => x.worn.length === 0).length;
      const why = free <= 0 ? INV_TEXT['bag-full'] : stateBlock(c);
      bank = { dir: 'out', ok: why === null, why };
    }
  }
  return {
    uid: inst.uid, item: inst.item, name: it.name, colour: itemColour(inst.item), icon: iconOf(inst.item),
    tierLabel: it.named ? 'Named · Warden' : TIER_WORD[it.tier], ilvl: it.ilvl, kindLabel: kindLabel(inst.item),
    stats: statLine(itemStats(inst.item)), set: sets, namedLine: it.named?.line ?? null,
    worn: worn.map((j) => ({ job: j, glyph: JOBS[j].glyph, name: JOBS[j].name })), wornHere,
    dye: [inst.dye?.[0] ?? 0, inst.dye?.[1] ?? 0], equip, sell, bank,
  };
}

// ───────────────────────── talents and the wardrobe ─────────────────────────

/** The talents of the current job, row by row, with what each needs and whether it can be chosen here and now. */
export function talentsView(v: InventoryView, c: GearCtx): TalentsView {
  const job = JOBS[c.job];
  const onBar = new Set<string>([...job.bar, ...c.picks]);
  const block = stateBlock(c);
  const canChoose = c.jobSwitch && block === null;
  const rows = talentsFor(c.job).map((row, r) => {
    const level = TALENT_LEVELS[r]!;
    const chosenIdx = row.findIndex((t) => c.talents.includes(t.id));
    return {
      row: r as 0 | 1 | 2, level, unlocked: c.level >= level, chosen: chosenIdx >= 0 ? chosenIdx : null,
      cards: row.map((t) => {
        const missing: string[] = [];
        for (const m of t.mods) {
          const a = (m as { ability?: string }).ability;
          if (a && a !== 'all' && !onBar.has(a) && ABILITIES[a as keyof typeof ABILITIES]) {
            const name = ABILITIES[a as keyof typeof ABILITIES].name;
            if (!missing.includes(name)) missing.push(name);
          }
        }
        return { id: t.id, name: t.name, desc: t.desc, needs: missing.length ? `Needs ${missing.join(' and ')} on your bar` : null, chosen: c.talents.includes(t.id) };
      }),
    };
  });
  const n = c.talents.length;
  const free = v.freeRespec;
  const price = free ? 0 : RESPEC_PRICE * n;
  const why = n === 0 ? 'No talents chosen yet'
    : !c.townBoard ? 'Retrain at the Guild Board in Shady Grove'
      : block ?? (v.gold < price ? `Need ${price - v.gold} more gold` : null);
  return {
    jobName: job.name, level: c.level, rows,
    canChoose, chooseNote: canChoose ? null : !c.jobSwitch ? 'Choose talents in a town or sanctuary' : block,
    respec: { price, free, ok: why === null, why, rows: n },
  };
}

const COSTUME_LABEL: Readonly<Record<CostumeSlot, string>> = { body: 'Body', head: 'Head', back: 'Back' };
export function wardrobeView(v: InventoryView, c: GearCtx): WardrobeView {
  const o = c.outfit;
  const slots = (['body', 'head', 'back'] as const).map((slot) => {
    const worn = o?.[slot] ?? null;
    return {
      slot, label: COSTUME_LABEL[slot], worn: worn && v.wardrobe.includes(worn) ? COSTUMES[worn].name : null,
      options: v.wardrobe.filter((id) => COSTUMES[id]?.slot === slot).map((id) => ({ id, name: COSTUMES[id].name, event: COSTUMES[id].price === null, worn: worn === id })),
    };
  });
  return { slots, hideHead: !!o?.hideHead, owned: v.wardrobe.length, why: c.dead ? 'Not while knocked out' : c.inCombat ? 'Not while fighting' : c.busy ? 'Not while casting or charging' : null };
}

// ───────────────────────── the character sheet ─────────────────────────

export function charSheetView(v: InventoryView, c: GearCtx): CharSheetView {
  const job = JOBS[c.job];
  const worn = wornOf(v, c.job);
  const slots = GEAR_SLOTS.map((slot) => {
    const i = worn[slot];
    let none: string | null = null;
    if (!i && slot === 'offhand' && !OFFHAND_FOR[job.weapon]) none = job.weapon === 'daggers' ? 'A pair of daggers: no off-hand' : 'Two-handed: no off-hand';
    const why = stateBlock(c);
    return { slot, label: SLOT_LABEL[slot], item: i ? itemView(v, i, c, 'slot') : null, none, takeOff: { ok: why === null, why } };
  });
  const level = Math.min(JOB_LEVEL_CAP, Math.max(1, c.level));
  const top = level >= JOB_LEVEL_CAP;
  const into = c.xp - totalTo(level), need = top ? 1 : XP_TO_NEXT[level - 1]!;
  const named = worn.weapon ? ITEMS[worn.weapon.item]?.named?.line ?? null : null;
  const talents = talentsView(v, c);
  return {
    jobId: c.job, jobName: job.name, jobGlyph: job.glyph, level,
    xpFrac: top ? 1 : Math.max(0, Math.min(1, into / need)), xpText: top ? 'Top level' : `${Math.max(0, into)} / ${need} xp`,
    gold: v.gold, seals: v.seals,
    stats: STAT_KEYS.map((k) => ({ key: k, label: STAT_LABEL[k], value: fmt(v.stats[k] ?? 0), hint: STAT_HINT[k] })),
    slots, sets: setProgress(v, c.job), named,
    bag: v.bag.filter((i) => i.worn.length === 0).map((i) => itemView(v, i, c, 'bag')), bagSlots: BAG_SLOTS,
    wornElsewhere: v.bag.filter((i) => i.worn.length > 0 && !i.worn.includes(c.job) && ITEMS[i.item]!.tier > 0).map((i) => itemView(v, i, c, 'bag')),
    vault: c.stall === 'vault' ? v.bank.map((i) => itemView(v, i, c, 'vault')) : null, vaultSlots: BANK_SLOTS,
    talents, wardrobe: wardrobeView(v, c),
    openRows: talents.rows.filter((r) => r.unlocked && r.chosen === null).length,
    at: c.stall ? TOWN_STALLS[c.stall].name : null,
  };
}

// ───────────────────────── the stalls ─────────────────────────

const GREETING: Readonly<Record<StallId, string>> = {
  smithy: 'Greenway steel, hammered this week. Bring me what you find out there and I will pay fair.',
  lampwright: "Warden's Seals buy Warden's work. Nothing else will.",
  tailor: 'A new coat, a new colour? Sit, sit. Mind the pins.',
  barber: 'A trim, a new face, a new you.',
  vault: 'Your things are safe with us. Sign here, and here.',
};
const FILTERS = [{ id: 'cloth', label: 'Cloth' }, { id: 'light', label: 'Light' }, { id: 'heavy', label: 'Heavy' }, { id: 'weapons', label: 'Weapons' }];

export function vendorView(stall: StallId, v: InventoryView, c0: GearCtx, at: { x: number; z: number }): VendorView {
  const s = TOWN_STALLS[stall];
  const here = c0.zone === 'grove' && stallAt('grove', at.x, at.z) === stall;
  const c: GearCtx = { ...c0, stall: here ? stall : c0.stall };
  const why = here ? stateBlock(c) : `Walk up to ${s.name} to buy`;
  const rows: Record<string, ShopRow[]> = {};
  const owned = (id: ItemId) => v.bag.filter((i) => i.item === id).length + v.bank.filter((i) => i.item === id).length;
  const tier = stall === 'smithy' ? 1 : stall === 'lampwright' ? 3 : -1;
  if (tier > 0) {
    const currency = tier === 1 ? 'gold' as const : 'seals' as const;
    const have = tier === 1 ? v.gold : v.seals;
    const mine = wornIds(v, c.job);
    const row = (id: ItemId): ShopRow => {
      const it = ITEMS[id]!, price = (tier === 1 ? it.price : it.seals) ?? 0;
      const short = price - have;
      const forMe = fits(id, it.slot, c.job);
      const users = it.slot === 'weapon' || it.slot === 'offhand' ? JOB_IDS.filter((j) => fits(id, it.slot, j)).map((j) => JOBS[j].name).join(', ') : null;
      return {
        item: itemView(v, { uid: 0, item: id, dye: [0, 0] }, c, 'shop'), price, currency, owned: owned(id),
        ok: short <= 0, why: short <= 0 ? null : `Need ${short} more ${currency === 'gold' ? 'gold' : short === 1 ? "Warden's Seal" : "Warden's Seals"}`,
        fitsLabel: users, forMe, wearing: mine[it.slot] === id,
      };
    };
    const sold = ITEM_IDS.filter((id) => ITEMS[id]!.tier === tier && (tier === 1 ? ITEMS[id]!.price !== undefined : ITEMS[id]!.seals !== undefined));
    for (const f of ['cloth', 'light', 'heavy'] as const) {
      rows[f] = ARMOUR_SLOTS.map((slot) => sold.find((id) => ITEMS[id]!.type === f && ITEMS[id]!.slot === slot)).filter((id): id is ItemId => !!id).map(row);
    }
    const weapons = sold.filter((id) => ITEMS[id]!.slot === 'weapon' || ITEMS[id]!.slot === 'offhand').map(row);
    weapons.sort((a, b) => Number(b.forMe) - Number(a.forMe));
    rows.weapons = weapons;
  }
  const costumes = stall === 'tailor' ? COSTUME_IDS.map((id) => {
    const d = COSTUMES[id], own = v.wardrobe.includes(id), event = d.price === null;
    const short = (d.price ?? 0) - v.gold;
    const w = own ? 'Owned' : event ? 'Event only: given at events' : short > 0 ? `Need ${short} more gold` : null;
    return { id, name: d.name, slot: COSTUME_LABEL[d.slot], price: d.price, owned: own, event, ok: w === null, why: w };
  }) : [];
  const dyeTargets: VendorView['dyeTargets'] = [];
  if (stall === 'tailor') {
    const worn = wornOf(v, c.job);
    for (const slot of ARMOUR_SLOTS) {
      const i = worn[slot];
      if (i) dyeTargets.push({ key: `item:${i.uid}`, label: `${SLOT_LABEL[slot]} · ${ITEMS[i.item]!.name}`, short: ITEMS[i.item]!.name.split(' ').pop()!, colour: itemColour(i.item), kind: 'item', uid: i.uid, costume: null, dye: [i.dye[0], i.dye[1]] });
    }
    for (const id of v.wardrobe) {
      const d = v.costumeDyes?.[id] ?? [0, 0];
      dyeTargets.push({ key: `costume:${id}`, label: `Costume · ${COSTUMES[id].name}`, short: COSTUMES[id].name, colour: '#ffe2a0', kind: 'costume', uid: null, costume: id, dye: [d[0], d[1]] });
    }
  }
  return {
    stall, name: s.name, keeper: s.keeper, greeting: GREETING[stall], gold: v.gold, seals: v.seals,
    here, why,
    filters: tier > 0 ? FILTERS : [], defaultFilter: tier > 0 ? JOB_ARMOUR[c.job] : '',
    rows,
    sell: stall === 'smithy' ? v.bag.filter((i) => i.worn.length === 0 && ITEMS[i.item]!.sell > 0).map((i) => itemView(v, i, c, 'bag')) : [],
    costumes, dyeTargets,
    dyes: stall === 'tailor' ? DYES.map((d, id) => ({ id, name: d.name, hex: id === 0 ? null : d.hex })) : [],
    dyePrice: DYE_PRICE,
  };
}

// ───────────────────────── loot and the level-up moment ─────────────────────────

const isObj = (m: unknown): m is Record<string, unknown> => typeof m === 'object' && m !== null && !Array.isArray(m);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function lootShow(m: unknown): LootShow | null {
  if (!isObj(m) || !Array.isArray(m.items) || !num(m.gold)) return null;
  const items: LootShow['items'] = [];
  for (const e of m.items) {
    if (!isObj(e) || !isItemId(e.item)) continue;
    const it = ITEMS[e.item]!;
    items.push({ name: it.name, colour: itemColour(e.item), named: !!it.named });
  }
  return { items, gold: Math.max(0, Math.floor(m.gold)), soldFor: num(m.soldFor) ? Math.max(0, Math.floor(m.soldFor)) : 0 };
}

export function levelShow(m: unknown, c: GearCtx): LevelShow | null {
  if (!isObj(m) || !isJobId(m.job) || !num(m.level) || m.level < 2) return null;
  const a = baseStats(m.level - 1), b = baseStats(m.level);
  const gains = statLine({ power: tenth(b.power - a.power), defence: tenth(b.defence - a.defence), maxHp: Math.round(b.maxHp - a.maxHp) });
  const row = m.talentRow === 0 || m.talentRow === 1 || m.talentRow === 2 ? m.talentRow : null;
  let talent: LevelShow['talent'] = null;
  if (row !== null) {
    const why = !c.jobSwitch ? 'Visit a town or sanctuary to choose it' : c.inCombat ? 'Choose it after the fight' : stateBlock(c);
    talent = { row, ok: why === null, why };
  }
  return { jobName: JOBS[m.job].name, level: m.level, gains, talent };
}

// ───────────────────────── the client state and the op gate ─────────────────────────

/** How long an op waits for its answer before a resend is allowed (ms). */
export const OP_GATE_MS = 4000;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
/** A fresh random operation id (16 of A–Z a–z 0–9 _ -). */
export function newOpId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += ID_ALPHABET[bytes[i]! & 63];
  return s;
}
/** What makes two ops "the same tap": the op and its fields (never the id). */
export function opKey(op: InvOp): string {
  const o = op as unknown as Record<string, unknown>;
  return `${op.op}:${Object.keys(o).filter((k) => k !== 'op' && k !== 'id').sort().map((k) => String(o[k])).join(':')}`;
}

const STALL_OPS = new Set(['buy', 'sell', 'bank', 'unbank', 'buyCostume', 'dye', 'dyeCostume']);
/** A refusal as the player should read it: where to go or what to do, else the server's own line. */
export function refusalLine(op: unknown, reason: unknown, text: unknown): string {
  const t = typeof text === 'string' && text ? text : typeof reason === 'string' && reason in INV_TEXT ? INV_TEXT[reason as keyof typeof INV_TEXT] : 'That did not work';
  if (reason === 'where') {
    if (op === 'buy') return 'Stand at the stall to buy';
    if (typeof op === 'string' && STALL_OPS.has(op)) return 'Stand at the stall to do that';
    if (op === 'talent') return 'Choose talents in a town or sanctuary';
    if (op === 'respec') return 'Retrain at the Guild Board in Shady Grove';
  }
  if (reason === 'combat' && (op === 'equip' || op === 'unequip' || op === 'talent' || op === 'respec')) return 'Not while fighting, or inside a sealed boss arena';
  if (reason === 'fit' && op === 'equip') return "That doesn't fit your current job";
  if (reason === 'bag-full') return 'Your bag is full: sell or bank something first';
  if (reason === 'level') return 'Your job level is too low for that talent row';
  return t;
}

function isInventoryView(m: unknown): m is InventoryView {
  return isObj(m) && Array.isArray(m.bag) && Array.isArray(m.bank) && num(m.gold) && num(m.seals) && isObj(m.stats) && isObj(m.gear)
    && Array.isArray(m.wardrobe) && Array.isArray(m.sets) && typeof m.freeRespec === 'boolean'
    && m.bag.every((i) => isObj(i) && num(i.uid) && typeof i.item === 'string' && Array.isArray(i.worn) && Array.isArray(i.dye))
    && m.bank.every((i) => isObj(i) && num(i.uid) && typeof i.item === 'string' && Array.isArray(i.dye));
}

/** The client's inventory: the server's last view, the last loot, refusals and level-ups (for playtests), and the op gate. */
export class InvClient {
  view: InventoryView | null = null;
  lastLoot: { items: string[]; gold: number } | null = null;
  refusals: string[] = [];
  levelUps: { job: string; level: number }[] = [];
  private pending: { key: string; op: string; at: number }[] = [];
  private keys = new Set<string>();

  /** A new view (after join, a change, or a resent op id). False: not an inventory (ignored). */
  onInventory(m: unknown): boolean {
    if (!isInventoryView(m)) return false;
    // keep only known items: a newer server's item this client cannot name is left out of the screens
    this.view = { ...m, bag: m.bag.filter((i) => isItemId(i.item)), bank: m.bank.filter((i) => isItemId(i.item)) };
    this.settle(null);
    return true;
  }
  onLoot(m: unknown): LootShow | null {
    const l = lootShow(m);
    if (l) this.lastLoot = { items: l.items.map((i) => i.name), gold: l.gold };
    return l;
  }
  onLevelUp(m: unknown): { job: JobId; level: number; talentRow: 0 | 1 | 2 | null } | null {
    if (!isObj(m) || !isJobId(m.job) || !num(m.level)) return null;
    this.levelUps.push({ job: m.job, level: m.level });
    if (this.levelUps.length > 20) this.levelUps.shift();
    const r = m.talentRow;
    return { job: m.job, level: m.level, talentRow: r === 0 || r === 1 || r === 2 ? r : null };
  }
  /** A refusal: its line (kept, the last 20), and the op it answers stops waiting. */
  onRefused(m: unknown): string | null {
    if (!isObj(m)) return null;
    const line = refusalLine(m.op, m.reason, m.text);
    this.refusals.push(typeof m.text === 'string' ? m.text : line);
    if (this.refusals.length > 20) this.refusals.shift();
    this.settle(typeof m.op === 'string' ? m.op : null);
    return line;
  }
  /** The op to send now (with a fresh random id), or null while the same op still waits for its answer (a double tap). */
  begin(op: InvOp, now: number): InvOp | null {
    this.expire(now);
    const key = opKey(op);
    if (this.keys.has(key)) return null;
    this.pending.push({ key, op: op.op, at: now });
    this.keys.add(key);
    return { ...op, id: newOpId() } as InvOp;
  }
  /** Takes back the gate of an op begun but never sent (no room to send it to). */
  unbegin(op: InvOp): void {
    const key = opKey(op);
    const k = this.pending.findIndex((p) => p.key === key);
    if (k < 0) return;
    this.keys.delete(key);
    this.pending.splice(k, 1);
  }
  pendingKeys(): ReadonlySet<string> { return this.keys; }
  /** Drops gates older than OP_GATE_MS; true when any went. */
  expire(now: number): boolean {
    let gone = false;
    for (let k = this.pending.length - 1; k >= 0; k--) {
      if (now - this.pending[k]!.at > OP_GATE_MS) { this.keys.delete(this.pending[k]!.key); this.pending.splice(k, 1); gone = true; }
    }
    return gone;
  }
  /** The oldest waiting op (of `op`, when given) has its answer. */
  private settle(op: string | null): void {
    const k = op === null ? (this.pending.length ? 0 : -1) : this.pending.findIndex((p) => p.op === op);
    if (k < 0) return;
    this.keys.delete(this.pending[k]!.key);
    this.pending.splice(k, 1);
  }
  /** Forget everything (a sign-out). */
  reset(): void { this.view = null; this.lastLoot = null; this.pending = []; this.keys.clear(); }
}

/**
 * An op sent from outside the gear screens (the quest's "Equip now"), through the same gate: it carries a fresh id, a
 * double tap sends nothing, and its `inventory` answer settles its own wait (never another op's). False: not sent.
 */
export function sendGated(inv: InvClient, op: InvOp, send: (op: InvOp) => boolean, now: number): boolean {
  const gated = inv.begin(op, now);
  if (!gated) return false;
  if (send(gated)) return true;
  inv.unbegin(op);
  return false;
}
