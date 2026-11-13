// Loot sparkles and the level-up column, in the world. A drop makes a short burst of sparks at the spot the enemy fell,
// in the best item's rarity colour (a named weapon: a bigger gold burst); a level-up raises a column of light on the
// adventurer for a moment (others see it too, from the state's lvlAt). Everything is pooled and made once: nothing is
// allocated per frame. Unlit, emissive and additive-looking, in PALETTE-derived colours.
import { Color3, Mesh, MeshBuilder, StandardMaterial, type Scene, type TransformNode } from '@babylonjs/core';

const SPARKS = 7;
const BURSTS = 3;
const COLUMNS = 3;
const BURST_S = 1.1;
const COLUMN_S = 1.8;

interface Burst { meshes: Mesh[]; mat: StandardMaterial; t: number; x: number; y: number; z: number; big: boolean }
interface Column { mesh: Mesh; ring: Mesh; mat: StandardMaterial; t: number; follow: TransformNode | null; x: number; y: number; z: number }

const hexInto = (hex: string, c: Color3) => {
  const n = parseInt(hex.slice(1), 16);
  c.r = ((n >> 16) & 255) / 255; c.g = ((n >> 8) & 255) / 255; c.b = (n & 255) / 255;
};

export interface GearFx {
  /** Sparks at (x, y, z) in `colour` (a CSS hex); big: a named weapon. */
  sparkle(x: number, y: number, z: number, colour: string, big: boolean): void;
  /** A column of light on `root` (follows it), or at a point. */
  column(root: TransformNode | null, x: number, y: number, z: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createGearFx(scene: Scene): GearFx {
  const bursts: Burst[] = [];
  const columns: Column[] = [];
  let made = false;
  const make = () => {
    if (made) return;
    made = true;
    for (let b = 0; b < BURSTS; b++) {
      const mat = new StandardMaterial(`gearfx_spark${b}`, scene);
      mat.disableLighting = true; mat.emissiveColor = new Color3(1, 1, 1); mat.alpha = 1;
      const meshes: Mesh[] = [];
      for (let k = 0; k < SPARKS; k++) {
        const m = MeshBuilder.CreatePolyhedron(`gearfx_s${b}_${k}`, { type: 1, size: 0.09 }, scene);
        m.material = mat; m.isPickable = false; m.setEnabled(false);
        meshes.push(m);
      }
      bursts.push({ meshes, mat, t: -1, x: 0, y: 0, z: 0, big: false });
    }
    for (let c = 0; c < COLUMNS; c++) {
      const mat = new StandardMaterial(`gearfx_col${c}`, scene);
      mat.disableLighting = true; mat.emissiveColor = new Color3(1, 0.86, 0.45); mat.alpha = 0; mat.backFaceCulling = false;
      const mesh = MeshBuilder.CreateCylinder(`gearfx_c${c}`, { height: 1, diameterTop: 0.5, diameterBottom: 1.1, tessellation: 14, cap: 0 }, scene);
      const ring = MeshBuilder.CreateTorus(`gearfx_r${c}`, { diameter: 1.4, thickness: 0.07, tessellation: 24 }, scene);
      mesh.material = mat; ring.material = mat;
      mesh.isPickable = false; ring.isPickable = false;
      mesh.setEnabled(false); ring.setEnabled(false);
      columns.push({ mesh, ring, mat, t: -1, follow: null, x: 0, y: 0, z: 0 });
    }
  };
  return {
    sparkle(x, y, z, colour, big) {
      make();
      let b = bursts.find((q) => q.t < 0);
      if (!b) b = bursts.reduce((a, q) => (q.t > a.t ? q : a), bursts[0]!);
      b.t = 0; b.x = x; b.y = y; b.z = z; b.big = big;
      hexInto(colour, b.mat.emissiveColor);
      b.mat.alpha = 1;
      for (const m of b.meshes) { m.setEnabled(true); m.scaling.setAll(big ? 1.6 : 1); }
    },
    column(root, x, y, z) {
      make();
      let c = columns.find((q) => q.t < 0);
      if (!c) c = columns.reduce((a, q) => (q.t > a.t ? q : a), columns[0]!);
      c.t = 0; c.follow = root; c.x = x; c.y = y; c.z = z;
      c.mesh.setEnabled(true); c.ring.setEnabled(true);
    },
    update(dt) {
      for (const b of bursts) {
        if (b.t < 0) continue;
        b.t += dt;
        const k = b.t / BURST_S;
        if (k >= 1) { b.t = -1; for (const m of b.meshes) m.setEnabled(false); continue; }
        const spread = (b.big ? 1.3 : 0.8) * Math.min(1, k * 2.2);
        for (let i = 0; i < b.meshes.length; i++) {
          const m = b.meshes[i]!;
          const a = (i / SPARKS) * Math.PI * 2 + k * 2.5;
          m.position.set(b.x + Math.cos(a) * spread * (0.6 + 0.4 * ((i * 37) % 7) / 7), b.y + 0.4 + k * (b.big ? 2.2 : 1.5) + ((i * 13) % 5) * 0.08, b.z + Math.sin(a) * spread * 0.9);
          m.rotation.y = k * 9 + i; m.rotation.x = k * 6;
        }
        b.mat.alpha = 1 - k * k;
      }
      for (const c of columns) {
        if (c.t < 0) continue;
        c.t += dt;
        const k = c.t / COLUMN_S;
        if (k >= 1) { c.t = -1; c.mesh.setEnabled(false); c.ring.setEnabled(false); c.follow = null; continue; }
        const p = c.follow && !c.follow.isDisposed() ? c.follow.position : null;
        const x = p ? p.x : c.x, y = p ? p.y : c.y, z = p ? p.z : c.z;
        const hgt = 0.5 + Math.min(1, k * 3) * 4.5;
        c.mesh.scaling.set(1, hgt, 1);
        c.mesh.position.set(x, y + hgt / 2, z);
        c.mesh.rotation.y = k * 3;
        c.ring.position.set(x, y + 0.08 + k * 2.6, z);
        c.ring.scaling.setAll(0.8 + k * 0.7);
        c.mat.alpha = 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.15));
      }
    },
    dispose() {
      for (const b of bursts) { for (const m of b.meshes) m.dispose(); b.mat.dispose(); }
      for (const c of columns) { c.mesh.dispose(); c.ring.dispose(); c.mat.dispose(); }
      bursts.length = 0; columns.length = 0; made = false;
    },
  };
}
