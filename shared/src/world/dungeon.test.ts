import { describe, expect, it } from 'vitest';
import { SAFE_FALL, STEP_UP } from '../constants';
import { ENEMY_ATTACKS, ENEMY_KINDS } from '../combat/enemies';
import { BOSSES } from '../combat/bosses';
import { ENCOUNTERS } from '../combat/encounters';
import { SEAL_GATE_R } from '../instance';
import { findPath, withClearance } from '../path';
import { ZONE_XZ_MAX_M, ZONE_Y_MAX_M, ZONE_Y_MIN_M } from './limits';
import { LAMPFALL_RECIPE, generateDungeon, lampfallLayout, yawOf, type DungeonLayout, type DungeonRoom, type RoomId } from './dungeon';

const L = lampfallLayout();
const W = L.walk;
/** An adventurer's radius (the clearance tap-to-walk and the AI use for one). */
const ADV_R = 0.4;
/** The highest a jump lifts the feet (JUMP_SPEED² / 2·GRAVITY ≈ 1.45 m). */
const JUMP_REACH = 1.45;
const room = (id: RoomId): DungeonRoom => L.rooms.find(r => r.id === id)!;
const d2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
const dist = (ax: number, az: number, bx: number, bz: number) => Math.sqrt(d2(ax, az, bx, bz));

/** FNV-1a (32-bit) over a string. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
/** Every number of the layout at full precision (JSON keeps a double exactly), plus the floor sampled every 1 m. */
function exact(l: DungeonLayout): string {
  const { walk: _w, recipe: _r, ...data } = l;
  const parts = [JSON.stringify(data)];
  for (const r of l.rooms) for (let dx = -r.r; dx <= r.r; dx += 1) parts.push(String(l.walk.surfaceAt(r.x + dx, r.z + 0.5)));
  for (const c of l.corridors) for (let t = 0; t <= 1; t += 1 / 16) parts.push(String(l.walk.surfaceAt(c.ax + (c.bx - c.ax) * t, c.az + (c.bz - c.az) * t)));
  return parts.join(';');
}

/** The grid used by the floods below: a cell every STEP m over the layout's bounds. */
const STEP = 0.5;
interface Grid { i0: number; j0: number; ni: number; nj: number; h: (number | null)[] }
function grid(l: DungeonLayout, ok: (x: number, z: number) => boolean = () => true): Grid {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of l.rooms) { x0 = Math.min(x0, r.x - r.r); x1 = Math.max(x1, r.x + r.r); z0 = Math.min(z0, r.z - r.r); z1 = Math.max(z1, r.z + r.r); }
  const i0 = Math.floor(x0 / STEP) - 2, j0 = Math.floor(z0 / STEP) - 2;
  const ni = Math.ceil(x1 / STEP) + 2 - i0 + 1, nj = Math.ceil(z1 / STEP) + 2 - j0 + 1;
  const stand = withClearance((x, z) => l.walk.surfaceAt(x, z) !== null, ADV_R);
  const h: (number | null)[] = [];
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const x = (i0 + i) * STEP, z = (j0 + j) * STEP;
    h.push(stand(x, z) && ok(x, z) ? l.walk.surfaceAt(x, z) : null);
  }
  return { i0, j0, ni, nj, h };
}
const cellOf = (g: Grid, x: number, z: number) => (Math.round(z / STEP) - g.j0) * g.ni + (Math.round(x / STEP) - g.i0);
/** Cells reachable from (x, z) on foot: up at most `up` m between neighbours, down at most SAFE_FALL. */
function flood(g: Grid, x: number, z: number, up: number): Uint8Array {
  const seen = new Uint8Array(g.h.length), start = cellOf(g, x, z);
  if (g.h[start] === null) throw new Error(`flood from (${x}, ${z}): not standable`);
  const q = [start]; seen[start] = 1;
  for (let k = 0; k < q.length; k++) {
    const c = q[k], ci = c % g.ni, cj = (c - ci) / g.ni, hc = g.h[c]!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= g.ni || j >= g.nj) continue;
      const n = j * g.ni + i, hn = g.h[n];
      if (seen[n] || hn === null || hn - hc > up || hc - hn > SAFE_FALL) continue;
      seen[n] = 1; q.push(n);
    }
  }
  return seen;
}

/** The sealed part of a boss room: its floor, plus its corridors up to the gate circles (not inside them). */
function inArena(r: DungeonRoom, x: number, z: number): boolean {
  const gates = [r.gate, r.exitGate].filter((g): g is NonNullable<typeof g> => g !== null);
  for (const g of gates) if (d2(x, z, g.x, g.z) <= g.r * g.r) return false;
  if (d2(x, z, r.x, r.z) <= r.r * r.r) return true;
  // corridor strips: nearer the room than the gate's centre, along the corridor
  for (const g of gates) {
    const ux = (g.x - r.x) / dist(g.x, g.z, r.x, r.z), uz = (g.z - r.z) / dist(g.x, g.z, r.x, r.z);
    const a = (x - r.x) * ux + (z - r.z) * uz, lat = Math.abs((x - r.x) * -uz + (z - r.z) * ux);
    if (a > 0 && a <= dist(g.x, g.z, r.x, r.z) && lat <= L.recipe.corridor.width / 2 + 1e-9) return true;
  }
  return false;
}

describe('generateDungeon(LAMPFALL_RECIPE)', () => {
  it('generates the same layout twice, and a snapshot of rooms, corridors and spawns', () => {
    const again = generateDungeon(LAMPFALL_RECIPE);
    expect(exact(again)).toBe(exact(L));
    expect(lampfallLayout()).toBe(L); // cached
    // the rooms in the recipe's order, with their specs
    expect(L.rooms.map(r => r.id)).toEqual(['rim', 'root_cellar', 'brass_gallery', 'cog_hall', 'wick_den', 'landing', 'lens_pit']);
    expect(L.rooms.map(r => [r.r, r.floorY])).toEqual([[9, 0], [11, -3], [13, -6], [12, -9], [16, -12], [8, -15], [22, -18]]);
    expect(L.corridors.map(c => `${c.from}>${c.to}`)).toEqual([
      'rim>root_cellar', 'root_cellar>brass_gallery', 'brass_gallery>cog_hall', 'cog_hall>wick_den', 'wick_den>landing', 'landing>lens_pit',
    ]);
    // another seed is another dungeon
    const other = generateDungeon({ ...LAMPFALL_RECIPE, seed: 4405 });
    expect(other.rooms[1].x).not.toBe(L.rooms[1].x);
    // byte-identical on every engine: the exact layout (every double) is pinned
    expect(fnv1a(exact(L))).toMatchSnapshot();
    expect(L.rooms.map(r => ({ id: r.id, x: r.x, z: r.z, entryDir: r.entryDir, spawns: r.spawns }))).toMatchSnapshot();
  });

  it('yawOf is atan2(dx, dz) from exact arithmetic (within 1e-12), and exactly 0, ±π/2, π on the axes', () => {
    expect(yawOf(0, 1)).toBe(0); expect(yawOf(1, 0)).toBe(Math.PI / 2); expect(yawOf(-1, 0)).toBe(-Math.PI / 2); expect(yawOf(0, -1)).toBe(Math.PI);
    expect(yawOf(0, 0)).toBe(0);
    for (let k = 0; k < 2000; k++) {
      const x = Math.sin(k * 1.7) * (1 + k % 7), z = Math.cos(k * 0.9) * (1 + k % 5);
      expect(Math.abs(yawOf(x, z) - Math.atan2(x, z)), `${x}, ${z}`).toBeLessThan(1e-12);
    }
  });

  it('fits the zone limits, x and z and heights', () => {
    expect(L.rooms[0]).toMatchObject({ x: 20, z: 0 });
    for (const r of L.rooms) {
      for (const [x, z] of [[r.x - r.r, r.z - r.r], [r.x + r.r, r.z + r.r]]) {
        expect(Math.abs(x)).toBeLessThanOrEqual(ZONE_XZ_MAX_M); expect(Math.abs(z)).toBeLessThanOrEqual(ZONE_XZ_MAX_M);
      }
      expect(r.floorY).toBeGreaterThanOrEqual(ZONE_Y_MIN_M); expect(r.floorY).toBeLessThanOrEqual(ZONE_Y_MAX_M);
    }
    for (const p of L.rubble) expect(p.top).toBeLessThanOrEqual(ZONE_Y_MAX_M);
    // a recipe too long for the limits is refused, not silently wrapped
    const huge = { ...LAMPFALL_RECIPE, corridor: { ...LAMPFALL_RECIPE.corridor, minLen: 140, maxLen: 150 } };
    expect(() => generateDungeon(huge)).toThrow(/zone limits/);
  });

  it('rooms and corridors keep 6 m apart (except where they join)', () => {
    const rs = L.rooms;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      expect(dist(rs[i].x, rs[i].z, rs[j].x, rs[j].z) - rs[i].r - rs[j].r, `${rs[i].id} ${rs[j].id}`).toBeGreaterThanOrEqual(j === i + 1 ? 12 : 6);
    }
    for (const c of L.corridors) {
      const len = dist(c.ax, c.az, c.bx, c.bz);
      expect(len).toBeGreaterThanOrEqual(12 - 1e-9); expect(len).toBeLessThanOrEqual(18 + 1e-9);
      expect(c.w).toBe(5);
      for (const r of rs) {
        if (r.id === c.from || r.id === c.to) continue;
        for (let t = 0; t <= 1; t += 1 / 64) {
          const x = c.ax + (c.bx - c.ax) * t, z = c.az + (c.bz - c.az) * t;
          expect(dist(x, z, r.x, r.z) - r.r - c.w / 2, `${c.from}>${c.to} near ${r.id}`).toBeGreaterThanOrEqual(6 - 1e-9);
        }
      }
    }
  });

  it('every room is reachable from the rim (findPath, an adventurer\'s clearance), and back', () => {
    const passable = withClearance((x, z) => W.surfaceAt(x, z) !== null, ADV_R);
    const rim = room('rim');
    for (const r of L.rooms) {
      const p = findPath({ x: rim.x, z: rim.z }, { x: r.x, z: r.z }, passable, { maxNodes: 400_000 });
      expect(p, r.id).not.toBeNull();
      const last = p!.at(-1)!;
      expect(dist(last.x, last.z, r.x, r.z), r.id).toBeLessThan(0.01);
    }
  });

  it('on foot, heights included: from the rim every room, checkpoint, sanctuary, spawn and arena cell is reached; and every room climbs back to the rim', () => {
    const g = grid(L);
    const rim = room('rim');
    const down = flood(g, rim.x, rim.z, STEP_UP); // walking only, no jumps
    const targets: [string, number, number][] = [];
    for (const r of L.rooms) {
      targets.push([r.id, r.x, r.z]);
      if (r.sanctuary) targets.push([`${r.id} sanctuary`, r.sanctuary.x, r.sanctuary.z]);
      for (const s of r.spawns) targets.push([`${r.id} ${s.kind}`, s.x, s.z]);
      if (r.gate) targets.push([`${r.id} gate`, r.gate.x, r.gate.z]);
      if (r.exitGate) targets.push([`${r.id} exit gate`, r.exitGate.x, r.exitGate.z]);
    }
    targets.push(['exit stair', L.exitStair.x, L.exitStair.z], ['lamp-lift', L.lampLift.x, L.lampLift.z]);
    for (const [what, x, z] of targets) expect(down[cellOf(g, x, z)], what).toBe(1);
    // every standable cell of both arenas, too
    for (const id of ['wick_den', 'lens_pit'] as const) {
      const r = room(id);
      for (let x = r.x - r.r - 6; x <= r.x + r.r + 6; x += STEP) for (let z = r.z - r.r - 6; z <= r.z + r.r + 6; z += STEP) {
        const c = cellOf(g, x, z);
        if (g.h[c] !== null && inArena(r, x, z)) expect(down[c], `${id} (${x}, ${z})`).toBe(1);
      }
    }
    // the way back needs jumps up the Wick Stair: from every room, the rim is reached with a jump's reach
    for (const r of L.rooms) expect(flood(g, r.x, r.z, JUMP_REACH)[cellOf(g, rim.x, rim.z)], r.id).toBe(1);
    // ...and not without them (the stair's terraces are real steps)
    expect(flood(g, room('landing').x, room('landing').z, STEP_UP)[cellOf(g, rim.x, rim.z)]).toBe(0);
  });

  it('corridors climb by at most STEP_UP between samples; the Wick Stair drops 1.0 m steps; nothing drops more than SAFE_FALL', () => {
    const SAMPLE = 0.4;
    for (const c of L.corridors) {
      const len = dist(c.ax, c.az, c.bx, c.bz), ux = (c.bx - c.ax) / len, uz = (c.bz - c.az) / len;
      const stair = c.from === 'wick_den' && c.to === 'landing';
      expect(c.steps, `${c.from}>${c.to}`).toBe(stair ? 3 : 0);
      expect(c.ay).toBe(room(c.from).floorY); expect(c.by).toBe(room(c.to).floorY);
      for (const lat of [-2.2, 0, 2.2]) {
        let drops = 0;
        const n = Math.ceil((len + 4) / SAMPLE);
        let prev: number | null = null;
        for (let k = 0; k <= n; k++) {
          const s = -2 + (len + 4) * k / n, x = c.ax + ux * s - uz * lat, z = c.az + uz * s + ux * lat;
          const h = W.surfaceAt(x, z);
          expect(h, `${c.from}>${c.to} at ${s}, ${lat}`).not.toBeNull();
          if (prev !== null) {
            const dh = h! - prev;
            if (stair) {
              expect(dh).toBeLessThanOrEqual(1e-9); // only down, toward the landing
              if (dh < -1e-9) { expect(dh).toBeCloseTo(-1, 9); drops++; }
            } else expect(Math.abs(dh)).toBeLessThanOrEqual(STEP_UP);
          }
          prev = h;
        }
        if (stair) expect(drops).toBe(3);
      }
      // a ramp's slope is at most 0.25
      if (!stair) expect(Math.abs(c.by - c.ay) / len).toBeLessThanOrEqual(0.25 + 1e-9);
    }
    // anywhere: two neighbouring samples never differ by more than a platform's height (and never by SAFE_FALL)
    const g = grid(L);
    let worst = 0;
    for (let c = 0; c < g.h.length; c++) {
      const a = g.h[c]; if (a === null) continue;
      for (const n of [c + 1, c + g.ni]) { const b = g.h[n]; if (b !== null && b !== undefined) worst = Math.max(worst, Math.abs(a - b)); }
    }
    expect(worst).toBeLessThanOrEqual(1.1);
    expect(worst).toBeLessThan(SAFE_FALL);
  });

  it('every platform is jumpable; boss rooms are flat and clear of pillars and rubble; no gap narrower than 0.8 m', () => {
    for (const p of L.rubble) {
      const floor = W.groundAt(p.x + p.r + 0.3, p.z) ?? W.groundAt(p.x - p.r - 0.3, p.z)!;
      expect(p.top - floor).toBeGreaterThanOrEqual(0.45 - 1e-9); expect(p.top - floor).toBeLessThanOrEqual(1.05 + 1e-9);
      expect(p.top - floor).toBeLessThan(JUMP_REACH);
      expect(W.surfaceAt(p.x, p.z)).toBe(p.top); expect(W.groundAt(p.x, p.z)).toBeNull();
      expect(p.r).toBeGreaterThanOrEqual(1); expect(p.r).toBeLessThanOrEqual(1.8);
    }
    for (const p of L.pillars) {
      expect(W.surfaceAt(p.x, p.z)).toBeNull(); expect(W.groundAt(p.x, p.z)).toBeNull();
      expect(p.r).toBeGreaterThanOrEqual(0.8); expect(p.r).toBeLessThanOrEqual(1.4);
    }
    // counts per room, as the recipe says; boss rooms have none
    const obs = [...L.pillars.map(p => ({ ...p, kind: 'pillar' })), ...L.rubble.map(p => ({ ...p, kind: 'rubble' }))];
    for (const spec of LAMPFALL_RECIPE.rooms) {
      const r = room(spec.id);
      const inside = (o: { x: number; z: number }) => d2(o.x, o.z, r.x, r.z) < r.r * r.r;
      expect(L.pillars.filter(inside), spec.id).toHaveLength(spec.pillars);
      expect(L.rubble.filter(inside), spec.id).toHaveLength(spec.platforms);
      for (const o of obs.filter(inside)) {
        // a gap to the wall of at least 0.8 m (an adventurer passes), or none (set into the wall by 0.3 m or more);
        // and 2.5 m from spawns, the centre and the corridor mouths
        const wallGap = r.r - dist(o.x, o.z, r.x, r.z) - o.r;
        expect(wallGap >= 0.8 || wallGap <= -0.3, `${spec.id} wall gap ${wallGap}`).toBe(true);
        expect(dist(o.x, o.z, r.x, r.z)).toBeLessThanOrEqual(r.r);
        expect(dist(o.x, o.z, r.x, r.z) - o.r).toBeGreaterThanOrEqual(2.5);
        for (const s of r.spawns) expect(dist(o.x, o.z, s.x, s.z) - o.r).toBeGreaterThanOrEqual(2.5);
      }
    }
    for (let i = 0; i < obs.length; i++) for (let j = i + 1; j < obs.length; j++) {
      expect(dist(obs[i].x, obs[i].z, obs[j].x, obs[j].z) - obs[i].r - obs[j].r).toBeGreaterThanOrEqual(2.5);
    }
    for (const c of L.corridors) for (const o of obs) {
      for (const [x, z] of [[c.ax, c.az], [c.bx, c.bz]]) expect(dist(o.x, o.z, x, z) - o.r).toBeGreaterThanOrEqual(2.5 + c.w / 2);
    }
    for (const id of ['wick_den', 'lens_pit'] as const) {
      const r = room(id);
      for (let x = r.x - r.r; x <= r.x + r.r; x += 0.25) for (let z = r.z - r.r; z <= r.z + r.r; z += 0.25) {
        if (d2(x, z, r.x, r.z) > r.r * r.r) continue;
        expect(W.surfaceAt(x, z)).toBe(r.floorY); expect(W.groundAt(x, z)).toBe(r.floorY);
      }
    }
  });

  it("spawns are the encounter table rotated to the room's entry, inside the floor, on ground", () => {
    let total = 0;
    for (const spec of LAMPFALL_RECIPE.rooms) {
      const r = room(spec.id);
      if (!spec.encounter) { expect(r.spawns).toEqual([]); continue; }
      const enc = ENCOUNTERS[spec.encounter];
      expect(enc.roomR, spec.id).toBe(r.r);
      expect(r.spawns.map(s => s.kind)).toEqual(enc.spawns.map(s => s.kind));
      // the entry direction points at the entry corridor's mouth
      const c = L.corridors.find(k => k.to === r.id)!;
      expect(Math.abs(yawOf(c.bx - r.x, c.bz - r.z) - r.entryDir)).toBeLessThan(1e-12);
      const ex = Math.sin(r.entryDir), ez = Math.cos(r.entryDir);
      enc.spawns.forEach((e, k) => {
        const s = r.spawns[k];
        // the encounter's −z is the entry: local +z is away from it, local +x to its right as seen entering
        const lz = -((s.x - r.x) * ex + (s.z - r.z) * ez), lx = (s.x - r.x) * -ez + (s.z - r.z) * ex;
        expect(lx).toBeCloseTo(e.dx, 9); expect(lz).toBeCloseTo(e.dz, 9);
        expect(W.groundAt(s.x, s.z)).toBe(r.floorY);
        expect(withClearance((x, z) => W.groundAt(x, z) !== null, ENEMY_KINDS[s.kind].radius)(s.x, s.z), `${s.kind}`).toBe(true);
        // facing the entry mouth
        expect(Math.abs(s.facing - yawOf(c.bx - s.x, c.bz - s.z))).toBeLessThan(1e-12);
        total++;
      });
    }
    expect(total).toBe(12);
  });

  it('the sealed rooms have a gate circle on their entry corridor, outside the room (and the Wick Den on its way on)', () => {
    for (const r of L.rooms) {
      const sealed = r.id === 'wick_den' || r.id === 'lens_pit';
      expect(r.gate !== null, r.id).toBe(sealed);
      expect(r.exitGate !== null, r.id).toBe(r.id === 'wick_den');
      if (!r.gate) continue;
      const entry = L.corridors.find(c => c.to === r.id)!;
      const gates: [NonNullable<DungeonRoom['gate']>, typeof entry][] = [[r.gate, entry]];
      if (r.exitGate) gates.push([r.exitGate, L.corridors.find(c => c.from === r.id)!]);
      for (const [g, c] of gates) {
        expect(g.r).toBe(SEAL_GATE_R);
        // its centre is outside the room, on the corridor's axis, and the circle spans the corridor's width
        expect(dist(g.x, g.z, r.x, r.z)).toBeGreaterThan(r.r);
        const len = dist(c.ax, c.az, c.bx, c.bz), ux = (c.bx - c.ax) / len, uz = (c.bz - c.az) / len;
        const lat = (g.x - c.ax) * -uz + (g.z - c.az) * ux, along = (g.x - c.ax) * ux + (g.z - c.az) * uz;
        expect(Math.abs(lat)).toBeLessThan(1e-9);
        expect(along).toBeGreaterThan(0); expect(along).toBeLessThan(len);
        expect(g.r).toBeGreaterThan(c.w / 2);
        // nobody walks round it: every corridor cross-section through its centre is inside it
        for (let l = -c.w / 2; l <= c.w / 2; l += 0.1) expect(d2(g.x - uz * l, g.z + ux * l, g.x, g.z)).toBeLessThanOrEqual(g.r * g.r);
      }
    }
    // the rim's exit stair and the Lens Pit's lamp-lift
    const rim = room('rim'), pit = room('lens_pit');
    expect(dist(L.exitStair.x, L.exitStair.z, rim.x, rim.z) + L.exitStair.r).toBeLessThanOrEqual(rim.r);
    expect(dist(L.exitStair.x, L.exitStair.z, rim.x, rim.z)).toBeGreaterThan(L.exitStair.r + 0.5); // the spawn is not in it
    expect(L.lampLift).toMatchObject({ x: pit.x, z: pit.z });
  });

  it('boss arenas: no spot out of a melee boss\'s reach (no safe ledge), no pocket, flat, and the boss can stand where it must', () => {
    const g = grid(L);
    for (const [id, kind] of [['wick_den', 'wickhound'], ['lens_pit', 'fallen_warden']] as const) {
      const r = room(id), k = ENEMY_KINDS[kind];
      const camp = r.spawns[0];
      expect(camp).toMatchObject({ kind, x: r.x, z: r.z });
      expect(k.leash).toBe(r.r - 2); // the Numbers: leash = room r − 2
      const bossStands = withClearance((x, z) => W.groundAt(x, z) !== null, k.radius);
      const fromCamp = flood(g, camp.x, camp.z, 0);
      let cells = 0;
      for (let x = r.x - r.r - 6; x <= r.x + r.r + 6; x += STEP) for (let z = r.z - r.r - 6; z <= r.z + r.r + 6; z += STEP) {
        if (!inArena(r, x, z) || W.surfaceAt(x, z) === null) continue;
        cells++;
        // no ledge to stand on: the room's floor, or the corridor's ramp just beyond its edge (no platform)
        const beyond = Math.max(0, dist(x, z, r.x, r.z) - r.r), h = W.surfaceAt(x, z)!;
        expect(h, `${id} below the floor at (${x}, ${z})`).toBeGreaterThanOrEqual(r.floorY - 1e-9);
        expect(h - r.floorY, `${id} ledge at (${x}, ${z})`).toBeLessThanOrEqual(0.25 * beyond + 1e-9);
        expect(W.groundAt(x, z)).toBe(h);
        const d = dist(x, z, camp.x, camp.z);
        // the boss walks out to its leash (or to the spot itself) and swings: reach is from its edge
        const t = Math.min(1, k.leash / d), bx = camp.x + (x - camp.x) * t, bz = camp.z + (z - camp.z) * t;
        expect(bossStands(bx, bz), `${id} boss at (${bx}, ${bz})`).toBe(true);
        expect(dist(x, z, bx, bz) - k.radius, `${id} out of reach at (${x}, ${z})`).toBeLessThanOrEqual(k.auto!.reach - 0.3);
        const c = cellOf(g, x, z);
        if (g.h[c] !== null) expect(fromCamp[c], `${id} pocket at (${x}, ${z})`).toBe(1);
      }
      expect(cells).toBeGreaterThan(Math.floor(3.1 * r.r * r.r / (STEP * STEP)));
    }
  });

  it("arena radii fit the Numbers: the Warden's fire rings, shards and telegraphs; the Wickhound's ring", () => {
    const pit = room('lens_pit'), den = room('wick_den');
    expect(pit.r).toBe(22); expect(den.r).toBe(16);
    /** Farthest arena point from the boss's camp (the corridor strips included). */
    const farthest = (r: DungeonRoom) => {
      let m = 0;
      for (let x = r.x - r.r - 6; x <= r.x + r.r + 6; x += 0.25) for (let z = r.z - r.r - 6; z <= r.z + r.r + 6; z += 0.25) {
        if (inArena(r, x, z) && W.surfaceAt(x, z) !== null) m = Math.max(m, dist(x, z, r.x, r.z));
      }
      return m;
    };
    const far = farthest(pit);
    expect(far).toBeLessThan(pit.r + 1);
    const warden = BOSSES.fallen_warden;
    const rings = warden.phases.flatMap(p => p.onEnter?.fields ?? []).map(f => f.shape as { kind: string; inner: number; r: number });
    expect(rings.map(f => f.kind)).toEqual(['ring', 'ring']);
    let lastInner = pit.r;
    for (const f of rings) {
      // a real safe floor that shrinks each phase, and the fire covers everything beyond it, up to the gates
      expect(f.inner).toBeLessThan(lastInner); lastInner = f.inner;
      expect(f.inner).toBeGreaterThanOrEqual(10);
      expect(f.r).toBeGreaterThanOrEqual(far);
      // the fire band on the floor is at least 5 m deep
      expect(pit.r - f.inner).toBeGreaterThanOrEqual(5);
    }
    // the shards stand on the safe floor of phase 2, inside the room
    const adds = warden.phases.flatMap(p => p.onEnter?.adds ?? []);
    const phase2Inner = rings[0].inner;
    for (const a of adds) {
      expect(Math.sqrt(a.dx * a.dx + a.dz * a.dz) + ENEMY_KINDS[a.kind].radius).toBeLessThan(phase2Inner);
      expect(Math.sqrt(a.dx * a.dx + a.dz * a.dz)).toBeGreaterThan(ENEMY_KINDS.fallen_warden.radius + ENEMY_KINDS[a.kind].radius + 2);
    }
    // arena-wide telegraphs cover every spot; the turning light sweeps out past the last safe floor
    for (const a of ['keepers_toll', 'last_light'] as const) expect(ENEMY_ATTACKS[a].r!).toBeGreaterThanOrEqual(far);
    expect(ENEMY_ATTACKS.turning_light.length!).toBeGreaterThanOrEqual(lastInner);
    // four adventurers can spread Brass Fall circles on the smallest safe floor: four r-3 circles side by side
    const bf = ENEMY_ATTACKS.brass_fall.r!;
    expect(2 * bf * 4).toBeLessThanOrEqual(2 * lastInner + 1e-9);
    // the beacon lance's knock (12 m/s for 0.4 s) cannot carry anyone from the safe floor out of the arena
    expect(lastInner + 12 * 0.4).toBeLessThan(pit.r);
    // the Wickhound's Cinder Ring leaves a band outside it and a hole inside it to stand in
    const cr = ENEMY_ATTACKS.cinder_ring;
    expect(den.r - cr.r!).toBeGreaterThanOrEqual(5);
    expect(cr.inner!).toBeGreaterThan(ENEMY_KINDS.wickhound.radius + 1);
    const wFar = farthest(den);
    expect(wFar).toBeLessThan(den.r + 1);
  });

  it('the generator scan forbids trig, pow, random and double stars in dungeon.ts', async () => {
    const fs: { readFileSync(p: string, enc: 'utf8'): string } = await import('node:fs' as string);
    const here = expect.getState().testPath!.replace(/[^/\\]+$/, '');
    const src = fs.readFileSync(here + 'dungeon.ts', 'utf8');
    expect(src.length).toBeGreaterThan(3000);
    expect(src.match(/Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log\w*|pow|hypot|cbrt|random)\b|\*\*/)?.[0] ?? null).toBeNull();
  });

  it('a recipe that cannot fit its rooms throws deterministically (never a silent bad layout)', () => {
    const cramped = { ...LAMPFALL_RECIPE, corridor: { ...LAMPFALL_RECIPE.corridor, minLen: 0.5, maxLen: 0.5 } };
    const msg = (() => { try { generateDungeon(cramped); return null; } catch (e) { return (e as Error).message; } })();
    expect(msg).toMatch(/^generateDungeon\(lampfall\): /);
    expect(() => generateDungeon(cramped)).toThrow(msg!);
  });

  it('speed: generateDungeon finishes in under 100 ms', () => {
    const t0 = Date.now();
    generateDungeon(LAMPFALL_RECIPE);
    expect(Date.now() - t0).toBeLessThan(100);
  });
});
