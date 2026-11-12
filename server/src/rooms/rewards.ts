// Kill and clear rewards: xp on the real curve with catch-up, and personal loot. Pure: the room decides who is
// credited (the engine's minimum-contribution credit, plus Plan 4's party share) and runs the loot through the
// adventurer's inventory queue, where it is rolled from the queued state (its lootDays and what it owns) with
// loot's own seeded generator, so a re-run after a stale write rolls exactly the same thing again.
import {
  CLEAR_XP, ITEMS, KILL_XP, TALENT_LEVELS, addLoot, catchUp, lootRng, lootTable, ownedItems, pickLootItem, rollLoot,
  type EnemyKindId, type InvState, type ItemId, type JobId, type JobsSave, type LootSource,
} from '@sg2/shared';

/** One loot roll waiting in an adventurer's queue: a kill's or a pack clear's. */
export interface LootAward {
  src: LootSource;
  /** [serverSeed, roomId, enemyEid, killCounter, accountId] (a clear: the encounter in place of the enemy). */
  seedParts: readonly (string | number)[];
  /** `roomId:enemyEid:killCounter` (a clear: `roomId:clear:<encounter>`): at most one reward per adventurer. */
  killKey: string;
  /** The job the roll is for (the current job at the kill). */
  job: JobId;
  /** The UTC day of the kill (YYYY-MM-DD). */
  day: string;
  /** Where the enemy fell (the `loot` message's x, z). */
  x: number;
  z: number;
}

/** What one award gave (the `loot` message and its notices); dup: the kill was already rewarded. */
export interface LootGiven {
  award: LootAward;
  items: { item: ItemId; uid: number }[];
  gold: number;
  soldFor: number;
  /** Items sold at once because the bag was full (each gets a notice). */
  sold: { item: ItemId; gold: number }[];
  /** Gold that could not be kept at GOLD_MAX. */
  lost: number;
  dup: boolean;
}

/** Xp for `job` from a kill of `kind`: KILL_XP × CATCH_UP_MULT (catchUp) when the job is below the adventurer's highest level, floored. */
export function killXp(jobs: JobsSave, job: JobId, kind: EnemyKindId): number {
  return Math.floor((KILL_XP[kind] ?? 0) * catchUp(jobs, job));
}

/** Xp for `job` from a pack clear: CLEAR_XP with the same catch-up. */
export function clearXp(jobs: JobsSave, job: JobId): number {
  return Math.floor(CLEAR_XP * catchUp(jobs, job));
}

/** The talent row a new level unlocks (0–2), or null. */
export function talentRowFor(level: number): 0 | 1 | 2 | null {
  const i = (TALENT_LEVELS as readonly number[]).indexOf(level);
  return i === 0 || i === 1 || i === 2 ? i : null;
}

/**
 * Applies awards in order to `s`: each is rolled from the state as it stands (its lootDays and owned items),
 * then added with addLoot (a kill key already rewarded gives nothing). `always` (SG2_TEST_LOOT=always): a roll
 * that gives no item on a row that has one drops one anyway (still picked by the roll's own generator).
 */
export function applyLoot(s: InvState, awards: readonly LootAward[], always = false): { state: InvState; dGold: number; given: LootGiven[] } {
  let state = s;
  const given: LootGiven[] = [];
  for (const award of awards) {
    const owned = ownedItems(state.inv);
    const r = rollLoot(award.src, { job: award.job, owned, day: award.day, lootDays: state.inv.lootDays }, award.seedParts);
    let item = r.item;
    const tier = lootTable(award.src).tier;
    if (always && item === null && tier !== null) item = pickLootItem(tier, award.job, owned, lootRng([...award.seedParts, 'always']));
    const daily = r.daily ? lootTable(award.src).daily ?? null : null;
    const before = state.gold;
    const out = addLoot(state, item, r.gold, award.killKey, daily ? { key: daily, day: award.day } : null);
    const g: LootGiven = { award, items: [], gold: 0, soldFor: 0, sold: [], lost: 0, dup: out.dup };
    if (!out.dup) {
      if (out.uid !== null && item !== null) g.items.push({ item, uid: out.uid });
      if (out.soldFor !== null && item !== null) {
        g.soldFor = out.soldFor;
        g.sold.push({ item, gold: out.soldFor });
      }
      g.gold = r.gold;
      g.lost = Math.max(0, before + r.gold + g.soldFor - out.state.gold);
      state = out.state;
    }
    given.push(g);
  }
  return { state, dGold: state.gold - s.gold, given };
}

/** An item's display name (for notices). */
export const itemName = (id: ItemId): string => ITEMS[id]?.name ?? id;
