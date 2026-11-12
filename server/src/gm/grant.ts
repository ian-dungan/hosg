// A GM grant applied to an inventory (server only): the same bag limit, purse cap and validation as every other
// inventory change, and at most once per grant key (a retried grant changes nothing). Pure: the caller writes the
// result with the store's compare-and-set (writeInventory), online through the session's queue, offline in a loop.
import {
  BAG_SLOTS, COSTUMES, GOLD_MAX, ITEMS, RECENT_KILLS, bagUsed, isCostumeId, isItemId, parseInventory,
  type CostumeId, type InventorySave, type ItemId,
} from '@sg2/shared';

/** One grant: gold, an item or a costume (exactly one of them), and its key (`gm:` + random; kept in recentKills). */
export interface GmGrant { gold?: number; item?: ItemId; costume?: CostumeId; key?: string }

/** Why a grant did not land: an unknown adventurer, a costume already owned, a full bag, a purse that would pass GOLD_MAX, a bad grant. */
export type GrantRefusal = 'unknown' | 'owned' | 'bag-full' | 'purse-full' | 'invalid';
export type GrantOutcome = 'done' | GrantRefusal | 'failed';

/** The most gold one grant gives (GmCommand's 1..10 000). */
export const GM_GOLD_GRANT_MAX = 10_000;
const KEY_RE = /^gm:[A-Za-z0-9_-]{8,64}$/;

/** What the grant gives, as the target's notice says it ("A game master gave you <thing>"). */
export function grantThing(g: GmGrant): string {
  if (g.gold !== undefined) return `${g.gold} gold`;
  if (g.item !== undefined) return ITEMS[g.item]?.name ?? g.item;
  if (g.costume !== undefined) return COSTUMES[g.costume]?.name ?? g.costume;
  return 'nothing';
}

/** Whether `g` is one well-formed grant (exactly one of gold 1..GM_GOLD_GRANT_MAX, a known item, a known costume; a key if any). */
export function isGrant(g: GmGrant): boolean {
  const parts = [g.gold, g.item, g.costume].filter((v) => v !== undefined).length;
  if (parts !== 1) return false;
  if (g.key !== undefined && !(typeof g.key === 'string' && KEY_RE.test(g.key))) return false;
  if (g.gold !== undefined) return Number.isSafeInteger(g.gold) && g.gold >= 1 && g.gold <= GM_GOLD_GRANT_MAX;
  if (g.item !== undefined) return isItemId(g.item);
  return isCostumeId(g.costume);
}

/**
 * The inventory and the gold delta after the grant, `dup` when its key was applied already (nothing changes), or a
 * refusal. Never changes `inv`; never throws.
 */
export function applyGrant(inv: InventorySave, gold: number, g: GmGrant): { inv: InventorySave; dGold: number; dup?: true } | { refusal: GrantRefusal } {
  if (!isGrant(g)) return { refusal: 'invalid' };
  if (g.key !== undefined && inv.recentKills.includes(g.key)) return { inv, dGold: 0, dup: true };
  const next: InventorySave = JSON.parse(JSON.stringify(inv)) as InventorySave;
  let dGold = 0;
  if (g.gold !== undefined) {
    if (gold + g.gold > GOLD_MAX) return { refusal: 'purse-full' }; // never silently clamped away
    dGold = g.gold;
  } else if (g.item !== undefined) {
    if (bagUsed(next) >= BAG_SLOTS) return { refusal: 'bag-full' };
    next.bag.push({ uid: next.nextUid, item: g.item, dye: [0, 0] });
    next.nextUid += 1;
  } else if (g.costume !== undefined) {
    if (next.wardrobe.includes(g.costume)) return { refusal: 'owned' };
    next.wardrobe.push(g.costume);
  }
  if (g.key !== undefined) {
    next.recentKills.push(g.key);
    if (next.recentKills.length > RECENT_KILLS) next.recentKills.splice(0, next.recentKills.length - RECENT_KILLS);
  }
  // the same validation every write gets (writeInventory refuses an inventory parseInventory would repair)
  if (parseInventory(next).repaired) return { refusal: 'invalid' };
  return { inv: next, dGold };
}

/** What a grant writes through (the store's own reads and compare-and-set writes). */
export interface GrantStore {
  getOrCreateAdventurer(accountId: string): Promise<{ id: string; inventory: InventorySave; gold: number; invVersion: number }>;
  writeInventory(adventurerId: string, expect: number, w: { inventory: InventorySave; dGold: number; dSeals: number }): Promise<unknown>;
}
/** Compare-and-set tries for a grant without a session (grantOffline). */
export const GRANT_CAS_TRIES = 5;

/**
 * A grant to the account's adventurer straight through the store (no session holds it): read, apply, write with
 * compare-and-set, at most GRANT_CAS_TRIES times ('failed' when every try was stale). Jobs are never written.
 */
export async function grantByCas(store: GrantStore, accountId: string, g: GmGrant): Promise<GrantOutcome> {
  if (!isGrant(g)) return 'invalid';
  for (let i = 0; i < GRANT_CAS_TRIES; i++) {
    const a = await store.getOrCreateAdventurer(accountId);
    const r = applyGrant(a.inventory, a.gold, g);
    if ('refusal' in r) return r.refusal;
    if (r.dup) return 'done';
    if (await store.writeInventory(a.id, a.invVersion, { inventory: r.inv, dGold: r.dGold, dSeals: 0 })) return 'done';
  }
  return 'failed';
}
