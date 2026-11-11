// Animated stylised river: flow streaks, shore foam from depth, sky fresnel, sun glints, fog.
import { Effect, Mesh, ShaderMaterial, VertexData, Vector3, Vector4, Color3, type Scene } from '@babylonjs/core';
import { riverX, groundHeight, WATER_Y } from './layout';

Effect.ShadersStore['sg2waterVertexShader'] = `
precision highp float;
attribute vec3 position; attribute vec2 uv; attribute float depth;
uniform mat4 world; uniform mat4 viewProjection;
varying vec2 vUV; varying float vDepth; varying vec3 vW;
void main() { vec4 w = world * vec4(position, 1.0); vW = w.xyz; vUV = uv; vDepth = depth; gl_Position = viewProjection * w; }
`;
Effect.ShadersStore['sg2waterFragmentShader'] = `
precision highp float;
varying vec2 vUV; varying float vDepth; varying vec3 vW;
uniform vec4 uP; // x time, y fogStart, z fogEnd, w storm
uniform vec3 uCam; uniform vec3 uFog; uniform vec3 uSun;
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
void main(){
  float t = uP.x;
  vec3 V = normalize(uCam - vW);
  float d = clamp(vDepth, 0.0, 3.0);
  vec2 fl = vec2(vUV.x * 7.0, vUV.y * 0.32 - t * 0.55);
  float a = n2(fl), b = n2(vec2(vUV.x * 16.0, vUV.y * 0.9 - t * 1.25) + 7.0);
  vec3 deep = vec3(0.16, 0.47, 0.60), shallow = vec3(0.42, 0.78, 0.76);
  vec3 c = mix(deep, shallow, 1.0 - smoothstep(0.1, 1.5, d));
  c += vec3(0.12, 0.16, 0.16) * smoothstep(0.6, 0.85, b) ;
  c *= 0.93 + a * 0.14;
  // sky reflection (fresnel)
  float fr = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
  vec3 sky = mix(vec3(0.78, 0.86, 0.97), vec3(1.0, 0.86, 0.70), 0.35);
  c = mix(c, sky, fr * 0.65);
  // sun glints
  vec3 H = normalize(V + normalize(uSun));
  float g = pow(n2(vW.xz * 2.2 + vec2(t * 0.6, -t * 1.1)), 9.0) * pow(max(H.y, 0.0), 40.0);
  c += vec3(1.0, 0.92, 0.75) * g * 6.0;
  // shore foam
  float edge = d + (a - 0.5) * 0.35;
  float foam = 1.0 - smoothstep(0.08, 0.32, edge);
  foam = max(foam, smoothstep(0.82, 0.92, b) * (1.0 - smoothstep(0.3, 0.8, d)));
  c = mix(c, vec3(0.97, 0.98, 1.0), foam * 0.85);
  c = mix(c, c * vec3(0.55, 0.55, 0.7), uP.w * 0.5);
  float dist = length(uCam - vW);
  float f = clamp((dist - uP.y) / (uP.z - uP.y), 0.0, 1.0);
  gl_FragColor = vec4(mix(c, uFog, f), 1.0);
}
`;

export interface WaterHandle { mesh: Mesh; update(t: number, cam: Vector3, storm: number): void }
export function createRiver(scene: Scene, fogStart: number, fogEnd: number, fog: Color3, sun: Vector3): WaterHandle {
  const pos: number[] = [], uv: number[] = [], dep: number[] = [], idx: number[] = [];
  const COLS = 10, W = 13;
  let z = -2000; let row = 0; const zs: number[] = [];
  while (z <= 2000) { zs.push(z); z += Math.abs(z) < 220 ? 2.5 : 25; }
  let along = 0;
  for (let i = 0; i < zs.length; i++) {
    const zz = zs[i]; if (i > 0) along += Math.hypot(zs[i] - zs[i - 1], riverX(zs[i]) - riverX(zs[i - 1]));
    const cx = riverX(zz);
    for (let c = 0; c <= COLS; c++) {
      const u = c / COLS; const x = cx - W + u * 2 * W;
      pos.push(x, WATER_Y, zz); uv.push(u, along); dep.push(WATER_Y - groundHeight(x, zz));
    }
    if (i > 0) for (let c = 0; c < COLS; c++) {
      const a = (row - 1) * (COLS + 1) + c, b = a + 1, d = row * (COLS + 1) + c, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    row++;
  }
  const mesh = new Mesh('world_river', scene);
  const vd = new VertexData(); vd.positions = pos; vd.uvs = uv; vd.indices = idx; vd.applyToMesh(mesh);
  mesh.setVerticesData('depth', new Float32Array(dep), false, 1);
  const mat = new ShaderMaterial('world_rivermat', scene, { vertex: 'sg2water', fragment: 'sg2water' }, {
    attributes: ['position', 'uv', 'depth'], uniforms: ['world', 'viewProjection', 'uP', 'uCam', 'uFog', 'uSun'],
  });
  mat.backFaceCulling = false;
  mat.setVector3('uFog', new Vector3(fog.r, fog.g, fog.b));
  mat.setVector3('uSun', sun);
  mesh.material = mat; mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  const p4 = new Vector4(0, fogStart, fogEnd, 0);
  return {
    mesh,
    update(t, cam, storm) { p4.x = t; p4.w = storm; mat.setVector4('uP', p4); mat.setVector3('uCam', cam); },
  };
}
