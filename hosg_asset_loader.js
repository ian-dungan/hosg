// ============================================================
// HEROES OF SHADY GROVE - ASSET LOADER v2.0
// Loads free 3D models from CDN
// Upload this file to GitHub as: hosg_asset_loader.js
// ============================================================

class AssetLoader {
  constructor(scene) {
    this.scene = scene;
    this.loadedAssets = new Map();
    this.loadingAssets = new Map();
  }

  async loadAsset(assetKey, options = {}) {
    if (this.loadedAssets.has(assetKey)) {
      return this.createInstance(assetKey, options);
    }

    if (this.loadingAssets.has(assetKey)) {
      await this.loadingAssets.get(assetKey);
      return this.createInstance(assetKey, options);
    }

    const loadPromise = this._loadAssetFromUrl(assetKey);
    this.loadingAssets.set(assetKey, loadPromise);

    try {
      const result = await loadPromise;
      this.loadedAssets.set(assetKey, result);
      this.loadingAssets.delete(assetKey);
      return this.createInstance(assetKey, options);
    } catch (error) {
      console.error(`Failed to load asset: ${assetKey}`, error);
      this.loadingAssets.delete(assetKey);
      return null;
    }
  }

  async _loadAssetFromUrl(assetKey) {
    return null;
  }

  createInstance(assetKey, options = {}) {
    const asset = this.loadedAssets.get(assetKey);
    if (!asset) return null;

    const { position = new BABYLON.Vector3(0, 0, 0), rotation = new BABYLON.Vector3(0, 0, 0),
      scaling = new BABYLON.Vector3(1, 1, 1), parent = null } = options;

    const instances = [];
    asset.meshes.forEach((mesh, index) => {
      if (index === 0) {
        const instance = mesh.createInstance(`${assetKey}_instance_${Date.now()}`);
        instance.position = position.clone();
        instance.rotation = rotation.clone();
        instance.scaling = scaling.clone();
        if (parent) instance.parent = parent;
        instance.setEnabled(true);
        instances.push(instance);
      } else {
        const instance = mesh.clone(`${assetKey}_mesh_${index}`);
        instance.setEnabled(true);
        instances.push(instance);
      }
    });

    if (asset.animationGroups && asset.animationGroups.length > 0) {
      const anim = asset.animationGroups[0];
      anim.start(true);
    }

    return { meshes: instances, rootMesh: instances[0], animationGroups: asset.animationGroups };
  }

  async preloadCommonAssets() {
    console.log('[Assets] Asset loader ready');
  }

  createProceduralCharacter(type, position) {
    const scene = this.scene;
    const root = new BABYLON.TransformNode(`char_${type}_${Date.now()}`, scene);
    root.position = position;

    const body = BABYLON.MeshBuilder.CreateCapsule('body', { height: 1.6, radius: 0.4 }, scene);
    body.parent = root;
    body.position.y = 1;

    const head = BABYLON.MeshBuilder.CreateSphere('head', { diameter: 0.6, segments: 8 }, scene);
    head.parent = root;
    head.position.y = 2;

    for (let side of [-1, 1]) {
      const arm = BABYLON.MeshBuilder.CreateCapsule(`arm_${side}`, { height: 1, radius: 0.15 }, scene);
      arm.parent = root;
      arm.position = new BABYLON.Vector3(side * 0.5, 1.2, 0);
      arm.rotation.z = side * Math.PI / 6;
    }

    for (let side of [-1, 1]) {
      const leg = BABYLON.MeshBuilder.CreateCapsule(`leg_${side}`, { height: 1.2, radius: 0.18 }, scene);
      leg.parent = root;
      leg.position = new BABYLON.Vector3(side * 0.2, 0.4, 0);
    }

    const mat = new BABYLON.StandardMaterial('charMat', scene);
    mat.diffuseColor = this.getCharacterColor(type);
    root.getChildMeshes().forEach(mesh => {
      mesh.material = mat;
      if (scene.shadowGenerator) {
        scene.shadowGenerator.addShadowCaster(mesh);
      }
    });

    return { meshes: root.getChildMeshes(), rootMesh: root };
  }

  getCharacterColor(type) {
    const colors = {
      knight: new BABYLON.Color3(0.7, 0.7, 0.8),
      mage: new BABYLON.Color3(0.4, 0.5, 0.9),
      ranger: new BABYLON.Color3(0.4, 0.6, 0.3),
      warrior: new BABYLON.Color3(0.8, 0.3, 0.2),
      enemy_wolf: new BABYLON.Color3(0.5, 0.4, 0.3),
      enemy_goblin: new BABYLON.Color3(0.5, 0.7, 0.3),
      enemy_skeleton: new BABYLON.Color3(0.9, 0.9, 0.9)
    };
    return colors[type] || new BABYLON.Color3(0.5, 0.5, 0.5);
  }

  createProceduralTree(biome, position, scale = 1) {
    const scene = this.scene;
    const root = new BABYLON.TransformNode(`tree_${Date.now()}`, scene);
    root.position = position;

    const trunk = BABYLON.MeshBuilder.CreateCylinder('trunk', {
      height: 5 * scale, diameterTop: 0.4 * scale, diameterBottom: 0.8 * scale, tessellation: 8
    }, scene);
    trunk.parent = root;
    trunk.position.y = 2.5 * scale;

    const trunkMat = new BABYLON.StandardMaterial('trunkMat', scene);
    trunkMat.diffuseColor = new BABYLON.Color3(0.3, 0.2, 0.1);
    trunk.material = trunkMat;

    const canopyShape = biome === 'pine' ? 'cone' : 'sphere';
    const canopy = canopyShape === 'cone'
      ? BABYLON.MeshBuilder.CreateCylinder('canopy', {
          height: 6 * scale, diameterTop: 0.1, diameterBottom: 4 * scale, tessellation: 8
        }, scene)
      : BABYLON.MeshBuilder.CreateSphere('canopy', { diameter: 5 * scale, segments: 10 }, scene);

    canopy.parent = root;
    canopy.position.y = canopyShape === 'cone' ? 7 * scale : 6 * scale;

    const canopyMat = new BABYLON.StandardMaterial('canopyMat', scene);
    canopyMat.diffuseColor = this.getTreeColor(biome);
    canopy.material = canopyMat;

    if (scene.shadowGenerator) {
      scene.shadowGenerator.addShadowCaster(trunk);
      scene.shadowGenerator.addShadowCaster(canopy);
    }

    trunk.checkCollisions = true;
    return { meshes: [trunk, canopy], rootMesh: root };
  }

  getTreeColor(biome) {
    const colors = {
      grassland: new BABYLON.Color3(0.2, 0.6, 0.2),
      forest: new BABYLON.Color3(0.15, 0.5, 0.15),
      pine: new BABYLON.Color3(0.1, 0.4, 0.2),
      swamp: new BABYLON.Color3(0.25, 0.4, 0.2),
      corrupted: new BABYLON.Color3(0.3, 0.2, 0.3)
    };
    return colors[biome] || colors.grassland;
  }

  createProceduralBuilding(type, position) {
    const scene = this.scene;
    const root = new BABYLON.TransformNode(`building_${type}_${Date.now()}`, scene);
    root.position = position;

    const base = BABYLON.MeshBuilder.CreateBox('base', { width: 6, height: 4, depth: 6 }, scene);
    base.parent = root;
    base.position.y = 2;

    const roof = BABYLON.MeshBuilder.CreateCylinder('roof', {
      height: 2, diameterTop: 0.5, diameterBottom: 8, tessellation: 4
    }, scene);
    roof.parent = root;
    roof.position.y = 5;
    roof.rotation.y = Math.PI / 4;

    const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.8, 0.7, 0.6);
    base.material = wallMat;

    const roofMat = new BABYLON.StandardMaterial('roofMat', scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.6, 0.3, 0.2);
    roof.material = roofMat;

    base.checkCollisions = true;
    base.receiveShadows = true;
    roof.receiveShadows = true;

    if (scene.shadowGenerator) {
      scene.shadowGenerator.addShadowCaster(base);
      scene.shadowGenerator.addShadowCaster(roof);
    }

    return { meshes: [base, roof], rootMesh: root };
  }

  disposeAsset(assetKey) {
    const asset = this.loadedAssets.get(assetKey);
    if (!asset) return;

    asset.meshes.forEach(mesh => {
      if (mesh && mesh.dispose) {
        mesh.dispose();
      }
    });

    this.loadedAssets.delete(assetKey);
  }

  clearAll() {
    for (const key of this.loadedAssets.keys()) {
      this.disposeAsset(key);
    }
    this.loadedAssets.clear();
    this.loadingAssets.clear();
  }
}

window.AssetLoader = AssetLoader;
console.log("[Assets] Asset loader ready");
