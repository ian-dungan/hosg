// The five town stalls round the Plaza of the Two (online only): small code-built booths, each with an awning in its
// own colour, a sign with its glyph, a counter and its goods (an anvil, bolts of cloth, a barber's chair, a rack of
// lamps, a strongbox), and its keeper (a look-driven adventurer from defaultLook(keeper's name)) behind the counter.
// All five booths are two meshes (lit, and the lamps' glow), flat-shaded in PALETTE-derived vertex colours. A tap on a
// booth reports STALL_EID[id] (its meshes and a larger invisible pick box carry metadata.entityId).
import { Color3, Mesh, MeshBuilder, StandardMaterial, type Material, type Scene } from '@babylonjs/core';
import { STALL_IDS, TOWN_STALLS, defaultLook, type StallId } from '@sg2/shared';
import type { CharacterView, WorldApi } from '../core/contracts';
import { makeCharacter } from '../player/character';
import { Builder, hex, tint, type RGB } from './mesh';
import { Kit, PAL, lantern } from './parts';

export { STALL_EID, stallOfEid } from './stallIds';
import { STALL_EID } from './stallIds';

/** Each stall's awning colour (PALETTE-derived). */
const AWNING: Readonly<Record<StallId, RGB>> = {
  smithy: hex('#EC6A4C'), tailor: hex('#3FB0A6'), barber: hex('#8FD16A'), lampwright: hex('#5D4675'), vault: hex('#479AF2'),
};

export interface Stalls {
  /** Where each booth stands (the shared spots) and its keeper. */
  readonly keepers: Readonly<Record<StallId, CharacterView>>;
  /** Triangles of the booths (budget checks). */
  readonly tris: number;
  update(dt: number): void;
  dispose(): void;
}

export function createStalls(scene: Scene, world: WorldApi): Stalls {
  const b = new Builder(131), g = new Builder(132);
  const k = new Kit(b, g);
  const cream: RGB = hex('#FFFAF3'), wood = PAL.wood, dark = PAL.woodDark, gold = PAL.gold;
  for (const id of STALL_IDS) {
    const s = TOWN_STALLS[id];
    const y = world.groundAt(s.x, s.z) ?? 0;
    b.push(); b.T(s.x, y, s.z); b.RY(s.facing);
    const aw = AWNING[id];
    // four posts, a counter across the front, a back board
    for (const [px, pz] of [[-1.25, 0.75], [1.25, 0.75], [-1.25, -0.75], [1.25, -0.75]] as const) b.prism([px, 0, pz], [px, 2.35, pz], 0.07, 0.06, 6, dark);
    b.box(0, 0.5, 0.62, 2.5, 1.0, 0.42, wood, PAL.woodLight);
    b.box(0, 1.02, 0.62, 2.62, 0.06, 0.54, PAL.woodLight);
    b.box(0, 0.06, 0.62, 2.5, 0.12, 0.44, tint(aw, 0.7));
    b.box(0, 1.2, -0.78, 2.5, 2.0, 0.06, tint(wood, 0.85));
    // the striped awning, sloping to the front
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x0 = -1.4 + (2.8 * i) / n, x1 = -1.4 + (2.8 * (i + 1)) / n;
      const col = i % 2 ? cream : aw;
      b.quad([x0, 2.5, -0.9], [x1, 2.5, -0.9], [x1, 2.12, 1.05], [x0, 2.12, 1.05], col, tint(col, 0.9));
      b.quad([x0, 2.12, 1.05], [x1, 2.12, 1.05], [x1, 1.9, 1.1], [x0, 1.9, 1.1], tint(col, 0.86));
    }
    // the sign above the awning's front edge, with the stall's glyph
    b.box(0, 2.72, 0.95, 1.1, 0.44, 0.06, dark);
    b.box(0, 2.72, 0.985, 0.98, 0.34, 0.02, cream);
    b.prism([-0.4, 2.5, 0.95], [-0.4, 2.94, 0.95], 0.02, 0.02, 4, gold);
    b.prism([0.4, 2.5, 0.95], [0.4, 2.94, 0.95], 0.02, 0.02, 4, gold);
    glyph(b, id, aw, gold, dark);
    goods(k, id, aw, gold, dark);
    b.pop();
  }
  const lit = (scene.getMaterialByName('world_lit') as Material | null) ?? (() => {
    const m = new StandardMaterial('stallsMat', scene); m.specularColor = Color3.Black(); return m;
  })();
  const glowMat = (scene.getMaterialByName('world_glow') as Material | null) ?? (() => {
    const m = new StandardMaterial('stallsGlow', scene); m.disableLighting = true; m.emissiveColor = new Color3(1, 1, 1); return m;
  })();
  const tris = b.tris + g.tris;
  const body = b.build(scene, 'stalls_body', lit);
  const glow = g.tris > 0 ? g.build(scene, 'stalls_glow', glowMat) : null;
  body.isPickable = false;
  if (glow) glow.isPickable = false;
  world.addShadowCaster(body);
  // invisible pick boxes (one per stall; a thumb hits the booth easily), and the keepers
  const hits: Mesh[] = [];
  const keepers = {} as Record<StallId, CharacterView>;
  for (const id of STALL_IDS) {
    const s = TOWN_STALLS[id];
    const y = world.groundAt(s.x, s.z) ?? 0;
    const hit = MeshBuilder.CreateBox(`stall_hit_${id}`, { width: 2.9, height: 2.9, depth: 1.9 }, scene);
    hit.position.set(s.x, y + 1.45, s.z); hit.rotation.y = s.facing;
    hit.visibility = 0; hit.isPickable = true; hit.metadata = { stall: id, entityId: STALL_EID[id] };
    hits.push(hit);
    const v = makeCharacter(scene, { kind: 'player', weapon: 'none', look: defaultLook(s.keeper), detail: 'med' });
    // behind the counter, facing out over it
    const bx = -Math.sin(s.facing) * 0.3, bz = -Math.cos(s.facing) * 0.3;
    v.root.position.set(s.x + bx, y, s.z + bz);
    v.root.rotation.y = s.facing;
    v.setEntityId(STALL_EID[id]);
    world.addShadowCaster(v.root);
    keepers[id] = v;
  }
  return {
    keepers, tris,
    update(dt) { for (const id of STALL_IDS) keepers[id].update(dt); },
    dispose() {
      body.dispose(); glow?.dispose();
      for (const m of hits) m.dispose();
      for (const id of STALL_IDS) keepers[id].dispose();
    },
  };
}

/** The sign's glyph, raised off its face: a hammer, a needle and thread, scissors, a lamp, a key. */
function glyph(b: Builder, id: StallId, aw: RGB, gold: RGB, dark: RGB): void {
  const z = 1.0;
  switch (id) {
    case 'smithy': b.box(0.05, 2.72, z, 0.06, 0.26, 0.02, dark); b.box(0.05, 2.83, z, 0.26, 0.09, 0.025, aw); break;
    case 'tailor': b.box(0, 2.72, z, 0.03, 0.28, 0.02, dark); b.box(0.09, 2.7, z, 0.18, 0.03, 0.02, aw); b.box(-0.09, 2.74, z, 0.18, 0.03, 0.02, aw); break;
    case 'barber':
      b.push(); b.T(0, 2.72, z); b.RZ(0.6); b.box(0, 0, 0, 0.04, 0.3, 0.02, dark); b.pop();
      b.push(); b.T(0, 2.72, z); b.RZ(-0.6); b.box(0, 0, 0, 0.04, 0.3, 0.02, dark); b.pop();
      b.box(-0.09, 2.6, z, 0.07, 0.07, 0.025, aw); b.box(0.09, 2.6, z, 0.07, 0.07, 0.025, aw); break;
    case 'lampwright': b.box(0, 2.7, z, 0.12, 0.16, 0.025, gold); b.box(0, 2.81, z, 0.16, 0.04, 0.025, dark); b.box(0, 2.6, z, 0.16, 0.04, 0.025, dark); break;
    case 'vault': b.box(-0.06, 2.72, z, 0.12, 0.12, 0.025, gold); b.box(0.08, 2.72, z, 0.18, 0.035, 0.025, gold); b.box(0.15, 2.68, z, 0.03, 0.07, 0.025, gold); break;
  }
}

/** The goods on and by the counter. */
function goods(k: Kit, id: StallId, aw: RGB, gold: RGB, dark: RGB): void {
  const b = k.b;
  const iron = hex('#4a4a5c'), ironL = hex('#6a6a80');
  switch (id) {
    case 'smithy': // an anvil on a stump beside the counter, and a rack of blades on the back board
      b.prism([1.75, 0, 0.3], [1.75, 0.5, 0.3], 0.22, 0.24, 7, PAL.woodDark);
      b.box(1.75, 0.6, 0.3, 0.5, 0.18, 0.2, iron, ironL); b.box(1.75, 0.7, 0.3, 0.62, 0.08, 0.24, ironL);
      for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) b.box(x, 1.45, -0.72, 0.06, 0.7, 0.03, ironL);
      b.box(0, 1.85, -0.72, 2.0, 0.06, 0.05, dark);
      break;
    case 'tailor': // bolts of cloth on the counter and on a shelf
      [hex('#EC6A4C'), hex('#8FD16A'), hex('#479AF2'), hex('#F2B742'), hex('#b0508a')].forEach((c, i) => {
        b.prism([-0.95 + i * 0.42, 1.12, 0.48], [-0.95 + i * 0.42, 1.12, 0.78], 0.11, 0.11, 7, c, { caps: true });
        b.prism([-0.95 + i * 0.42, 1.52, -0.68], [-0.95 + i * 0.42, 1.52, -0.42], 0.1, 0.1, 7, tint(c, 0.85), { caps: true });
      });
      b.box(0, 1.38, -0.58, 2.2, 0.04, 0.34, PAL.woodLight);
      break;
    case 'barber': // a chair beside the booth, a striped pole
      b.box(1.8, 0.45, 0.4, 0.55, 0.1, 0.55, aw); b.box(1.8, 0.85, 0.12, 0.55, 0.7, 0.08, aw);
      b.prism([1.8, 0, 0.4], [1.8, 0.4, 0.4], 0.06, 0.08, 6, iron);
      for (let i = 0; i < 6; i++) b.prism([-1.55, 0.3 + i * 0.3, 0.75], [-1.55, 0.6 + i * 0.3, 0.75], 0.06, 0.06, 6, i % 2 ? hex('#FFFAF3') : hex('#EC6A4C'));
      break;
    case 'lampwright': // a rack of lit lamps
      b.box(0, 1.6, -0.6, 2.2, 0.05, 0.3, dark);
      for (const x of [-0.8, 0, 0.8]) lantern(k, x, 1.06, 0.62, 0.42);
      for (const x of [-0.9, -0.3, 0.3, 0.9]) lantern(k, x, 1.64, -0.6, 0.36);
      break;
    case 'vault': // a strongbox with gold bands
      b.box(0, 1.27, 0.6, 0.9, 0.45, 0.4, PAL.woodDark, PAL.wood);
      for (const x of [-0.3, 0.3]) b.box(x, 1.27, 0.6, 0.07, 0.47, 0.42, gold);
      b.box(0, 1.3, 0.81, 0.12, 0.12, 0.02, gold);
      b.box(-1.6, 0.45, 0.2, 0.6, 0.9, 0.5, tint(PAL.woodDark, 0.9));
      break;
  }
}
