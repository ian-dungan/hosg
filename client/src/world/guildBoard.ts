// The Guild Board in the Plaza of the Two (online only): a post-and-board notice board about 2.2 m tall
// with a little roof, seven job plaques (each job's glyph on its colour) and a lantern, built in code,
// flat-shaded in PALETTE colours. A tap on it walks over and opens the job board. Every pickable mesh
// carries metadata { guildBoard: true, entityId: GUILD_BOARD_EID }, so the rig reports the tap as an entity.
import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, type Material, type Scene } from '@babylonjs/core';
import { GUILD_BOARD, JOBS, JOB_IDS } from '@sg2/shared';
import type { WorldApi } from '../core/contracts';
import { Builder } from './mesh';
import { Kit, PAL, lantern } from './parts';
import { JOB_COLOR } from '../hud/jobs';

/** The entity id a tap on the board reports (no engine id is negative). */
export const GUILD_BOARD_EID = -2;
/** How close a tap walks the adventurer before the job board opens, in m. */
export const GUILD_BOARD_REACH = 3;

export interface GuildBoard { readonly root: TransformNode; readonly x: number; readonly z: number; dispose(): void }

const META = { guildBoard: true, entityId: GUILD_BOARD_EID };

export function createGuildBoard(scene: Scene, world: WorldApi): GuildBoard {
  const { x, z, facing } = GUILD_BOARD;
  const y = world.groundAt(x, z) ?? 0;
  const root = new TransformNode('guildBoard', scene);
  root.position.set(x, y, z);
  root.rotation.y = facing;
  root.metadata = META;

  const b = new Builder(91), g = new Builder(92);
  const k = new Kit(b, g);
  const wood = PAL.wood, dark = PAL.woodDark;
  // posts and their stone feet
  for (const sx of [-0.82, 0.82]) {
    b.box(sx, 0.09, 0, 0.3, 0.18, 0.3, PAL.plinthDark, PAL.plinth);
    b.prism([sx, 0.1, 0], [sx, 2.02, 0], 0.075, 0.065, 6, dark);
  }
  // the board: a frame round a lighter panel
  b.box(0, 1.33, -0.02, 1.62, 1.02, 0.07, wood);
  b.box(0, 1.86, 0, 1.78, 0.08, 0.12, dark);
  b.box(0, 0.8, 0, 1.78, 0.08, 0.12, dark);
  // a small gable roof
  const r = PAL.roof1, r2 = PAL.roof2;
  b.quad([-1.02, 2.0, 0.3], [1.02, 2.0, 0.3], [1.02, 2.22, 0], [-1.02, 2.22, 0], r, r2);
  b.quad([1.02, 2.0, -0.3], [-1.02, 2.0, -0.3], [-1.02, 2.22, 0], [1.02, 2.22, 0], r2, r);
  b.box(0, 2.22, 0, 2.08, 0.04, 0.06, PAL.gold);
  // a lantern on an arm off the right post
  b.prism([0.82, 1.62, 0], [1.22, 1.62, 0.02], 0.03, 0.03, 4, dark);
  lantern(k, 1.22, 0.92, 0.02, 0.62, Math.PI / 2);

  const lit = (scene.getMaterialByName('world_lit') as Material | null) ?? (() => {
    const m = new StandardMaterial('guildBoardMat', scene); m.specularColor = Color3.Black(); return m;
  })();
  const glowMat = (scene.getMaterialByName('world_glow') as Material | null) ?? (() => {
    const m = new StandardMaterial('guildBoardGlow', scene); m.disableLighting = true; m.emissiveColor = new Color3(1, 1, 1); return m;
  })();
  const body = b.build(scene, 'guildBoard_body', lit);
  const glow = g.build(scene, 'guildBoard_glow', glowMat);

  // the notices: a parchment with the title and the seven job plaques, drawn on a texture
  const tex = new DynamicTexture('guildBoard_tex', { width: 512, height: 320 }, scene, true);
  const c = tex.getContext() as CanvasRenderingContext2D;
  c.fillStyle = '#f3e3c4'; c.fillRect(0, 0, 512, 320);
  c.fillStyle = 'rgba(138,90,60,.18)'; for (let i = 0; i < 14; i++) c.fillRect(0, i * 23 + 4, 512, 1.5);
  c.fillStyle = '#5e3b2a'; c.font = 'italic 600 46px Georgia, "DejaVu Serif", serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('Guild Board', 256, 46);
  c.fillStyle = PALETTE_GOLD; c.fillRect(126, 78, 260, 3);
  JOB_IDS.forEach((id, i) => {
    const row = i < 4 ? 0 : 1, n = row === 0 ? 4 : 3, col = row === 0 ? i : i - 4;
    const cx = 256 + (col - (n - 1) / 2) * 112, cy = 150 + row * 108;
    c.fillStyle = 'rgba(60,30,10,.35)'; roundRect(c, cx - 44, cy - 40, 88, 88, 14); c.fill();
    c.fillStyle = JOB_COLOR[id].bg; roundRect(c, cx - 46, cy - 46, 92, 88, 14); c.fill();
    c.strokeStyle = '#5e3b2a'; c.lineWidth = 4; c.stroke();
    c.fillStyle = JOB_COLOR[id].fg; c.font = '700 54px "DejaVu Sans", "Segoe UI Symbol", Georgia, serif';
    c.fillText(JOBS[id].glyph, cx, cy - 2);
  });
  tex.update();
  const faceMat = new StandardMaterial('guildBoard_face', scene);
  faceMat.diffuseTexture = tex; faceMat.emissiveColor = new Color3(0.45, 0.42, 0.38); faceMat.specularColor = Color3.Black();
  const face = MeshBuilder.CreatePlane('guildBoard_face', { width: 1.5, height: 0.94 }, scene);
  face.material = faceMat;
  // a plane faces -Z: turn it to face the board's front (+Z), just in front of the panel
  face.rotation.y = Math.PI;
  face.position.set(0, 1.33, 0.02);

  const meshes: Mesh[] = [body, glow, face];
  for (const m of meshes) { m.parent = root; m.isPickable = true; m.metadata = META; }
  world.addShadowCaster(root);
  // a larger invisible pick box, so a thumb on a phone hits it easily
  const hit = MeshBuilder.CreateBox('guildBoard_hit', { width: 2.2, height: 2.4, depth: 0.8 }, scene);
  hit.parent = root; hit.position.y = 1.2; hit.visibility = 0; hit.isPickable = true; hit.metadata = META;
  meshes.push(hit);
  return {
    root, x, z,
    dispose() { for (const m of meshes) m.dispose(); tex.dispose(); faceMat.dispose(); root.dispose(); },
  };
}

const PALETTE_GOLD = '#F2B742';
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
