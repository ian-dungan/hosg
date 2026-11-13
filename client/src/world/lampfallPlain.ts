// The Lampfall's placeholder look (Plan 4 Task 8), from the shared layout (lampfallLayout()): flat stone floors
// for every room and corridor (the Wick Stair's terraces as steps), low walls along every floor edge, the pillars
// and rubble platforms, the lamp-gates as glowing barriers while shut, the two sanctuaries (the job board works
// there) as rings of light, the exit stair and the lamp-lift. Plain and readable, so the whole run can be played;
// Task 9 builds the real look.
// Movement and prediction use the shared walk with every shut gate a wall (gatedSurface, as on the server), so an
// honest adventurer is never corrected at a gate.
import { Color3, Color4, DirectionalLight, HemisphericLight, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { gatedSurface, lampfallGates, lampfallLayout, type DungeonLayout, type Surface } from '@sg2/shared';
import { PALETTE, type Anchor, type AnchorName, type WorldApi } from '../core/contracts';
import { Builder, hex, tint, type RGB } from './mesh';

/** What the placeholder needs from the room: the shut-gate bits and whether the lamp-lift is open. */
export interface LampfallLive { gates(): number; lift(): boolean }

/** The walk with every shut gate (as `gates()` says now) a wall: the same wrapper the server uses. */
export function lampfallSurfaces(gates: () => number, layout: DungeonLayout = lampfallLayout()): { surface: Surface; ground: Surface } {
  const walk = layout.walk;
  return {
    surface: gatedSurface((x, z) => walk.surfaceAt(x, z), gates),
    ground: gatedSurface((x, z) => walk.groundAt(x, z), gates),
  };
}

/** The room the point (x, z) is in, or null (a corridor, or off the floor). */
export function lampfallRoomAt(x: number, z: number, layout: DungeonLayout = lampfallLayout()) {
  for (const r of layout.rooms) if ((x - r.x) * (x - r.x) + (z - r.z) * (z - r.z) <= r.r * r.r) return r;
  return null;
}

const C3 = (h: string) => { const c = hex(h); return new Color3(c[0], c[1], c[2]); };
/** Floor tint per room (stone shaded down, each room a little different). */
const ROOM_TINT = [0.74, 0.7, 0.66, 0.7, 0.62, 0.72, 0.6];
const WALL_H = 1.4, WALL_T = 0.35;

export function buildLampfallPlain(scene: Scene, live: LampfallLive): WorldApi {
  const layout = lampfallLayout();
  const walk = layout.walk;
  const { surface, ground } = lampfallSurfaces(live.gates, layout);

  // ───── atmosphere: dark, but the floor stays light enough for telegraphs ─────
  const fog = C3('#2a2240');
  scene.clearColor = new Color4(fog.r, fog.g, fog.b, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR; scene.fogColor = fog; scene.fogStart = 30; scene.fogEnd = 120;
  scene.ambientColor = new Color3(0.25, 0.22, 0.3);
  const hemi = new HemisphericLight('lf_fill', new Vector3(0.2, 1, 0.1), scene);
  hemi.diffuse = C3('#e8dcc8'); hemi.groundColor = C3('#3a2e52'); hemi.specular = new Color3(0, 0, 0); hemi.intensity = 0.95;
  const sun = new DirectionalLight('lf_key', new Vector3(-0.4, -1, 0.3), scene);
  sun.diffuse = C3('#ffd9a8'); sun.specular = new Color3(0, 0, 0); sun.intensity = 0.45;

  const mat = (name: string, emissive = 0) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = new Color3(1, 1, 1); m.specularColor = new Color3(0, 0, 0);
    m.emissiveColor = new Color3(emissive, emissive, emissive);
    return m;
  };
  const mFloor = mat('lf_floor'), mWall = mat('lf_wall', 0.05);
  const stone = hex(PALETTE.stone), rock = hex(PALETTE.rock);

  // ───── floors ─────
  const floorB = new Builder(901);
  floorB.cj = 0.02; floorB.hint = 'up';
  layout.rooms.forEach((r, i) => {
    const col = tint(stone, ROOM_TINT[i % ROOM_TINT.length]), n = Math.max(24, Math.ceil(r.r * 4));
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      floorB.tri([r.x, r.floorY, r.z], [r.x + Math.sin(a0) * r.r, r.floorY, r.z + Math.cos(a0) * r.r], [r.x + Math.sin(a1) * r.r, r.floorY, r.z + Math.cos(a1) * r.r], col);
    }
  });
  const corridorCol = tint(stone, 0.64), lipCol = tint(stone, 0.9);
  for (const c of layout.corridors) {
    const ex = c.bx - c.ax, ez = c.bz - c.az, len = Math.hypot(ex, ez), ux = ex / len, uz = ez / len, px = -uz * (c.w / 2), pz = ux * (c.w / 2);
    // a little past each mouth, into the rooms, so no seam shows
    const s0 = -0.6, s1 = len + 0.6, step = 0.25;
    const yAt = (s: number) => walk.floor(c.ax + ux * Math.max(0, Math.min(len, s)), c.az + uz * Math.max(0, Math.min(len, s))) ?? c.ay;
    for (let s = s0; s < s1 - 1e-9; s += step) {
      const t = Math.min(s1, s + step), y = yAt(s + step / 2), y2 = yAt(t + step / 2);
      const ax = c.ax + ux * s, az = c.az + uz * s, bx = c.ax + ux * t, bz = c.az + uz * t;
      floorB.quad([ax - px, y, az - pz], [ax + px, y, az + pz], [bx + px, y, bz + pz], [bx - px, y, bz - pz], corridorCol);
      if (Math.abs(y2 - y) > 0.05 && t < s1) {
        // a terrace edge: a lighter lip and the riser down to the next step
        const lo = Math.min(y, y2), hi = Math.max(y, y2);
        floorB.withHint(null, () => floorB.quad([bx - px, lo, bz - pz], [bx + px, lo, bz + pz], [bx + px, hi, bz + pz], [bx - px, hi, bz - pz], lipCol));
      }
    }
  }
  const floor = floorB.build(scene, 'lf_floors', mFloor);
  floor.isPickable = true; // tap-to-walk

  // ───── low walls along every floor edge, pillars and rubble ─────
  const wallB = new Builder(902);
  wallB.cj = 0.05;
  const wallCol = tint(rock, 1.1), pillarCol = tint(rock, 1.35), rubbleCol = tint(stone, 0.55);
  const open = (x: number, z: number) => walk.floor(x, z) !== null;
  for (const r of layout.rooms) {
    const n = Math.max(32, Math.ceil(r.r * 3));
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
      // a wall where the floor ends (not across a corridor mouth)
      if (open(r.x + Math.sin(am) * (r.r + 0.4), r.z + Math.cos(am) * (r.r + 0.4))) continue;
      const R = r.r + WALL_T / 2;
      wallB.quad([r.x + Math.sin(a0) * R, r.floorY, r.z + Math.cos(a0) * R], [r.x + Math.sin(a1) * R, r.floorY, r.z + Math.cos(a1) * R],
        [r.x + Math.sin(a1) * R, r.floorY + WALL_H, r.z + Math.cos(a1) * R], [r.x + Math.sin(a0) * R, r.floorY + WALL_H, r.z + Math.cos(a0) * R], wallCol);
    }
  }
  for (const c of layout.corridors) {
    const ex = c.bx - c.ax, ez = c.bz - c.az, len = Math.hypot(ex, ez), ux = ex / len, uz = ez / len;
    for (const side of [-1, 1]) {
      const ox = -uz * side * (c.w / 2 + WALL_T / 2), oz = ux * side * (c.w / 2 + WALL_T / 2);
      for (let s = 0; s < len; s += 1) {
        const t = Math.min(len, s + 1), m = (s + t) / 2;
        const mx = c.ax + ux * m + ox, mz = c.az + uz * m + oz;
        if (open(mx + ox * 0.2, mz + oz * 0.2)) continue; // inside a room
        const y = walk.floor(c.ax + ux * m, c.az + uz * m) ?? c.ay;
        wallB.quad([c.ax + ux * s + ox, y, c.az + uz * s + oz], [c.ax + ux * t + ox, y, c.az + uz * t + oz], [c.ax + ux * t + ox, y + WALL_H, c.az + uz * t + oz], [c.ax + ux * s + ox, y + WALL_H, c.az + uz * s + oz], wallCol);
      }
    }
  }
  for (const p of layout.pillars) {
    const y = walk.floor(p.x, p.z) ?? 0;
    wallB.prism([p.x, y, p.z], [p.x, y + p.h, p.z], p.r, p.r * 0.85, 7, pillarCol, { caps: true });
  }
  for (const r of layout.rubble) {
    const y = walk.floor(r.x, r.z) ?? 0;
    wallB.prism([r.x, y, r.z], [r.x, r.top, r.z], r.r, r.r * 0.95, 8, rubbleCol, { caps: true, capB: tint(stone, 0.8) });
  }
  const walls = wallB.build(scene, 'lf_walls', mWall);

  // ───── sanctuaries, the exit stair, the lamp-lift (rings of light on the floor) ─────
  const mGlow = new StandardMaterial('lf_glow', scene);
  mGlow.disableLighting = true; mGlow.emissiveColor = new Color3(1, 1, 1);
  const glowB = new Builder(903);
  glowB.cj = 0; glowB.hint = 'up';
  const ring = (b: Builder, x: number, z: number, y: number, r: number, w: number, col: RGB) => {
    const n = Math.max(24, Math.ceil(r * 6));
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const p = (a: number, rr: number): [number, number, number] => [x + Math.sin(a) * rr, y + 0.04, z + Math.cos(a) * rr];
      b.quad(p(a0, r - w), p(a0, r), p(a1, r), p(a1, r - w), col);
    }
  };
  const teal = hex(PALETTE.teal), gold = hex(PALETTE.gold);
  for (const r of layout.rooms) if (r.sanctuary) ring(glowB, r.sanctuary.x, r.sanctuary.z, r.floorY, r.sanctuary.r, 0.25, teal);
  const ex = layout.exitStair, exY = walk.floor(ex.x, ex.z) ?? 0;
  ring(glowB, ex.x, ex.z, exY, ex.r, 0.35, gold);
  ring(glowB, ex.x, ex.z, exY, ex.r * 0.55, 0.2, gold);
  const glow = glowB.build(scene, 'lf_glows', mGlow);
  const liftB = new Builder(904);
  liftB.cj = 0; liftB.hint = 'up';
  const lf = layout.lampLift, lfY = walk.floor(lf.x, lf.z) ?? 0;
  ring(liftB, lf.x, lf.z, lfY, lf.r, 0.35, gold);
  ring(liftB, lf.x, lf.z, lfY, lf.r * 0.5, 0.25, gold);
  const lift = liftB.build(scene, 'lf_lift', mGlow);
  lift.setEnabled(false);

  // ───── the lamp-gates: glowing barriers while shut ─────
  const mGate = new StandardMaterial('lf_gate', scene);
  mGate.disableLighting = true; mGate.emissiveColor = C3('#ff9a4c'); mGate.alpha = 0.55; mGate.backFaceCulling = false;
  const gates = lampfallGates().map((g) => {
    const y = walk.floor(g.x, g.z) ?? 0;
    const m = MeshBuilder.CreateCylinder(`lf_gate_${g.bit}`, { diameter: g.r * 2, height: 3, tessellation: 32, cap: Mesh.NO_CAP }, scene);
    m.position.set(g.x, y + 1.5, g.z);
    m.material = mGate; m.isPickable = false; m.setEnabled(false);
    return { bit: g.bit, mesh: m };
  });
  for (const m of [floor, walls, glow, lift]) { m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true; }
  for (const m of [walls, glow, lift]) m.isPickable = false;

  const rim = layout.rooms[0];
  const start: Anchor = { pos: new Vector3(rim.x, rim.floorY, rim.z), facing: rim.entryDir };
  let shown = -1, liftOn = false, time = 0;
  return {
    groundAt: (x, z) => ground(x, z),
    surfaceAt: (x, z) => surface(x, z),
    anchor: (_n: AnchorName) => ({ pos: start.pos.clone(), facing: start.facing }),
    enemySpawns: () => [],
    raiseBeacon: () => Promise.resolve(),
    get beaconRaised() { return false; },
    setBeaconRaised: () => {},
    fallingStar: () => Promise.resolve(),
    setArenaPhase: () => {},
    statueLens: new Vector3(rim.x, rim.floorY + 2, rim.z),
    setQuality: () => {},
    addShadowCaster: () => {},
    attachCamera: () => {},
    update(dt) {
      time += dt;
      const mask = live.gates();
      if (mask !== shown) { shown = mask; for (const g of gates) g.mesh.setEnabled((mask & g.bit) !== 0); }
      const l = live.lift();
      if (l !== liftOn) { liftOn = l; lift.setEnabled(l); }
      mGate.alpha = 0.45 + 0.15 * Math.sin(time * 3);
    },
  };
}
