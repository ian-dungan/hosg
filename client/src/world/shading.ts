// Stylised shading for StandardMaterial: painted noise wash, warm rim light, drifting cloud
// shadows, wind sway (per-vertex 'wind' weight), camera-occlusion dither fade, lantern flicker.
import { MaterialPluginBase, type Material, type MaterialDefines, type Scene, type AbstractMesh, type SubMesh, type UniformBuffer, type AbstractEngine, Vector3 } from '@babylonjs/core';

/** Shared per-frame state, written by the world's update(). */
export const WFX = {
  time: 0,
  wind: 1,
  target: new Vector3(0, 0, 0),
  fadeRadius: 0,      // 0 = occlusion fade off
};

export interface WfxOpts { noise?: number; rim?: number; cloudShadow?: number; fade?: boolean; flicker?: boolean; wind?: boolean }

export class WorldFxPlugin extends MaterialPluginBase {
  constructor(material: Material, private o: WfxOpts) {
    super(material, 'WorldFx', 210, { WFX_WIND: false, WFX_FADE: false, WFX_NOISE: false, WFX_RIM: false, WFX_CLOUDSH: false, WFX_FLICKER: false });
    this.doNotSerialize = true;
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getClassName() { return 'WorldFxPlugin'; }
  isCompatible(lang: number) { return lang === 0; }
  prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh) {
    const m = mesh as AbstractMesh & { isVerticesDataPresent?: (k: string) => boolean };
    defines['WFX_WIND'] = !!this.o.wind && !!m.isVerticesDataPresent?.('wind');
    defines['WFX_FADE'] = !!this.o.fade;
    defines['WFX_NOISE'] = (this.o.noise ?? 0) > 0;
    defines['WFX_RIM'] = (this.o.rim ?? 0) > 0;
    defines['WFX_CLOUDSH'] = (this.o.cloudShadow ?? 0) > 0;
    defines['WFX_FLICKER'] = !!this.o.flicker;
  }
  getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh) {
    const m = mesh as AbstractMesh & { isVerticesDataPresent?: (k: string) => boolean };
    if (this.o.wind && m.isVerticesDataPresent?.('wind')) attributes.push('wind');
  }
  getUniforms() { return { externalUniforms: ['wfxTime', 'wfxTarget', 'wfxParams'] }; }
  hardBindForSubMesh(_ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh) {
    const e = subMesh.effect; if (!e) return;
    e.setFloat4('wfxTime', WFX.time, WFX.wind, 0, 0);
    e.setFloat4('wfxTarget', WFX.target.x, WFX.target.y, WFX.target.z, WFX.fadeRadius);
    e.setFloat4('wfxParams', this.o.noise ?? 0, this.o.rim ?? 0, this.o.cloudShadow ?? 0, 0);
  }
  getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
#ifdef WFX_WIND
attribute float wind;
uniform vec4 wfxTime;
#endif
`,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#ifdef WFX_WIND
{
  float wT = wfxTime.x; vec2 wp = worldPos.xz;
  float gust = 0.55 + 0.45 * sin(wT * 0.42 + wp.x * 0.025 + wp.y * 0.017);
  float s1 = sin(wT * 1.6 + wp.x * 0.31 + wp.y * 0.23);
  float s2 = sin(wT * 3.1 + wp.x * 0.83 - wp.y * 0.71);
  float sw = (s1 * 0.65 + s2 * 0.35) * wind * wfxTime.y * gust;
  worldPos.xz += vec2(0.85, 0.5) * sw;
  worldPos.y -= abs(sw) * 0.18;
}
#endif
`,
      };
    }
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
uniform vec4 wfxTime;
uniform vec4 wfxTarget;
uniform vec4 wfxParams;
float wfxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wfxNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wfxHash(i), wfxHash(i + vec2(1.0, 0.0)), f.x), mix(wfxHash(i + vec2(0.0, 1.0)), wfxHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float wfxBayer(vec2 p) { return fract(52.9829189 * fract(dot(floor(p), vec2(0.06711056, 0.00583715)))); }
`,
      CUSTOM_FRAGMENT_MAIN_BEGIN: `
#ifdef WFX_FADE
if (wfxTarget.w > 0.0) {
  vec3 wCam = vEyePosition.xyz; vec3 wD = wfxTarget.xyz - wCam; float wL2 = dot(wD, wD);
  if (wL2 < 1700.0) {
    float wt = dot(vPositionW - wCam, wD) / wL2;
    float wDist = length(vPositionW - (wCam + wD * wt));
    float wA = (1.0 - smoothstep(wfxTarget.w * 0.5, wfxTarget.w, wDist)) * (1.0 - smoothstep(0.8, 0.93, wt)) * step(0.0, wt)
             * smoothstep(wfxTarget.y + 0.6, wfxTarget.y + 2.0, vPositionW.y);
    // and whatever stands right in front of the lens (a pine beside the camera filling half the view)
    float wNear = 1.0 - smoothstep(5.0, 10.0, length(vPositionW - wCam));
    wA = max(wA, wNear * 0.85);
    if (wA * 0.9 > wfxBayer(gl_FragCoord.xy)) discard;
  }
}
#endif
`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
#ifdef WFX_NOISE
{
  vec3 nP = vPositionW;
  float n1 = wfxNoise(nP.xz * 1.7 + nP.y * 1.3);
  float n2 = wfxNoise(nP.xz * 0.21 - nP.y * 0.37 + 17.0);
  baseColor.rgb *= 1.0 + ((n1 - 0.5) * 0.6 + (n2 - 0.5)) * wfxParams.x;
}
#endif
`,
      CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef WFX_RIM
{
  float rNdV = clamp(dot(normalW, viewDirectionW), 0.0, 1.0);
  float rim = pow(1.0 - rNdV, 3.0);
  color.rgb += vec3(1.0, 0.8, 0.55) * rim * wfxParams.y * (0.35 + baseColor.rgb);
}
#endif
#ifdef WFX_CLOUDSH
{
  vec2 cP = vPositionW.xz * 0.0042 + vec2(wfxTime.x * 0.011, wfxTime.x * 0.005);
  float cN = wfxNoise(cP) * 0.65 + wfxNoise(cP * 2.3 + 5.0) * 0.35;
  color.rgb *= 1.0 - smoothstep(0.5, 0.72, cN) * wfxParams.z;
}
#endif
#ifdef WFX_FLICKER
{
  float fH = wfxHash(floor(vPositionW.xz * 0.6 + 0.5));
  float fl = 0.88 + 0.07 * sin(wfxTime.x * (6.0 + fH * 5.0) + fH * 40.0) + 0.05 * sin(wfxTime.x * (15.0 + fH * 9.0) + fH * 9.0);
  color.rgb *= fl;
}
#endif
`,
    };
  }
}
