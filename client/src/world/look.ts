// The look every zone shares: colour grading, cascaded shadows, the glow layer and the post pipeline per
// quality tier (the town's settings; each world passes its own shadow reach and glowing meshes).
// Nothing is built until a camera is attached: setQuality before that only records the tier, so loading a
// zone builds its shadows and post once, not once per call.
import {
  Color4, CascadedShadowGenerator, DefaultRenderingPipeline, GlowLayer, ImageProcessingConfiguration, SSAO2RenderingPipeline,
  type AbstractMesh, type ArcRotateCamera, type Color4 as Color4T, type DirectionalLight, type Mesh, type Scene,
} from '@babylonjs/core';
import type { Quality } from '../core/contracts';

export interface LookOpts {
  /** Prefix for the names of what it builds ('world', 'gw'). */
  prefix: string;
  sun: DirectionalLight;
  /** Shadow casters and receivers (lists the world keeps adding to). */
  casters: AbstractMesh[];
  receivers: Mesh[];
  /** Shadow reach (m) and cascades per tier with shadows. */
  shadow: Record<'med' | 'high', { maxZ: number; cascades: number; size: number }>;
  /** Meshes the glow layer draws, and the glow colour for one of them. */
  glowMeshes: () => Mesh[];
  glowColor?: (mesh: AbstractMesh, result: Color4T) => void;
}

export interface Look {
  readonly quality: Quality;
  setQuality(q: Quality): void;
  attachCamera(c: ArcRotateCamera): void;
  /** Adds a caster to the live shadow map too. */
  addCaster(m: AbstractMesh): void;
  /** Drops disposed casters (call every frame; cheap). */
  update(): void;
}

/** The town's colour grading (used on every tier; the post pipeline repeats it on med and high). */
export function grade(c: ImageProcessingConfiguration): void {
  c.toneMappingEnabled = true; c.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
  c.exposure = 1.08; c.contrast = 1.12;
  c.colorCurvesEnabled = true;
  const cc = c.colorCurves!; cc.globalSaturation = 4; cc.shadowsHue = 235; cc.shadowsDensity = 22; cc.shadowsSaturation = 20; cc.highlightsHue = 40; cc.highlightsDensity = 18; cc.highlightsSaturation = 15;
  c.vignetteEnabled = true; c.vignetteWeight = 1.25; c.vignetteStretch = 0.5; c.vignetteColor = new Color4(0.16, 0.1, 0.22, 0);
}

export function createLook(scene: Scene, o: LookOpts): Look {
  let quality: Quality = 'med';
  let cam: ArcRotateCamera | null = null;
  let shadow: CascadedShadowGenerator | null = null;
  let glow: GlowLayer | null = null;
  let pipe: DefaultRenderingPipeline | null = null;
  let ssao: SSAO2RenderingPipeline | null = null;
  const ip = scene.imageProcessingConfiguration;
  grade(ip); ip.isEnabled = true;

  const applyShadows = () => {
    shadow?.dispose(); shadow = null;
    for (const m of o.receivers) m.receiveShadows = quality !== 'low';
    if (quality === 'low' || !cam) return;
    const t = o.shadow[quality];
    const csm = new CascadedShadowGenerator(t.size, o.sun);
    csm.camera = cam;
    csm.numCascades = t.cascades;
    csm.lambda = 0.82; csm.shadowMaxZ = t.maxZ; csm.stabilizeCascades = true; csm.cascadeBlendPercentage = 0.12;
    csm.usePercentageCloserFiltering = true; csm.filteringQuality = quality === 'high' ? CascadedShadowGenerator.QUALITY_HIGH : CascadedShadowGenerator.QUALITY_MEDIUM;
    csm.bias = 0.004; csm.normalBias = 0.025; csm.darkness = 0.38;
    csm.depthClamp = true; csm.autoCalcDepthBounds = false;
    for (const c of o.casters) if (!c.isDisposed()) csm.addShadowCaster(c, false);
    shadow = csm;
  };
  const applyPost = () => {
    pipe?.dispose(); pipe = null; ssao?.dispose(); ssao = null;
    glow?.dispose(); glow = null;
    grade(ip); ip.isEnabled = true;
    if (!cam) return;
    if (quality !== 'low') {
      glow = new GlowLayer(`${o.prefix}_glowlayer`, scene, { mainTextureRatio: quality === 'high' ? 0.5 : 0.25, blurKernelSize: quality === 'high' ? 32 : 16 });
      glow.intensity = 0.5;
      for (const m of o.glowMeshes()) glow.addIncludedOnlyMesh(m);
      glow.customEmissiveColorSelector = (mesh, _s, _m, result) => { if (o.glowColor) o.glowColor(mesh, result); else result.set(1, 0.72, 0.36, 1); };
    }
    if (quality === 'low') return;
    pipe = new DefaultRenderingPipeline(`${o.prefix}_post`, quality === 'high', scene, [cam]);
    pipe.imageProcessingEnabled = true;
    if (quality === 'high') {
      pipe.samples = 4; pipe.fxaaEnabled = false;
      pipe.bloomEnabled = true; pipe.bloomThreshold = 0.86; pipe.bloomWeight = 0.22; pipe.bloomKernel = 48; pipe.bloomScale = 0.5;
      pipe.sharpenEnabled = true; pipe.sharpen.edgeAmount = 0.12; pipe.sharpen.colorAmount = 1;
      try {
        ssao = new SSAO2RenderingPipeline(`${o.prefix}_ssao`, scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [cam]);
        ssao.radius = 1.2; ssao.totalStrength = 0.9; ssao.base = 0.2; ssao.samples = 12; ssao.maxZ = 140; ssao.minZAspect = 0.4; ssao.expensiveBlur = true;
      } catch (e) { console.warn('SSAO unavailable', e); ssao = null; }
    } else { pipe.fxaaEnabled = true; }
  };

  return {
    get quality() { return quality; },
    setQuality(q) {
      const changed = q !== quality;
      quality = q;
      for (const m of o.receivers) m.receiveShadows = q !== 'low';
      if (cam && changed) { applyShadows(); applyPost(); }
    },
    attachCamera(c) { cam = c; applyShadows(); applyPost(); },
    addCaster(m) { shadow?.addShadowCaster(m, false); },
    update() {
      for (let i = o.casters.length - 1; i >= 0; i--) {
        const c = o.casters[i];
        if (c.isDisposed()) { o.casters.splice(i, 1); shadow?.removeShadowCaster(c, false); }
      }
    },
  };
}
