// The creator's live 3D preview: a small scene of its own (its own canvas and engine, made when the creator opens and
// disposed when it closes) with one look-driven adventurer on a plinth, warm key light and a cool fill so the toon
// shading reads as in the world. Drag turns it, pinch or the wheel zooms between the whole body and the face.
import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, MeshBuilder, Scene, StandardMaterial, Vector3,
} from '@babylonjs/core';
import type { Look } from '@sg2/shared';
import type { CreatorPreview } from '../hud/creator';
import { makeCharacter } from './character';

export function createCreatorPreview(): CreatorPreview {
  const el = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;outline:none;touch-action:none';
  el.appendChild(canvas);
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false, antialias: true }, true);
  engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio || 1));
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.16, 0.15, 0.3, 1);
  scene.ambientColor = new Color3(0.55, 0.52, 0.6);
  const hemi = new HemisphericLight('crHemi', new Vector3(0.2, 1, -0.3), scene);
  hemi.intensity = 0.62; hemi.diffuse = new Color3(1, 0.96, 0.9); hemi.groundColor = new Color3(0.38, 0.34, 0.5);
  const key = new DirectionalLight('crKey', new Vector3(-0.5, -0.8, 0.6), scene);
  key.intensity = 0.95; key.diffuse = new Color3(1, 0.9, 0.78);
  const plinth = MeshBuilder.CreateCylinder('crPlinth', { diameter: 1.5, height: 0.08, tessellation: 40 }, scene);
  plinth.position.y = -0.04;
  const pm = new StandardMaterial('crPlinthMat', scene);
  pm.diffuseColor = new Color3(0.42, 0.36, 0.55); pm.specularColor = Color3.Black(); pm.emissiveColor = new Color3(0.08, 0.07, 0.12);
  plinth.material = pm;

  // the preview always draws at full detail: one adventurer, seen up close
  let view = makeCharacter(scene, { kind: 'player', weapon: 'none', detail: 'high' });
  view.root.rotation.y = Math.PI; // facing the camera
  let height = view.height;
  const cam = new ArcRotateCamera('crCam', -Math.PI / 2, 1.38, 3.4, new Vector3(0, 0.95, 0), scene);
  cam.minZ = 0.05; cam.fov = 0.62; cam.lowerRadiusLimit = 0.6; cam.upperRadiusLimit = 5.5;
  let focus: 'body' | 'face' = 'body', zoomK = 1, walking = false;
  const frame = () => {
    const h = height;
    const face = focus === 'face';
    const r = (face ? 0.95 + h * 0.22 : 1.3 + h * 1.1) * zoomK;
    const ty = face ? h * 0.84 : h * 0.5;
    cam.radius += (r - cam.radius) * 0.18;
    cam.target.y += (ty - cam.target.y) * 0.18;
  };
  engine.runRenderLoop(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    height = view.height;
    frame();
    view.update(dt);
    scene.render();
  });
  const onResize = () => engine.resize();
  return {
    el,
    setLook(l: Look) { view.setAppearance(l, null); },
    setFocus(f) { focus = f; zoomK = 1; },
    setWalking(on) { if (on === walking) return; walking = on; view.setPose(on ? 'run' : 'idle'); },
    turn(d) { view.root.rotation.y += d; },
    zoom(f) { zoomK = Math.max(0.45, Math.min(1.8, zoomK * f)); },
    resize: onResize,
    dispose() {
      engine.stopRenderLoop();
      view.dispose();
      view = null as unknown as typeof view;
      scene.dispose();
      engine.dispose();
    },
  };
}
