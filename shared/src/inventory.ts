// The inventory: the bag, the Vault, what each job wears, the wardrobe, and every operation on them as a
// pure function the server calls through one queue per session (Task 6).
//
// Never lose, never duplicate, by construction:
// - every operation is validate-then-apply on a copy: the input is never changed, and the result is a new
//   state with the exact gold and Seal deltas (dGold, dSeals), or a refusal and no change at all;
// - an item instance exists in exactly one place (the bag or the Vault); worn means "a job's gear refers to
//   a bag uid", so equipping moves nothing and nothing can be worn and sold or banked at once;
// - uids are minted only from nextUid, which only grows; gold and Seals never go below 0 (refused) and gold
//   never above GOLD_MAX (clamped, and dGold says what really changed);
// - an operation with a client operation id (`id`) applies at most once: a resend of an id in recentOps is a
//   no-op ({ dup: true }, the same state object); a loot award applies at most once per kill key (recentKills).
// The store's compare-and-set on inv_version (Task 6) makes each result one atomic write.
import { JOBS, JOB_IDS, isJobId, recordFor, type JobId, type JobOutfit, type JobsSave } from './combat/jobs';
import type { Stats } from './combat/stats';
import { COSTUMES, COSTUME_IDS, isCostumeId, isDyeId, type CostumeId, type CostumeSlot, type DyeId } from './costumes';
import {
  GEAR_SLOTS, ITEMS, SET_IDS, fits, isArmourSlot, isGearSlot, isItemId, starterFor, starterItems, type GearSlot, type ItemId, type SetId,
} from './items';
import { kitFor, setCounts } from './kit';
import { levelForXp, TALENT_LEVELS } from './progression';
import { validTalents } from './talents';
import { resolveGearLook, type GearLook, type GearLookSlot } from './look';
import type { StallId } from './world/zones';

/** Unworn items the bag holds. */
export const BAG_SLOTS = 30;
/** Items the Vault holds (only at its stall). */
export const BANK_SLOTS = 60;
/** Gold never exceeds this (extra is dropped, with a notice). */
export const GOLD_MAX = 1_000_000;
/** Kill keys remembered per adventurer for de-duplication. */
export const RECENT_KILLS = 64;
/** Client operation ids remembered per adventurer (as `${op}:${id}`), so a resent operation applies once. */
export const RECENT_OPS = 64;
/** An operation id is a random string of this many characters or more (ruling P5-e). */
export const OP_ID_MIN = 12;
/** Operations refused without an operation id (ruling P5-e): purchases (gold or Seals) and Vault moves. */
export const OPS_NEEDING_ID: readonly InvOpName[] = Object.freeze(['buy', 'buyCostume', 'bank', 'unbank']);
/** Gold per dye change (a channel set to the dye it already has is free and changes nothing). */
export const DYE_PRICE = 5;
/** Gold per chosen row for a retraining after the first (free) one per job. */
export const RESPEC_PRICE = 25;
/** Operations per session per second (the server's token bucket of 8, refilling 8 a second; more → 'rate'). */
export const INV_OPS_PER_S = 8;
/** The longest id string an operation may carry. */
export const INV_STRING_MAX = 40;

export interface ItemInst { uid: number; item: ItemId; dye: [DyeId, DyeId] }
export interface InventorySave {
  v: 1; nextUid: number;
  bag: ItemInst[]; bank: ItemInst[];
  /** Per job: slot → the uid of a bag item. One item may be worn by several jobs; a worn item takes no bag slot. */
  gear: Partial<Record<JobId, Partial<Record<GearSlot, number>>>>;
  wardrobe: CostumeId[]; costumeDyes: Partial<Record<CostumeId, [DyeId, DyeId]>>;
  /** The UTC day of each daily guaranteed drop. */
  lootDays: { wickhound: string | null; fallen_warden: string | null };
  recentKills: string[];
  /** Client operations already applied, as `${op}:${id}`, oldest first (at most RECENT_OPS). */
  recentOps: string[];
  freeRespecUsed: JobId[];
}

type WithId<T> = T & { id?: string };
/**
 * One operation: what a client may ask for (ids only; the server owns every price and amount). `id`: a client
 * operation id (12–40 of A–Z a–z 0–9 _ -), required for OPS_NEEDING_ID and optional otherwise.
 */
export type InvOp = WithId<
  | { op: 'equip'; uid: number; slot: GearSlot }
  | { op: 'unequip'; slot: GearSlot }
  | { op: 'bank'; uid: number }
  | { op: 'unbank'; uid: number }
  | { op: 'sell'; uid: number }
  | { op: 'buy'; stall: StallId; item: ItemId }
  | { op: 'buyCostume'; costume: CostumeId }
  | { op: 'wear'; slot: CostumeSlot; costume: CostumeId | null }
  | { op: 'hideHead'; hide: boolean }
  | { op: 'dye'; uid: number; ch: 0 | 1; dye: DyeId }
  | { op: 'dyeCostume'; costume: CostumeId; ch: 0 | 1; dye: DyeId }
  | { op: 'talent'; row: 0 | 1 | 2; choice: 0 | 1 | 2 }
  | { op: 'respec' }
>;
export type InvOpName = InvOp['op'];

export type InvRefusal = 'where' | 'combat' | 'busy' | 'dead' | 'unknown' | 'fit' | 'worn' | 'starter' | 'bag-full' | 'bank-full' | 'gold' | 'seals' | 'owned' | 'level' | 'taken' | 'rate'
  | 'no-id' | 'purse-full' | 'uids';
export const INV_TEXT: Readonly<Record<InvRefusal, string>> = Object.freeze({
  where: 'You need to be somewhere else for that',
  combat: 'Not while fighting',
  busy: 'Not while casting, charging or travelling',
  dead: 'Not while knocked out',
  unknown: "That isn't something you can do",
  fit: "That doesn't fit there",
  worn: 'Take it off first',
  starter: 'Starter gear cannot be sold or banked',
  'bag-full': 'Your bag is full',
  'bank-full': 'The Vault is full',
  gold: 'Not enough gold',
  seals: "Not enough Warden's Seals",
  owned: 'You already own that',
  level: 'Your job level is too low for that',
  taken: 'You have already chosen a talent in that row',
  rate: 'Slow down a little',
  'no-id': 'Something went wrong; please try again',
  'purse-full': 'Your purse is full',
  uids: 'Your inventory cannot take any more new items',
});

/** What an operation works on: the inventory and the jobs (talents and outfits), gold and Seals. */
export interface InvState { inv: InventorySave; gold: number; seals: number; jobs: JobsSave }
/**
 * Where and how the adventurer stands, from the server's own view: stall = stallAt(zone, x, z);
 * jobSwitch = the zone's jobSwitch(x, z) (a town or sanctuary); townBoard = within reach of the Guild Board
 * in the grove; busy = casting, charging or travelling.
 */
export interface InvCtx { stall: StallId | null; jobSwitch: boolean; townBoard: boolean; inCombat: boolean; dead: boolean; busy: boolean }
export type InvResult = { state: InvState; dGold: number; dSeals: number; dup?: true } | { refusal: InvRefusal };

// ───────── parsing an operation ─────────
const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const UID_MAX = 2 ** 31 - 1;
const isUid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= UID_MAX;
const shortStr = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= INV_STRING_MAX;
const OP_ID = /^[A-Za-z0-9_-]{12,40}$/;
const isOpId = (v: unknown): v is string => typeof v === 'string' && OP_ID.test(v);
/** A remembered operation: `${op}:${id}`. */
const isOpKey = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  const k = v.indexOf(':');
  return k > 0 && own(FIELDS, v.slice(0, k)) && isOpId(v.slice(k + 1));
};
/** A uid may still be minted. */
const canMint = (inv: InventorySave) => isUid(inv.nextUid);
const STALLS: readonly StallId[] = ['smithy', 'tailor', 'barber', 'lampwright', 'vault'];
const COSTUME_SLOTS: readonly CostumeSlot[] = ['body', 'head', 'back'];
const ch = (v: unknown): v is 0 | 1 => v === 0 || v === 1;
const row3 = (v: unknown): v is 0 | 1 | 2 => v === 0 || v === 1 || v === 2;

type Check = (v: unknown) => boolean;
const FIELDS: Readonly<Record<InvOpName, Readonly<Record<string, Check>>>> = {
  equip: { uid: isUid, slot: isGearSlot },
  unequip: { slot: isGearSlot },
  bank: { uid: isUid },
  unbank: { uid: isUid },
  sell: { uid: isUid },
  buy: { stall: v => (STALLS as readonly unknown[]).includes(v), item: shortStr },
  buyCostume: { costume: shortStr },
  wear: { slot: v => (COSTUME_SLOTS as readonly unknown[]).includes(v), costume: v => v === null || shortStr(v) },
  hideHead: { hide: v => typeof v === 'boolean' },
  dye: { uid: isUid, ch, dye: isDyeId },
  dyeCostume: { costume: shortStr, ch, dye: isDyeId },
  talent: { row: row3, choice: row3 },
  respec: {},
};

/**
 * Strict: exactly an operation's fields with the right types and ranges (strings at most 40 characters), plus
 * an op id (12–40 characters) when given; else null. Ids are checked against the tables by applyInvOp, which
 * also refuses OPS_NEEDING_ID without one.
 */
export function parseInvOp(v: unknown): InvOp | null {
  if (!plain(v) || !own(FIELDS, v.op)) return null;
  const f = FIELDS[v.op as InvOpName];
  const out: Record<string, unknown> = { op: v.op };
  for (const k of Object.keys(v)) {
    if (k === 'op') continue;
    if (k === 'id') { if (!isOpId(v.id)) return null; out.id = v.id; continue; }
    if (!own(f, k) || !f[k]!(v[k])) return null;
    out[k] = v[k];
  }
  for (const k of Object.keys(f)) if (!(k in out)) return null;
  return out as InvOp;
}

// ───────── reading the inventory ─────────
/** The jobs that wear bag item `uid`, in JOB_IDS order. */
export function wornBy(inv: InventorySave, uid: number): JobId[] {
  return JOB_IDS.filter(job => GEAR_SLOTS.some(s => inv.gear[job]?.[s] === uid));
}
function wornUids(inv: InventorySave): Set<number> {
  const out = new Set<number>();
  for (const job of JOB_IDS) for (const s of GEAR_SLOTS) { const u = inv.gear[job]?.[s]; if (u !== undefined) out.add(u); }
  return out;
}
/** Bag slots in use: bag items no job wears. */
export function bagUsed(inv: InventorySave): number {
  const worn = wornUids(inv);
  return inv.bag.filter(i => !worn.has(i.uid)).length;
}
/** What `job` wears, as item ids (slots with no stored item are absent; kitFor fills them with the starter piece). */
export function gearItems(inv: InventorySave, job: JobId): Partial<Record<GearSlot, ItemId>> {
  const out: Partial<Record<GearSlot, ItemId>> = {};
  const g = inv.gear?.[job];
  if (!g) return out;
  for (const s of GEAR_SLOTS) {
    const u = g[s];
    const it = u === undefined ? undefined : inv.bag.find(i => i.uid === u);
    if (it) out[s] = it.item;
  }
  return out;
}
/** Every item id held (bag, which includes worn items, and the Vault): rollLoot's `owned`. */
export function ownedItems(inv: InventorySave): Set<ItemId> {
  return new Set([...(inv.bag ?? []), ...(inv.bank ?? [])].map(i => i.item));
}

const cleanDyes = (d: readonly unknown[] | undefined): [DyeId, DyeId] =>
  [isDyeId(d?.[0]) ? d![0] as number : 0, isDyeId(d?.[1]) ? d![1] as number : 0];

/** A new adventurer's inventory: the 16 starter items (uids 1–16, dyed with the creator's two outfit dyes), worn by every job. */
export function newInventory(dyes: [DyeId, DyeId]): InventorySave {
  const dye = cleanDyes(dyes);
  const bag: ItemInst[] = starterItems().map((item, i) => ({ uid: i + 1, item, dye: [dye[0], dye[1]] }));
  const gear: InventorySave['gear'] = {};
  for (const job of JOB_IDS) {
    const g: Partial<Record<GearSlot, number>> = {};
    for (const s of GEAR_SLOTS) {
      const id = starterFor(job, s);
      if (id) g[s] = bag.find(i => i.item === id)!.uid;
    }
    gear[job] = g;
  }
  return {
    v: 1, nextUid: bag.length + 1, bag, bank: [], gear, wardrobe: [], costumeDyes: {},
    lootDays: { wickhound: null, fallen_warden: null }, recentKills: [], recentOps: [], freeRespecUsed: [],
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY_MAX = 120;

/** JSON with sorted keys: how "unchanged by repair" is judged (stored JSON may reorder keys). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (plain(v)) return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/**
 * An inventory from stored data; never throws. Garbage gives newInventory(dyes). Otherwise: unknown item
 * ids, bad uids and duplicate uids (the later one) are dropped and bad dyes read as undyed; every job gets
 * every slot it can wear, where a missing ref, a ref to a missing uid or to an item that does not fit falls
 * back to the starter piece (a new one when it is gone); nextUid is above every uid; the wardrobe keeps
 * known costumes once each; the bag is capped at BAG_SLOTS unworn items (the overflow moves to the Vault,
 * then is dropped) and the Vault at BANK_SLOTS. repaired: anything was changed.
 */
export function parseInventory(v: unknown, dyes: [DyeId, DyeId] = [0, 0]): { inv: InventorySave; repaired: boolean } {
  if (!plain(v) || v.v !== 1) return { inv: newInventory(dyes), repaired: true };
  const seen = new Set<number>();
  const readList = (l: unknown): ItemInst[] => {
    const out: ItemInst[] = [];
    if (!Array.isArray(l)) return out;
    for (const e of l) {
      if (!plain(e) || !isUid(e.uid) || !isItemId(e.item) || seen.has(e.uid)) continue;
      seen.add(e.uid);
      out.push({ uid: e.uid, item: e.item, dye: cleanDyes(Array.isArray(e.dye) && e.dye.length === 2 ? e.dye : undefined) });
    }
    return out;
  };
  const bag = readList(v.bag);
  let bank = readList(v.bank);
  let nextUid = Math.max(isUid(v.nextUid) ? v.nextUid : 1, ...[...seen].map(u => u + 1), 1);

  const rawGear = plain(v.gear) ? v.gear : {};
  const gear: InventorySave['gear'] = {};
  for (const job of JOB_IDS) {
    const rg = plain(rawGear[job]) ? rawGear[job] as Record<string, unknown> : {};
    const g: Partial<Record<GearSlot, number>> = {};
    for (const s of GEAR_SLOTS) {
      const fallback = starterFor(job, s);
      if (!fallback) continue;
      const u = rg[s];
      const inst = isUid(u) ? bag.find(i => i.uid === u) : undefined;
      if (inst && fits(inst.item, s, job)) { g[s] = inst.uid; continue; }
      let starter = bag.find(i => i.item === fallback);
      if (!starter && nextUid > UID_MAX) continue; // no uid left: kitFor wears the starter piece anyway
      if (!starter) { starter = { uid: nextUid++, item: fallback, dye: [0, 0] }; bag.push(starter); }
      g[s] = starter.uid;
    }
    gear[job] = g;
  }

  // caps: unworn overflow moves to the Vault (latest first), then is dropped
  const inv0 = { gear } as InventorySave;
  const worn = wornUids(inv0);
  let unworn = bag.filter(i => !worn.has(i.uid)).length;
  for (let k = bag.length - 1; k >= 0 && unworn > BAG_SLOTS; k--) {
    if (worn.has(bag[k]!.uid)) continue;
    const [moved] = bag.splice(k, 1);
    unworn--;
    if (bank.length < BANK_SLOTS) bank.push(moved!);
  }
  if (bank.length > BANK_SLOTS) bank = bank.slice(0, BANK_SLOTS);

  const wardrobe: CostumeId[] = [];
  if (Array.isArray(v.wardrobe)) for (const c of v.wardrobe) if (isCostumeId(c) && !wardrobe.includes(c)) wardrobe.push(c);
  const costumeDyes: InventorySave['costumeDyes'] = {};
  if (plain(v.costumeDyes)) for (const c of COSTUME_IDS) {
    const d = v.costumeDyes[c];
    if (wardrobe.includes(c) && Array.isArray(d) && d.length === 2 && isDyeId(d[0]) && isDyeId(d[1])) costumeDyes[c] = [d[0], d[1]];
  }
  const ld = plain(v.lootDays) ? v.lootDays : {};
  const day = (x: unknown) => (typeof x === 'string' && DAY.test(x) ? x : null);
  const strs = (l: unknown, ok: (s: unknown) => boolean, max: number) => (Array.isArray(l) ? l.filter((s): s is string => ok(s)).slice(-max) : []);
  const freeRespecUsed: JobId[] = [];
  if (Array.isArray(v.freeRespecUsed)) for (const j of v.freeRespecUsed) if (isJobId(j) && !freeRespecUsed.includes(j)) freeRespecUsed.push(j);

  const inv: InventorySave = {
    v: 1, nextUid, bag, bank, gear, wardrobe, costumeDyes,
    lootDays: { wickhound: day(ld.wickhound), fallen_warden: day(ld.fallen_warden) },
    recentKills: strs(v.recentKills, s => typeof s === 'string' && s.length >= 1 && s.length <= KEY_MAX, RECENT_KILLS),
    recentOps: strs(v.recentOps, isOpKey, RECENT_OPS),
    freeRespecUsed,
  };
  return { inv, repaired: canonical(inv) !== canonical(v) };
}

// ───────── applying an operation ─────────
function cloneInv(i: InventorySave): InventorySave {
  const inst = (x: ItemInst): ItemInst => ({ uid: x.uid, item: x.item, dye: [x.dye[0], x.dye[1]] });
  const gear: InventorySave['gear'] = {};
  for (const job of JOB_IDS) if (i.gear[job]) gear[job] = { ...i.gear[job] };
  const costumeDyes: InventorySave['costumeDyes'] = {};
  for (const c of COSTUME_IDS) { const d = i.costumeDyes[c]; if (d) costumeDyes[c] = [d[0], d[1]]; }
  return {
    v: 1, nextUid: i.nextUid, bag: i.bag.map(inst), bank: i.bank.map(inst), gear, wardrobe: [...i.wardrobe], costumeDyes,
    lootDays: { ...i.lootDays }, recentKills: [...i.recentKills], recentOps: [...(i.recentOps ?? [])], freeRespecUsed: [...i.freeRespecUsed],
  };
}
function cloneJobs(j: JobsSave): JobsSave {
  const jobs: JobsSave['jobs'] = {};
  for (const k of Object.keys(j.jobs) as (keyof JobsSave['jobs'])[]) {
    const r = j.jobs[k];
    if (r) jobs[k] = { ...r, picks: [r.picks[0], r.picks[1]], talents: [...r.talents], outfit: r.outfit ? { ...r.outfit } : null };
  }
  return { ...j, jobs };
}

const clampGold = (g: number) => Math.min(GOLD_MAX, Math.max(0, g));
const LETTERS = ['a', 'b', 'c'] as const;
const STALL_OF: Partial<Record<InvOpName, StallId>> = { bank: 'vault', unbank: 'vault', sell: 'smithy', buyCostume: 'tailor', dye: 'tailor', dyeCostume: 'tailor' };

/** The current job's outfit with `f` applied; all-empty becomes null. */
function withOutfit(o: JobOutfit | null, f: (o: JobOutfit) => void): JobOutfit | null {
  const n: JobOutfit = o ? { ...o } : { body: null, head: null, back: null, hideHead: false };
  f(n);
  return n.body === null && n.head === null && n.back === null && !n.hideHead ? null : n;
}

/**
 * Applies one operation: validate, then apply to a copy. Every operation needs the adventurer alive
 * ('dead'), out of combat ('combat') and not casting, charging or travelling ('busy'), then the right place
 * ('where': the op's stall, a town or sanctuary for talents, the Guild Board for a respec), then its own
 * rules (see the Numbers). Never changes `s`; a refusal changes nothing. An op whose `id` was already
 * applied is { state: s, dGold: 0, dSeals: 0, dup: true }. Never throws.
 */
export function applyInvOp(s: InvState, op: InvOp, ctx: InvCtx): InvResult {
  const p = parseInvOp(op);
  if (!p) return { refusal: 'unknown' };
  const key = p.id !== undefined ? `${p.op}:${p.id}` : undefined;
  if (key !== undefined && (s.inv.recentOps ?? []).includes(key)) return { state: s, dGold: 0, dSeals: 0, dup: true };
  if (key === undefined && OPS_NEEDING_ID.includes(p.op)) return { refusal: 'no-id' };
  if (ctx.dead) return { refusal: 'dead' };
  if (ctx.inCombat) return { refusal: 'combat' };
  if (ctx.busy) return { refusal: 'busy' };
  const needStall = p.op === 'buy' ? p.stall : STALL_OF[p.op];
  if (needStall && ctx.stall !== needStall) return { refusal: 'where' };
  if (p.op === 'talent' && !ctx.jobSwitch) return { refusal: 'where' };
  if (p.op === 'respec' && !ctx.townBoard) return { refusal: 'where' };

  const inv = cloneInv(s.inv);
  const jobs = cloneJobs(s.jobs);
  let gold = s.gold, seals = s.seals;
  const job = jobs.current;
  const r = applyRules(p, inv, jobs, job, () => gold, () => seals, d => { gold = clampGold(gold + d); }, d => { seals += d; });
  if (r) return { refusal: r };
  if (bagUsed(inv) > BAG_SLOTS) return { refusal: 'bag-full' };
  if (key !== undefined) { inv.recentOps.push(key); if (inv.recentOps.length > RECENT_OPS) inv.recentOps.splice(0, inv.recentOps.length - RECENT_OPS); }
  return { state: { inv, gold, seals, jobs }, dGold: gold - s.gold, dSeals: seals - s.seals };
}

/** The op's own rules, applied to the copies; a refusal, or null when applied. */
function applyRules(
  p: InvOp, inv: InventorySave, jobs: JobsSave, job: JobId,
  gold: () => number, seals: () => number, addGold: (d: number) => void, addSeals: (d: number) => void,
): InvRefusal | null {
  const bagAt = (uid: number) => inv.bag.findIndex(i => i.uid === uid);
  const record = () => (jobs.jobs[job] ??= recordFor(jobs, job));
  switch (p.op) {
    case 'equip': {
      const k = bagAt(p.uid);
      if (k < 0) return 'unknown';
      if (!fits(inv.bag[k]!.item, p.slot, job)) return 'fit';
      (inv.gear[job] ??= {})[p.slot] = p.uid;
      return null;
    }
    case 'unequip': {
      if (!isArmourSlot(p.slot)) return 'fit';
      const id = starterFor(job, p.slot)!;
      let starter = inv.bag.find(i => i.item === id);
      if (!starter && !canMint(inv)) return 'uids';
      if (!starter) { starter = { uid: inv.nextUid++, item: id, dye: [0, 0] }; inv.bag.push(starter); }
      (inv.gear[job] ??= {})[p.slot] = starter.uid;
      return null;
    }
    case 'bank': {
      const k = bagAt(p.uid);
      if (k < 0) return 'unknown';
      if (wornBy(inv, p.uid).length) return 'worn';
      if (ITEMS[inv.bag[k]!.item]!.tier === 0) return 'starter'; // a banked starter piece would be minted again on unequip
      if (inv.bank.length >= BANK_SLOTS) return 'bank-full';
      inv.bank.push(inv.bag.splice(k, 1)[0]!);
      return null;
    }
    case 'unbank': {
      const k = inv.bank.findIndex(i => i.uid === p.uid);
      if (k < 0) return 'unknown';
      inv.bag.push(inv.bank.splice(k, 1)[0]!); // the bag cap is checked after every op
      return null;
    }
    case 'sell': {
      const k = bagAt(p.uid);
      if (k < 0) return 'unknown';
      if (wornBy(inv, p.uid).length) return 'worn';
      const it = ITEMS[inv.bag[k]!.item]!;
      if (it.sell <= 0) return 'starter';
      if (gold() + it.sell > GOLD_MAX) return 'purse-full'; // never sell for gold that would be dropped
      inv.bag.splice(k, 1);
      addGold(it.sell);
      return null;
    }
    case 'buy': {
      if (!isItemId(p.item)) return 'unknown';
      if (!canMint(inv)) return 'uids';
      const it = ITEMS[p.item]!;
      if (p.stall === 'smithy' && it.tier === 1 && it.price !== undefined) {
        if (gold() < it.price) return 'gold';
        addGold(-it.price);
      } else if (p.stall === 'lampwright' && it.tier === 3 && it.seals !== undefined) {
        if (seals() < it.seals) return 'seals';
        addSeals(-it.seals);
      } else return 'unknown';
      inv.bag.push({ uid: inv.nextUid++, item: it.id, dye: [0, 0] });
      return null;
    }
    case 'buyCostume': {
      if (!isCostumeId(p.costume) || COSTUMES[p.costume].price === null) return 'unknown';
      if (inv.wardrobe.includes(p.costume)) return 'owned';
      const price = COSTUMES[p.costume].price!;
      if (gold() < price) return 'gold';
      addGold(-price);
      inv.wardrobe.push(p.costume);
      return null;
    }
    case 'wear': {
      const c = p.costume;
      if (c !== null) {
        if (!isCostumeId(c) || !inv.wardrobe.includes(c)) return 'unknown';
        if (COSTUMES[c].slot !== p.slot) return 'fit';
      }
      const r = record();
      r.outfit = withOutfit(r.outfit, o => { o[p.slot] = c; });
      return null;
    }
    case 'hideHead': {
      const r = record();
      r.outfit = withOutfit(r.outfit, o => { o.hideHead = p.hide; });
      return null;
    }
    case 'dye': {
      const inst = inv.bag.find(i => i.uid === p.uid);
      if (!inst) return 'unknown';
      if (!isArmourSlot(ITEMS[inst.item]!.slot)) return 'fit';
      if (inst.dye[p.ch] === p.dye) return null;
      if (gold() < DYE_PRICE) return 'gold';
      addGold(-DYE_PRICE);
      inst.dye[p.ch] = p.dye;
      return null;
    }
    case 'dyeCostume': {
      if (!isCostumeId(p.costume) || !inv.wardrobe.includes(p.costume)) return 'unknown';
      const d = inv.costumeDyes[p.costume] ?? [0, 0];
      if (d[p.ch] === p.dye) return null;
      if (gold() < DYE_PRICE) return 'gold';
      addGold(-DYE_PRICE);
      const n: [DyeId, DyeId] = [d[0], d[1]];
      n[p.ch] = p.dye;
      inv.costumeDyes[p.costume] = n;
      return null;
    }
    case 'talent': {
      const r = record();
      const level = levelForXp(r.xp);
      if (level < TALENT_LEVELS[p.row]) return 'level';
      const id = `${job}_${p.row + 1}${LETTERS[p.choice]}`;
      if (r.talents.some(t => t.endsWith(`_${p.row + 1}a`) || t.endsWith(`_${p.row + 1}b`) || t.endsWith(`_${p.row + 1}c`))) return 'taken';
      r.talents = validTalents(job, level, [...r.talents, id]);
      return null;
    }
    case 'respec': {
      const r = record();
      const n = r.talents.length;
      if (n === 0) return null;
      const free = !inv.freeRespecUsed.includes(job);
      const cost = free ? 0 : RESPEC_PRICE * n;
      if (gold() < cost) return 'gold';
      addGold(-cost);
      if (free) inv.freeRespecUsed.push(job);
      r.talents = [];
      return null;
    }
  }
}

/**
 * A loot award (rollLoot's result) for one kill or clear, at most once per `killKey` (a key already in
 * recentKills gives the same state and dup: true). Gold is added (clamped at GOLD_MAX); the item, undyed,
 * goes into the bag, or is sold at once for its sell value when the bag is full (soldFor; the server
 * sends "Your bag is full: <item> was sold for <n> gold"). daily: record the day of a daily guaranteed
 * drop (rollLoot's daily). Allowed in combat. Never changes `s`.
 */
export function addLoot(
  s: InvState, item: ItemId | null, gold: number, killKey: string, daily: { key: 'wickhound' | 'fallen_warden'; day: string } | null = null,
): { state: InvState; dGold: number; soldFor: number | null; dup: boolean; uid: number | null } {
  if (s.inv.recentKills.includes(killKey)) return { state: s, dGold: 0, soldFor: null, dup: true, uid: null };
  const inv = cloneInv(s.inv);
  inv.recentKills.push(killKey);
  if (inv.recentKills.length > RECENT_KILLS) inv.recentKills.splice(0, inv.recentKills.length - RECENT_KILLS);
  if (daily && DAY.test(daily.day)) inv.lootDays[daily.key] = daily.day;
  let g = clampGold(s.gold + (Number.isFinite(gold) && gold > 0 ? Math.floor(gold) : 0));
  let soldFor: number | null = null, uid: number | null = null;
  if (item !== null && isItemId(item)) {
    // no bag slot, or no uid left to mint: sold at once (never lost)
    if (bagUsed(inv) < BAG_SLOTS && canMint(inv)) { uid = inv.nextUid++; inv.bag.push({ uid, item, dye: [0, 0] }); }
    else { soldFor = ITEMS[item]!.sell; g = clampGold(g + soldFor); }
  }
  return { state: { ...s, inv, gold: g }, dGold: g - s.gold, soldFor, dup: false, uid };
}

// ───────── views ─────────
export interface InventoryView {
  bag: (ItemInst & { worn: JobId[] })[]; bank: ItemInst[]; gear: InventorySave['gear']; wardrobe: CostumeId[];
  costumeDyes: InventorySave['costumeDyes']; gold: number; seals: number; stats: Required<Stats>; sets: { set: SetId; pieces: number }[]; freeRespec: boolean;
}

/** What the client's sheets show (the server sends it on join and after every change): copies only. */
export function inventoryView(s: InvState): InventoryView {
  const inv = cloneInv(s.inv), job = s.jobs.current, r = recordFor(s.jobs, job);
  const gear = gearItems(inv, job);
  const counts = setCounts(gear);
  return {
    bag: inv.bag.map(i => ({ ...i, worn: wornBy(inv, i.uid) })), bank: inv.bank, gear: inv.gear, wardrobe: inv.wardrobe, costumeDyes: inv.costumeDyes,
    gold: s.gold, seals: s.seals,
    stats: kitFor({ job, level: levelForXp(r.xp), gear, talents: r.talents }).stats as Required<Stats>,
    sets: SET_IDS.filter(id => id !== 'plain' && (counts[id] ?? 0) > 0).map(set => ({ set, pieces: counts[set]! })),
    freeRespec: !inv.freeRespecUsed.includes(job),
  };
}

/**
 * What `job` shows (look.ts's GearLook): each worn item's model and dyes, then the outfit's owned costumes
 * through resolveGearLook's rules (a costume not in the wardrobe, or in the wrong slot, is ignored). Never
 * throws: a broken inventory shows what it can.
 */
export function gearLookOf(inv: InventorySave, job: JobId, outfit: JobOutfit | null): GearLook {
  const worn: Partial<Record<GearSlot, GearLookSlot>> = {};
  const bag = Array.isArray(inv?.bag) ? inv.bag : [];
  const g = (plain(inv?.gear) && own(JOBS, job) && plain(inv.gear[job])) ? inv.gear[job]! : {};
  for (const s of GEAR_SLOTS) {
    const inst = bag.find(i => i?.uid === g[s]);
    if (inst && isItemId(inst.item) && fits(inst.item, s, job)) worn[s] = { model: ITEMS[inst.item]!.model, dye: cleanDyes(inst.dye) };
  }
  const wardrobe = Array.isArray(inv?.wardrobe) ? inv.wardrobe : [];
  const dyes = plain(inv?.costumeDyes) ? inv.costumeDyes : {};
  const costume = (slot: CostumeSlot): GearLookSlot | null => {
    const c = outfit?.[slot];
    if (!isCostumeId(c) || !wardrobe.includes(c) || COSTUMES[c].slot !== slot) return null;
    return { model: COSTUMES[c].model, dye: cleanDyes(dyes[c]) };
  };
  return resolveGearLook(worn, { body: costume('body'), head: costume('head'), back: costume('back') }, outfit?.hideHead === true);
}
