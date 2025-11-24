// ============================================================
// HEROES OF SHADY GROVE - ASSET LOADER v2.2 - POLY PIZZA CDN
// Complete implementation with working CDN URLs
// Replace your hosg_asset_loader.js with this file
// ============================================================

class AssetLoader {
  constructor(scene) {
    this.scene = scene;
    this.loadedAssets = new Map();
    this.loadingAssets = new Map();
    
    // ========== WORKING CDN URLS - NO DOWNLOAD NEEDED! ==========
    
    this.assetRegistry = {
      // =========================
      // ENEMIES - Quaternius Models (Poly Pizza)
      // =========================
      
      'enemy_wolf': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/common/Wolf.glb',
        scale: 0.003,
        castShadows: true,
        collisions: true
      },
      
      'enemy_goblin': {
        url: 'https://poly.pizza/files/6rWhpvPjxC6.glb',
        scale: 1.5,
        castShadows: true,
        collisions: true
      },
      
      'enemy_skeleton': {
        url: 'https://poly.pizza/files/6xDjXlI83R.glb',
        scale: 1.5,
        castShadows: true,
        collisions: true
      },
      
      'enemy_spider': {
        url: 'https://poly.pizza/files/aL0Z5rDqWr8.glb',
        scale: 1.5,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // ENVIRONMENT - Poly Pizza
      // =========================
      
      'tree_oak': {
        url: 'https://poly.pizza/files/dEzDLMXIgSL.glb',
        scale: 2.0,
        castShadows: true,
        collisions: true
      },
      
      'tree_pine': {
        url: 'https://poly.pizza/files/bVZqGaJUXq.glb',
        scale: 2.5,
        castShadows: true,
        collisions: true
      },
      
      'rock_large': {
        url: 'https://poly.pizza/files/9FhJBj5wZaV.glb',
        scale: 1.5,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // BUILDINGS
      // =========================
      'building_house': {
        url: 'https://poly.pizza/files/dXxqCrBUVG.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      'building_tower': {
        url: 'https://poly.pizza/files/cJj1HVNXBK0.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      // =========================
      // PROPS
      // =========================
      'chest_closed': {
        url: 'https://poly.pizza/files/6N5uFexLiGr.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'chest_open': {
        url: 'https://poly.pizza/files/8N7wGhyOiRp.glb',
        scale: 1.0,
        castShadows: true,
        collisions: false
      },
      
      'barrel': {
        url: 'https://poly.pizza/files/4Q8rJfMWbGH.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'crate': {
        url: 'https://poly.pizza/files/3R9sKgNXcIP.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      }
    };
  }

  async loadAsset(assetKey, options = {}) {
    if (this.loadedAssets.has(assetKey)) {
      const instance = this.createInstance(assetKey, options);
      if (!instance) {
        console.warn(`No geometry in cached ${assetKey}, using procedural fallback`);
        return this.createProceduralFallback(assetKey, options);
      }
      return instance;
    }

    if (this.loadingAssets.has(assetKey)) {
      await this.loadingAssets.get(assetKey);
      const instance = this.createInstance(assetKey, options);
      if (!instance) {
        console.warn(`No geometry in ${assetKey}, using procedural fallback`);
        return this.createProceduralFallback(assetKey, options);
      }
      return instance;
    }

    const loadPromise = this._loadAssetFromUrl(assetKey);
    this.loadingAssets.set(assetKey, loadPromise);

    try {
      const result = await loadPromise;
      this.loadedAssets.set(assetKey, result);
      this.loadingAssets.delete(assetKey);
      
      const instance = this.createInstance(assetKey, options);
      
      if (!instance) {
        console.warn(`No geometry in ${assetKey}, using procedural fallback`);
        return this.createProceduralFallback(assetKey, options);
      }
      
      return instance;
    } catch (error) {
      console.error(`Failed to load asset: ${assetKey}`, error);
      this.loadingAssets.delete(assetKey);
      
      console.warn(`Using procedural fallback for ${assetKey}`);
      return this.createProceduralFallback(assetKey, options);
    }
  }

  async _loadAssetFromUrl(assetKey) {
    const assetConfig = this.assetRegistry[assetKey];
    
    if (!assetConfig || !assetConfig.url) {
      throw new Error(`Asset config not found: ${assetKey}`);
    }

    const url = assetConfig.url;
    console.log(`[Assets] Loading ${assetKey} from ${url}`);

    try {
      const lastSlash = url.lastIndexOf('/');
      const rootUrl = url.substring(0, lastSlash + 1);
      const filename = url.substring(lastSlash + 1);

      const result = await BABYLON.SceneLoader.ImportMeshAsync(
        "",
        rootUrl,
        filename,
        this.scene
      );

      result.meshes.forEach((mesh) => {
  if (!mesh) return;

  // Is this an actual mesh with geometry?
  const hasGeometry =
    typeof mesh.getTotalVertices === "function" &&
    mesh.getTotalVertices() > 0;

  mesh.setEnabled(false);

  if (assetConfig.castShadows && this.scene.shadowGenerator && hasGeometry) {
    this.scene.shadowGenerator.addShadowCaster(mesh);
  }

  if (assetConfig.receiveShadows && hasGeometry) {
    mesh.receiveShadows = true;
  }

  if (assetConfig.collisions && hasGeometry) {
    mesh.checkCollisions = true;
  }
});

      if (result.animationGroups && result.animationGroups.length > 0) {
        result.animationGroups.forEach(anim => {
          anim.stop();
        });
      }

      console.log(`[Assets] ✓ Loaded ${assetKey} (${result.meshes.length} meshes, ${result.animationGroups?.length || 0} animations)`);

      return {
        meshes: result.meshes,
        animationGroups: result.animationGroups || [],
        skeletons: result.skeletons || [],
        config: assetConfig
      };

    } catch (error) {
      console.error(`[Assets] ✗ Failed to load ${assetKey}:`, error.message);
      throw error;
    }
  }

  createInstance(assetKey, options = {}) {
    const asset = this.loadedAssets.get(assetKey);
    if (!asset) return null;

    const {
      position = new BABYLON.Vector3(0, 0, 0),
      rotation = new BABYLON.Vector3(0, 0, 0),
      scaling = null,
      parent = null,
      name = null
    } = options;

    const finalScale = scaling || new BABYLON.Vector3(
      asset.config.scale || 1,
      asset.config.scale || 1,
      asset.config.scale || 1
    );

    const instanceName = name || `${assetKey}_instance_${Date.now()}`;
    const instances = [];
    let rootMesh = null;

    asset.meshes.forEach((mesh, index) => {
      if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) {
        return;
      }
      
      if (!rootMesh) {
        rootMesh = mesh.createInstance(instanceName);
        rootMesh.position = position.clone();
        rootMesh.rotation = rotation.clone();
        rootMesh.scaling = finalScale.clone();
        if (parent) rootMesh.parent = parent;
        rootMesh.setEnabled(true);
        instances.push(rootMesh);
      } else {
        const instance = mesh.clone(`${instanceName}_mesh_${index}`);
        instance.parent = rootMesh;
        instance.setEnabled(true);
        instances.push(instance);
      }
    });

    if (!rootMesh) {
      console.warn(`[Assets] No meshes with geometry found in ${assetKey}`);
      return null;
    }

    let animationGroups = [];
    if (asset.animationGroups && asset.animationGroups.length > 0) {
      animationGroups = asset.animationGroups.map(anim => {
        const clonedAnim = anim.clone(anim.name + "_" + instanceName);
        return clonedAnim;
      });
    }

    return {
      meshes: instances,
      rootMesh: rootMesh,
      animationGroups: animationGroups,
      assetKey: assetKey
    };
  }

  createProceduralFallback(assetKey, options = {}) {
    const {
      position = new BABYLON.Vector3(0, 0, 0),
      rotation = new BABYLON.Vector3(0, 0, 0),
      scaling = new BABYLON.Vector3(1, 1, 1)
    } = options;

    if (assetKey.includes('character') || assetKey.includes('enemy')) {
      return this.createProceduralCharacter(assetKey, position);
    } else if (assetKey.includes('tree')) {
      return this.createProceduralTree('grassland', position, scaling.x);
    } else if (assetKey.includes('building')) {
      return this.createProceduralBuilding('house', position);
    } else {
      const scene = this.scene;
      const box = BABYLON.MeshBuilder.CreateBox(assetKey, { size: 2 }, scene);
      box.position = position;
      box.rotation = rotation;
      box.scaling = scaling;
      return { meshes: [box], rootMesh: box };
    }
  }

  async preloadCommonAssets() {
    console.log('[Assets] Preloading common assets...');
    
    const commonAssets = [
      'enemy_wolf',
      'tree_oak',
      'tree_pine',
      'rock_large',
      'barrel'
    ];

    const promises = commonAssets.map(key => this.loadAsset(key));
    
    try {
      await Promise.all(promises);
      console.log('[Assets] ✓ Common assets preloaded');
    } catch (error) {
      console.warn('[Assets] Some assets failed to preload:', error);
    }
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
      character_base: new BABYLON.Color3(0.7, 0.7, 0.8),
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
    canopyMat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.2);
    canopy.material = canopyMat;

    if (scene.shadowGenerator) {
      scene.shadowGenerator.addShadowCaster(trunk);
      scene.shadowGenerator.addShadowCaster(canopy);
    }

    trunk.checkCollisions = true;
    return { meshes: [trunk, canopy], rootMesh: root };
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

    if (asset.animationGroups) {
      asset.animationGroups.forEach(anim => anim.dispose());
    }

    this.loadedAssets.delete(assetKey);
    console.log(`[Assets] Disposed ${assetKey}`);
  }

  clearAll() {
    for (const key of this.loadedAssets.keys()) {
      this.disposeAsset(key);
    }
    this.loadedAssets.clear();
    this.loadingAssets.clear();
    console.log('[Assets] Cleared all assets');
  }
}

window.AssetLoader = AssetLoader;
console.log("[Assets] Asset loader v2.2 ready with Poly Pizza CDN!");
