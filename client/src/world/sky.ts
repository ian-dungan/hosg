import { ShaderMaterial, MeshBuilder, Vector3 as BV3, Vector4, Effect, type Scene as BScene, type Mesh as BMesh } from '@babylonjs/core';
// Sky dome, the sea of clouds and the distant vista (islands, waterfalls, wind-ships).
import { Builder, hex, mix, norm, type RGB, type V3 } from './mesh';
import { PAL } from './parts';
import { PALETTE } from '../core/contracts';

export const HAZE = '#f2d9c2';
export const SUN_DIR: V3 = norm([-0.62, 0.52, -0.58]); // toward the sun

export function buildSkyDome(b: Builder, radius: number) {
  const zen = hex(PALETTE.skyDeep), mid = hex(PALETTE.sky), hor = hex(PALETTE.horizon), horCool = hex('#cfe0f5'), below = hex('#fbe6d6');
  const col = (d: V3): RGB => {
    const sa = Math.max(0, (d[0] * SUN_DIR[0] + d[2] * SUN_DIR[2]) / (Math.hypot(d[0], d[2]) * Math.hypot(SUN_DIR[0], SUN_DIR[2]) + 1e-6));
    const h = d[1];
    const haze = hex(HAZE);
    const glowH = mix(haze, hex('#ffbf8a'), Math.pow(sa, 2) * 0.8);
    if (h < 0.02) return mix(haze, glowH, Math.max(0, h) / 0.02);
    const horizon = mix(glowH, mix(horCool, hor, 0.35), Math.min(1, (h - 0.02) / 0.12));
    let c = mix(horizon, mid, Math.min(1, Math.max(0, h - 0.06) / 0.3));
    c = mix(c, zen, Math.max(0, Math.min(1, (h - 0.2) / 0.55)));
    return c;
  };
  const NA = 40, NE = 16;
  const P = (i: number, j: number): V3 => {
    const a = i / NA * Math.PI * 2; const e = -0.35 + j / NE * (Math.PI / 2 + 0.35);
    return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
  };
  b.cj = 0;
  b.withHint([0, 0, 0], () => {
    for (let i = 0; i < NA; i++) for (let j = 0; j < NE; j++) {
      const p = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      const s = (v: V3): V3 => [v[0] * radius, v[1] * radius, v[2] * radius];
      // smooth per-vertex gradient
      b.triW(s(p[0]), s(p[1]), s(p[2]), col(p[0]), col(p[1]), col(p[2]), [0, 0, 0]);
      b.triW(s(p[0]), s(p[2]), s(p[3]), col(p[0]), col(p[2]), col(p[3]), [0, 0, 0]);
    }
  });
}

/** Soft fair-weather clouds high in the sky (kept out of the patch where Ellie points). */
export function buildSkyClouds(base: Builder, extra: Builder, avoidAngle: number) {
  for (const [b, n, seed] of [[base, 26, 1], [extra, 30, 2]] as [Builder, number, number][]) {
    let made = 0;
    for (let i = 0; i < 400 && made < n; i++) {
      const a = b.rng.r(0, 6.283);
      const da = Math.abs(Math.atan2(Math.sin(a - avoidAngle), Math.cos(a - avoidAngle)));
      if (da < 0.22) continue;
      const d = b.rng.r(380, 1700), y = b.rng.r(170, 430) * (0.6 + d / 2500);
      const c: V3 = [Math.cos(a) * d, y, Math.sin(a) * d];
      const sz = b.rng.r(28, 60) * (0.7 + d / 1800);
      const puffs = 3 + Math.floor(b.rng.next() * 4);
      for (let q = 0; q < puffs; q++) b.ball([c[0] + b.rng.r(-1.4, 1.4) * sz, c[1] + b.rng.r(0, 0.35) * sz, c[2] + b.rng.r(-0.6, 0.6) * sz], sz * b.rng.r(0.5, 0.9), PAL.cloud, 1, 0.55, 1, d > 800 ? 0 : 1, 0.25, hex('#efe3ee'));
      made++; void seed;
    }
  }
}

// ───────────────────────── shader sky (final look) ─────────────────────────

Effect.ShadersStore['sg2skyVertexShader'] = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }
`;
Effect.ShadersStore['sg2skyFragmentShader'] = `
precision highp float;
varying vec3 vDir;
uniform vec3 uSun; uniform vec3 uIsl; uniform vec4 uP; // x time, y reveal, z octaves, w storm
uniform vec3 uHaze;
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){if(float(i)>=uP.z)break;s+=a*n2(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s/(1.0-pow(0.5,uP.z));}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec2 hz = normalize(d.xz + 1e-5), sz = normalize(uSun.xz);
  float sa = max(dot(hz, sz), 0.);
  float sd = max(dot(d, uSun), 0.);
  vec3 zen = vec3(0.13,0.38,0.86), mid = vec3(0.36,0.64,0.96);
  vec3 horCool = vec3(0.80,0.86,0.96), horWarm = vec3(1.0,0.80,0.62);
  vec3 hor = mix(horCool, horWarm, pow(sa, 1.6));
  float hh = max(h, 0.);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.32, hh));
  c = mix(c, zen, smoothstep(0.25, 0.9, hh));
  c = mix(uHaze, c, smoothstep(-0.02, 0.06, h));
  c += vec3(1.0,0.62,0.32) * pow(sd, 5.) * 0.22 + vec3(1.,0.88,0.66) * pow(sd, 48.) * 0.45 + vec3(1.0) * smoothstep(0.9993, 0.9997, sd) * 0.6;
  // painted clouds on a curved layer
  if (h > -0.02) {
    vec2 q = d.xz / (max(h, 0.0) + 0.16);
    vec2 drift = vec2(uP.x * 0.006, uP.x * 0.0025);
    float n = fbm(q * 0.9 + drift + vec2(3., 1.));
    // bank of cloud where Ellie points, which parts on reveal
    float toI = max(dot(normalize(d), normalize(uIsl)), 0.);
    float bank = smoothstep(0.96, 0.995, toI);
    n += bank * (0.32 * (1. - uP.y)) - bank * 0.5 * uP.y;
    float m = smoothstep(0.6, 0.72, n) * smoothstep(-0.01, 0.1, h) * (1. - smoothstep(0.55, 0.85, h));
    float lit = smoothstep(0.5, 0.85, fbm(q * 0.9 + drift + vec2(3.06, 1.05) - uSun.xz * 0.12));
    vec3 base = mix(vec3(0.80,0.78,0.92), vec3(0.97,0.90,0.88), sa * 0.6);
    vec3 top = mix(vec3(1.0,0.98,0.95), vec3(1.0,0.90,0.74), pow(sa, 1.5));
    vec3 cc = mix(top, base, lit * 0.75);
    cc += vec3(1.0,0.75,0.45) * pow(sd, 6.) * (1. - m) * 0.4; // silver lining toward the sun
    c = mix(c, cc, m * 0.92);
    // glow where the island appears
    c += vec3(1.0,0.8,0.45) * pow(toI, 300.) * uP.y * 0.5;
  }
  c = mix(c, vec3(0.42,0.40,0.55) * (0.6 + 0.4 * c), uP.w * 0.6);
  gl_FragColor = vec4(c, 1.0);
}
`;

export interface SkyHandle { mesh: BMesh; mat: ShaderMaterial; setReveal(r: number): void; setOctaves(n: number): void; setStorm(s: number): void; update(t: number): void }
export function createShaderSky(scene: BScene, islandDir: BV3): SkyHandle {
  const mesh = MeshBuilder.CreateSphere('world_skydome', { diameter: 3600, segments: 20, sideOrientation: 1 }, scene);
  const mat = new ShaderMaterial('world_skymat', scene, { vertex: 'sg2sky', fragment: 'sg2sky' }, {
    attributes: ['position'], uniforms: ['worldViewProjection', 'uSun', 'uIsl', 'uP', 'uHaze'],
  });
  mat.backFaceCulling = false; mat.disableDepthWrite = true;
  const hz = hex(HAZE);
  mat.setVector3('uSun', new BV3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]));
  mat.setVector3('uIsl', islandDir.normalizeToNew());
  mat.setVector3('uHaze', new BV3(hz[0], hz[1], hz[2]));
  const P = { t: 0, r: 0, o: 5, s: 0 };
  const v4 = new Vector4(0, 0, 0, 0);
  const set4 = () => { v4.set(P.t, P.r, P.o, P.s); mat.setVector4('uP', v4); };
  mesh.material = mat; mesh.infiniteDistance = true; mesh.isPickable = false; mesh.applyFog = false;
  mesh.renderingGroupId = 0; mesh.alwaysSelectAsActiveMesh = true;
  set4();
  return {
    mesh, mat,
    setReveal(r) { P.r = r; set4(); },
    setOctaves(n) { P.o = n; set4(); },
    setStorm(s) { P.s = s; set4(); },
    update(t) { P.t = t; set4(); },
  };
}
