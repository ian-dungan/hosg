// The Beacon reveal effects: a soft energy beam from the lens, a god-ray shaft over the island,
// and glints that sparkle as it emerges.
import { Effect, ShaderMaterial, MeshBuilder, Matrix, Quaternion, Vector3, Vector4, ParticleSystem, Color4, type Scene, type Mesh, type Texture } from '@babylonjs/core';

Effect.ShadersStore['sg2beamVertexShader'] = `
precision highp float;
attribute vec3 position; attribute vec3 normal; attribute vec2 uv;
uniform mat4 world; uniform mat4 viewProjection;
varying vec3 vN; varying vec3 vW; varying vec2 vUV;
void main(){ vec4 w = world * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(world) * normal); vUV = uv; gl_Position = viewProjection * w; }
`;
Effect.ShadersStore['sg2beamFragmentShader'] = `
precision highp float;
varying vec3 vN; varying vec3 vW; varying vec2 vUV;
uniform vec3 uCam; uniform vec4 uP; // x time, y alpha, z grow (0..1 along length), w mode (0 beam, 1 shaft)
uniform vec3 uCol;
void main(){
  vec3 V = normalize(uCam - vW);
  float edge = pow(abs(dot(normalize(vN), V)), uP.w > 0.5 ? 1.2 : 2.2);
  float along = vUV.y;
  if (along > uP.z) discard;
  float flow = 0.75 + 0.25 * sin(along * 60.0 - uP.x * 9.0) * (1.0 - uP.w);
  float ends = smoothstep(0.0, 0.03, along) * (1.0 - smoothstep(uP.z - 0.04, uP.z, along));
  if (uP.w > 0.5) ends = smoothstep(0.0, 0.25, along) * (1.0 - smoothstep(0.55, 1.0, along));
  float a = edge * flow * ends * uP.y;
  gl_FragColor = vec4(uCol * a, a);
}
`;

function makeCone(scene: Scene, name: string, from: Vector3, to: Vector3, d0: number, d1: number, mode: number, col: Vector3) {
  const len = Vector3.Distance(from, to);
  const m = MeshBuilder.CreateCylinder(name, { height: len, diameterBottom: d0, diameterTop: d1, tessellation: 20, cap: 0 }, scene);
  m.bakeTransformIntoVertices(Matrix.Translation(0, len / 2, 0));
  m.position.copyFrom(from);
  const d = to.subtract(from).normalize(); const axis = Vector3.Cross(Vector3.Up(), d);
  m.rotationQuaternion = axis.length() < 1e-4 ? Quaternion.Identity() : Quaternion.RotationAxis(axis.normalize(), Math.acos(Vector3.Dot(Vector3.Up(), d)));
  const mat = new ShaderMaterial(name + 'mat', scene, { vertex: 'sg2beam', fragment: 'sg2beam' }, {
    attributes: ['position', 'normal', 'uv'], uniforms: ['world', 'viewProjection', 'uCam', 'uP', 'uCol'], needAlphaBlending: true,
  });
  mat.backFaceCulling = false; mat.alphaMode = 1; /* ALPHA_ADD */ mat.disableDepthWrite = true;
  mat.setVector3('uCol', col);
  m.material = mat; m.isPickable = false; m.setEnabled(false);
  const p = new Vector4(0, 0, 0, mode);
  return { mesh: m as Mesh, set(t: number, alpha: number, grow: number, cam: Vector3) { p.set(t, alpha, grow, mode); mat.setVector4('uP', p); mat.setVector3('uCam', cam); m.setEnabled(alpha > 0.001); } };
}

export function createReveal(scene: Scene, lens: Vector3, island: Vector3, sunDir: Vector3, dot: Texture) {
  const beamEnd = island.add(new Vector3(0, -20, 0));
  const beam = makeCone(scene, 'world_beam', lens, beamEnd, 0.35, 16, 0, new Vector3(1.0, 0.82, 0.45));
  const core = makeCone(scene, 'world_beamcore', lens, beamEnd, 0.12, 5, 0, new Vector3(1.0, 0.95, 0.8));
  const shaftTop = island.add(sunDir.normalizeToNew().scale(520));
  const shaft = makeCone(scene, 'world_shaft', island.add(new Vector3(0, -60, 0)), shaftTop, 150, 240, 1, new Vector3(1.0, 0.86, 0.6));
  const glints = new ParticleSystem('world_glints', 120, scene);
  glints.particleTexture = dot; glints.emitter = island.clone();
  glints.minEmitBox = new Vector3(-70, -40, -70); glints.maxEmitBox = new Vector3(70, 40, 70);
  glints.color1 = new Color4(1, 0.95, 0.7, 1); glints.color2 = new Color4(1, 0.8, 0.45, 1); glints.colorDead = new Color4(1, 0.8, 0.4, 0);
  glints.minSize = 1.5; glints.maxSize = 4; glints.minLifeTime = 0.6; glints.maxLifeTime = 1.6; glints.emitRate = 0;
  glints.blendMode = ParticleSystem.BLENDMODE_ADD; glints.minEmitPower = 0; glints.maxEmitPower = 2;
  glints.start();
  return {
    beamMeshes: [beam.mesh, core.mesh],
    /** t = 0..1 progress of the 8 s rise; after = seconds since it finished (for the lingering shaft). */
    update(time: number, t: number | null, after: number, cam: Vector3) {
      if (t !== null) {
        const grow = Math.min(1, t * 4);
        const a = Math.min(1, t * 6) * (t < 0.82 ? 1 : 1 - (t - 0.82) / 0.18);
        beam.set(time, a * 0.85, grow, cam); core.set(time, a, grow, cam);
        const sh = Math.max(0, Math.min(1, (t - 0.35) / 0.4));
        shaft.set(time, sh * 0.32, 1, cam);
        glints.emitRate = t > 0.3 ? 60 : 0;
      } else {
        beam.set(time, 0, 1, cam); core.set(time, 0, 1, cam);
        const fade = after < 0 ? 0 : Math.max(0.12, 0.32 - after * 0.03);
        shaft.set(time, after < 0 ? 0 : fade, 1, cam);
        glints.emitRate = after >= 0 && after < 4 ? 20 : after >= 0 ? 3 : 0;
      }
    },
  };
}
