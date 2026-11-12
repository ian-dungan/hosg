import { describe, expect, it } from 'vitest';
import {
  NPC_IDS, NPC_REACH, PROP_IDS, PROP_REACH, STORY_AGGRO_PAD, STORY_NPCS, STORY_PROPS, STORY_RULE, npcAt, npcInReach, pimGround, propAt, propInReach, searchStorySpot, storySpotOk,
} from './spots';
import { TAVERN, TAVERN_YAW, PLINTH_R } from '../world/layout';
import { GROVE_OBSTACLES } from '../world/obstacles';
import { GUILD_BOARD, LAMPFALL_MOUTH, STALL_IDS, TOWN_STALLS, greenwayLayout, zoneDef, type SaveZoneId } from '../world/zones';
import { ENEMY_KINDS } from '../combat/enemies';
import { findPath, withClearance } from '../path';
import type { Obstacle } from '../world/layout';

const all = () => [...NPC_IDS.map(id => STORY_NPCS[id]), ...PROP_IDS.map(id => STORY_PROPS[id])];
const d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
function edge(o: Obstacle, x: number, z: number): number {
  const dx = x - o.x, dz = z - o.z;
  if (o.kind === 'c') return Math.hypot(dx, dz) - o.r;
  const lx = Math.abs(dx * o.c - dz * o.s) - o.hw, lz = Math.abs(dx * o.s + dz * o.c) - o.hd;
  return lx <= 0 && lz <= 0 ? Math.max(lx, lz) : Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
}

describe('story spots', () => {
  it('pimGround matches the offline town\'s pim anchor to 1e-9', () => {
    // client/src/world/town.ts: fwd = (sin TAVERN_YAW, cos TAVERN_YAW); door = TAVERN + fwd × d/2; pimGround = door + fwd × 2.6
    const fwd = { x: Math.sin(TAVERN_YAW), z: Math.cos(TAVERN_YAW) };
    const doorX = TAVERN.x + fwd.x * (TAVERN.d / 2), doorZ = TAVERN.z + fwd.z * (TAVERN.d / 2);
    const p = pimGround();
    expect(Math.abs(p.x - (doorX + fwd.x * 2.6))).toBeLessThan(1e-9);
    expect(Math.abs(p.z - (doorZ + fwd.z * 2.6))).toBeLessThan(1e-9);
  });

  it('every NPC and prop passes the placement rule and is reachable from its zone\'s spawn by findPath', () => {
    expect(Object.isFrozen(STORY_NPCS) && Object.isFrozen(STORY_NPCS.marrow) && Object.isFrozen(STORY_NPCS.bram.giver) && Object.isFrozen(STORY_PROPS.plaque)).toBe(true);
    const gw = greenwayLayout();
    for (const s of all()) {
      const def = zoneDef(s.zone);
      const others = all().filter(o => o !== s && o.zone === s.zone);
      expect(storySpotOk(s.zone, s.x, s.z, others), s.id).toBe(true);
      // the rule spelled out
      expect(def.ground(s.x, s.z), s.id).not.toBeNull();
      const obs = s.zone === 'grove' ? GROVE_OBSTACLES : gw.obstacles;
      for (const o of obs) expect(edge(o, s.x, s.z), s.id).toBeGreaterThanOrEqual(STORY_RULE.npcClear);
      for (const o of others) expect(d(s, o), `${s.id}–${o.id}`).toBeGreaterThanOrEqual(STORY_RULE.storyGap);
      for (const e of def.exits) expect(d(s, e), s.id).toBeGreaterThanOrEqual(e.r + STORY_RULE.exitPad);
      if (s.zone === 'grove') {
        expect(d(s, GUILD_BOARD)).toBeGreaterThanOrEqual(STORY_RULE.storyGap);
        for (const id of STALL_IDS) expect(d(s, TOWN_STALLS[id])).toBeGreaterThanOrEqual(STORY_RULE.storyGap);
        expect(Math.hypot(s.x, s.z)).toBeGreaterThanOrEqual(PLINTH_R + STORY_RULE.plinthPad);
      } else {
        expect(d(s, LAMPFALL_MOUTH)).toBeGreaterThanOrEqual(LAMPFALL_MOUTH.r + STORY_RULE.exitPad);
        for (const c of gw.camps) {
          expect(d(s, c), s.id).toBeGreaterThanOrEqual(STORY_RULE.campGap);
          // outside every spawn's aggro: reading a stone never pulls a fight
          for (const sp of c.spawns) expect(d(s, sp), `${s.id} near ${sp.kind}`).toBeGreaterThanOrEqual(ENEMY_KINDS[sp.kind].aggro + STORY_AGGRO_PAD);
        }
      }
      // reachable on foot from the spawn, with an adventurer's clearance, to within reach of the spot
      const passable = withClearance((x, z) => def.ground(x, z) !== null, 0.3);
      const path = findPath(def.spawn, s, passable, { maxNodes: 400_000 });
      expect(path, s.id).not.toBeNull();
      const reach = 'facing' in s ? NPC_REACH : PROP_REACH;
      expect(d(path!.at(-1)!, s), s.id).toBeLessThan(reach - 0.5);
    }
  });

  it('the chosen spots are stable', () => {
    const r = (v: number) => Math.round(v * 100) / 100;
    expect(Object.fromEntries(all().map(s => [s.id, { zone: s.zone, x: r(s.x), z: r(s.z), ...('facing' in s ? { facing: r(s.facing) } : {}) }]))).toMatchSnapshot();
    expect(STORY_NPCS.nell.name).toBe('Nell Thistlewood, the road-keeper');
    expect(STORY_PROPS.crater_edge.name).toBe("The crater's edge");
  });

  it('the search: a passing spot stays put; a failing one moves to the first ring spot that passes; none → null', () => {
    const m = STORY_NPCS.marrow;
    expect(searchStorySpot('grove', m.x, m.z, [])).toEqual({ x: m.x, z: m.z });
    // inside the statue's plinth: moved outward, onto a passing spot no further than maxR
    const s = searchStorySpot('grove', 0, -4.6, [])!;
    expect(s).not.toBeNull();
    expect(Math.hypot(s.x, s.z - -4.6)).toBeLessThanOrEqual(STORY_RULE.maxR + 1e-9);
    expect(storySpotOk('grove', s.x, s.z, [])).toBe(true);
    // far out of the world: nothing within 6 m
    expect(searchStorySpot('greenway' as SaveZoneId, -500, -500, [])).toBeNull();
    expect(storySpotOk('grove', NaN, 0, [])).toBe(false);
  });

  it('npcAt and propAt: in reach, out of reach, the wrong zone, the nearest of two', () => {
    const m = STORY_NPCS.marrow, p = STORY_PROPS.plaque;
    expect(npcAt('grove', m.x, m.z)).toBe('marrow');
    expect(npcAt('grove', m.x + NPC_REACH - 0.01, m.z)).toBe('marrow');
    expect(npcAt('grove', m.x + NPC_REACH + 0.3, m.z)).toBeNull();
    expect(npcAt('grove', m.x + NPC_REACH + 0.3, m.z, 0.5)).toBe('marrow');
    expect(npcAt('greenway', m.x, m.z)).toBeNull();
    expect(npcAt('lampfall', m.x, m.z)).toBeNull();
    expect(npcAt('grove', NaN, m.z)).toBeNull();
    expect(propAt('grove', p.x, p.z)).toBe('plaque');
    expect(propAt('grove', p.x, p.z + PROP_REACH + 0.1)).toBeNull();
    expect(propAt('greenway', p.x, p.z)).toBeNull();
    // Pim and Bram stand close: each wins on its own side
    const pim = STORY_NPCS.pim, bram = STORY_NPCS.bram;
    expect(d(pim, bram)).toBeLessThan(2 * NPC_REACH);
    expect(npcAt('grove', pim.x * 0.8 + bram.x * 0.2, pim.z * 0.8 + bram.z * 0.2)).toBe('pim');
    expect(npcAt('grove', pim.x * 0.2 + bram.x * 0.8, pim.z * 0.2 + bram.z * 0.8)).toBe('bram');
    // in-reach checks for a named spot
    expect(npcInReach('pim', 'grove', bram.x, bram.z)).toBe(d(pim, bram) <= NPC_REACH);
    expect(propInReach('waymark_1', 'greenway', STORY_PROPS.waymark_1.x, STORY_PROPS.waymark_1.z)).toBe(true);
    expect(propInReach('waymark_1', 'grove', STORY_PROPS.waymark_1.x, STORY_PROPS.waymark_1.z)).toBe(false);
  });
});
