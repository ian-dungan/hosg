// Ambient life: pollen motes, falling grove leaves, chimney smoke, butterflies, birds,
// soft billboard clouds (the bank that parts for the Beacon), reveal glints and light shaft.
import {
  ParticleSystem, DynamicTexture, Matrix, Color4, Color3, Vector3, SolidParticleSystem, MeshBuilder, StandardMaterial, Mesh,
  type Scene, type Texture,
} from '@babylonjs/core';
import { GROVE_TREES } from './layout';

function tex(scene: Scene, name: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): Texture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const g = t.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, size, size); draw(g, size); t.hasAlpha = true; t.update(); return t;
}
export function dotTex(scene: Scene) {
  return tex(scene, 'wfx_dot', 32, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
}
function leafTex(scene: Scene) {
  return tex(scene, 'wfx_leaf', 32, (g, s) => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(s / 2, s / 2, s * 0.42, s * 0.2, 0.6, 0, Math.PI * 2); g.fill(); });
}
/** Soft painted cloud puff: lit top, lavender base. */
export function puffTex(scene: Scene) {
  return tex(scene, 'wfx_puff', 128, (g, s) => {
    const blobs: [number, number, number][] = [[0.5, 0.58, 0.3], [0.32, 0.62, 0.22], [0.68, 0.62, 0.22], [0.42, 0.45, 0.22], [0.6, 0.44, 0.2], [0.2, 0.68, 0.14], [0.8, 0.68, 0.14]];
    for (const pass of [0, 1]) for (const [x, y, r] of blobs) {
      const gr = g.createRadialGradient(x * s, (y - (pass ? 0.06 : 0)) * s, 0, x * s, y * s, r * s);
      if (pass === 0) { gr.addColorStop(0, 'rgba(214,206,232,1)'); gr.addColorStop(0.8, 'rgba(214,206,232,0.9)'); gr.addColorStop(1, 'rgba(214,206,232,0)'); }
      else { gr.addColorStop(0, 'rgba(255,250,242,1)'); gr.addColorStop(0.55, 'rgba(255,246,236,0.85)'); gr.addColorStop(1, 'rgba(255,246,236,0)'); }
      g.fillStyle = gr; g.beginPath(); g.arc(x * s, (y - (pass ? 0.05 : 0)) * s, r * s, 0, Math.PI * 2); g.fill();
    }
  });
}

export interface LifeHandle { update(dt: number, t: number, target: Vector3): void; setLevel(q: 'low' | 'med' | 'high'): void; dispose(): void }

export function createLife(scene: Scene, chimneys: Vector3[]): LifeHandle {
  const dot = dotTex(scene);
  const anchor = new Vector3(0, 0, 0);
  // ── pollen / dust motes in the light ──
  const pollen = new ParticleSystem('wfx_pollen', 220, scene);
  pollen.particleTexture = dot; pollen.emitter = anchor;
  pollen.minEmitBox = new Vector3(-22, 0.4, -22); pollen.maxEmitBox = new Vector3(22, 6, 22);
  pollen.color1 = new Color4(1, 0.93, 0.62, 0.9); pollen.color2 = new Color4(1, 0.82, 0.5, 0.7); pollen.colorDead = new Color4(1, 0.9, 0.6, 0);
  pollen.minSize = 0.05; pollen.maxSize = 0.12; pollen.minLifeTime = 5; pollen.maxLifeTime = 9; pollen.emitRate = 26;
  pollen.direction1 = new Vector3(-0.3, 0.05, -0.2); pollen.direction2 = new Vector3(0.4, 0.25, 0.3); pollen.minEmitPower = 0.1; pollen.maxEmitPower = 0.3;
  pollen.gravity = new Vector3(0.05, 0.02, 0.02); pollen.blendMode = ParticleSystem.BLENDMODE_ADD; pollen.updateSpeed = 0.016;
  pollen.start();
  // ── leaves drifting down in the grove ──
  const leaves = new ParticleSystem('wfx_leaves', 70, scene);
  leaves.particleTexture = leafTex(scene); leaves.emitter = new Vector3(31, 0, 3);
  leaves.minEmitBox = new Vector3(-13, 5.5, -14); leaves.maxEmitBox = new Vector3(13, 8, 14);
  leaves.color1 = new Color4(0.55, 0.8, 0.35, 1); leaves.color2 = new Color4(0.95, 0.78, 0.3, 1); leaves.colorDead = new Color4(0.8, 0.7, 0.3, 0);
  leaves.minSize = 0.14; leaves.maxSize = 0.24; leaves.minLifeTime = 6; leaves.maxLifeTime = 10; leaves.emitRate = 7;
  leaves.direction1 = new Vector3(-0.4, -0.2, -0.2); leaves.direction2 = new Vector3(0.6, -0.1, 0.4); leaves.minEmitPower = 0.3; leaves.maxEmitPower = 0.6;
  leaves.gravity = new Vector3(0.12, -0.35, 0.05); leaves.minAngularSpeed = -2.5; leaves.maxAngularSpeed = 2.5;
  leaves.blendMode = ParticleSystem.BLENDMODE_STANDARD; leaves.updateSpeed = 0.016;
  void GROVE_TREES;
  leaves.start();
  // ── chimney smoke ──
  const smoke = new ParticleSystem('wfx_smoke', 160, scene);
  smoke.particleTexture = dot; smoke.emitter = new Vector3(0, 0, 0);
  smoke.startPositionFunction = (_w, pos) => { const c = chimneys[Math.floor(Math.random() * chimneys.length)] ?? Vector3.Zero(); pos.set(c.x + (Math.random() - 0.5) * 0.2, c.y, c.z + (Math.random() - 0.5) * 0.2); };
  smoke.color1 = new Color4(0.97, 0.95, 0.94, 0.42); smoke.color2 = new Color4(0.9, 0.88, 0.92, 0.35); smoke.colorDead = new Color4(0.9, 0.9, 0.95, 0);
  smoke.addSizeGradient(0, 0.4); smoke.addSizeGradient(1, 2.6);
  smoke.minLifeTime = 4; smoke.maxLifeTime = 6.5; smoke.emitRate = chimneys.length * 2.2;
  smoke.direction1 = new Vector3(-0.1, 1, -0.1); smoke.direction2 = new Vector3(0.1, 1, 0.1); smoke.minEmitPower = 0.5; smoke.maxEmitPower = 0.8;
  smoke.gravity = new Vector3(0.28, 0.05, 0.14); smoke.minAngularSpeed = -0.4; smoke.maxAngularSpeed = 0.4;
  smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD; smoke.updateSpeed = 0.016;
  if (chimneys.length) smoke.start();

  // ── butterflies + birds (one SPS, two wing planes each) ──
  const sps = new SolidParticleSystem('wfx_critters', scene, { updatable: true, isPickable: false });
  const wing = MeshBuilder.CreatePlane('wfx_wing', { width: 1, height: 1 }, scene);
  wing.bakeTransformIntoVertices(Matrix.Translation(0.5, 0, 0));
  const NB = 10, NBIRD = 7;
  sps.addShape(wing, (NB + NBIRD) * 2); wing.dispose();
  const crit = sps.buildMesh(); crit.isPickable = false;
  const cm = new StandardMaterial('wfx_critmat', scene); cm.disableLighting = true; cm.emissiveColor = new Color3(1, 1, 1); cm.backFaceCulling = false;
  crit.material = cm; crit.hasVertexAlpha = false; crit.alwaysSelectAsActiveMesh = true;
  const bcol = [new Color4(1, 0.62, 0.25, 1), new Color4(1, 1, 0.95, 1), new Color4(0.45, 0.62, 1, 1), new Color4(1, 0.85, 0.3, 1)];
  type C = { home: Vector3; ph: number; sp: number; r: number; bird: boolean };
  const cs: C[] = [];
  for (let i = 0; i < NB; i++) { const a = Math.random() * 6.28, r = 16 + Math.random() * 45; cs.push({ home: new Vector3(Math.cos(a) * r, 0.9, Math.sin(a) * r), ph: Math.random() * 100, sp: 0.6 + Math.random() * 0.5, r: 2 + Math.random() * 3, bird: false }); }
  for (let i = 0; i < NBIRD; i++) cs.push({ home: new Vector3(-20 + i * 6, 34 + i * 2.5, 30 - i * 4), ph: i * 0.6, sp: 0.09 + i * 0.004, r: 55 + i * 5, bird: true });
  sps.initParticles = () => { for (let i = 0; i < sps.nbParticles; i++) { const c = cs[i >> 1]; const p = sps.particles[i]; p.color = c.bird ? new Color4(0.25, 0.22, 0.3, 1) : bcol[(i >> 1) % bcol.length].clone(); const s = c.bird ? 0.9 : 0.16; p.scaling.set(s, s * 0.8, 1); } };
  sps.initParticles(); sps.setParticles();
  let T = 0;
  sps.updateParticle = (p) => {
    const c = cs[p.idx >> 1], left = (p.idx & 1) === 0;
    const t = T * c.sp + c.ph;
    let x: number, y: number, z: number, yaw: number, flap: number;
    if (c.bird) { x = c.home.x + Math.cos(t) * c.r; z = c.home.z + Math.sin(t) * c.r; y = c.home.y + Math.sin(t * 3) * 1.5; yaw = -t; flap = Math.sin(T * 7 + c.ph * 5) * 0.45 + 0.2; }
    else { x = c.home.x + Math.sin(t * 1.3) * c.r + Math.sin(t * 3.1) * 0.6; z = c.home.z + Math.cos(t * 0.9) * c.r; y = c.home.y + Math.sin(t * 2.3) * 0.5 + 0.4; yaw = Math.atan2(Math.cos(t * 1.3), -Math.sin(t * 0.9)); flap = Math.sin(T * 22 + c.ph) * 1.1; }
    p.position.set(x, y, z);
    p.rotation.set(Math.PI / 2, yaw, left ? flap : Math.PI - flap);
    return p;
  };
  const all = [pollen, leaves, smoke];
  return {
    update(dt, t, target) { T = t; anchor.copyFrom(target); void dt; sps.setParticles(); },
    setLevel(q) {
      pollen.emitRate = q === 'low' ? 8 : q === 'med' ? 18 : 28;
      leaves.emitRate = q === 'low' ? 3 : 7;
      smoke.emitRate = chimneys.length * (q === 'low' ? 1 : 2.2);
      crit.setEnabled(true);
    },
    dispose() { for (const p of all) p.dispose(); sps.dispose(); },
  };
}

/** Soft billboard cloud bank around the island position; returns a handle to part it. */
export function createCloudBank(scene: Scene, center: Vector3, side: Vector3, radius: number) {
  const sps = new SolidParticleSystem('wfx_bank', scene, { updatable: true, isPickable: false });
  const plane = MeshBuilder.CreatePlane('wfx_bankp', { size: 1 }, scene);
  const N = 18; sps.addShape(plane, N); plane.dispose();
  const mesh = sps.buildMesh(); sps.billboard = true; mesh.isPickable = false;
  const m = new StandardMaterial('wfx_bankmat', scene); m.disableLighting = true; m.emissiveColor = new Color3(1, 1, 1);
  m.diffuseTexture = puffTex(scene); m.useAlphaFromDiffuseTexture = true; m.fogEnabled = false; m.backFaceCulling = false;
  m.emissiveTexture = m.diffuseTexture;
  mesh.material = m; mesh.hasVertexAlpha = true;
  const home: { off: Vector3; s: number; sd: number }[] = [];
  for (let i = 0; i < N; i++) { const sd = i % 2 ? 1 : -1; home.push({ off: new Vector3(sd * (10 + Math.random() * radius * 1.3), -radius * (0.15 + Math.random() * 0.9), (Math.random() - 0.5) * radius), s: radius * (1.1 + Math.random() * 0.9), sd }); }
  let part = 0, alpha = 1;
  sps.updateParticle = (p) => {
    const h = home[p.idx];
    p.position.copyFrom(center).addInPlace(side.scale(h.off.x + h.sd * part * 160)).addInPlace(new Vector3(0, h.off.y, 0)).addInPlace(side.cross(Vector3.Up()).scale(h.off.z));
    p.scaling.set(h.s, h.s * 0.6, 1);
    p.color = new Color4(1, 1, 1, alpha);
    return p;
  };
  if (scene.activeCamera) sps.setParticles();
  return { mesh: mesh as Mesh, set(pt: number, a: number) { part = pt; alpha = a; if (scene.activeCamera) sps.setParticles(); } };
}
