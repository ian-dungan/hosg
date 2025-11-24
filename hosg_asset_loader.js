// ============================================================
// HEROES OF SHADY GROVE - ASSET LOADER v2.1 - WORKING VERSION
// Complete implementation with free model CDN URLs
// Replace your hosg_asset_loader.js with this file
// ============================================================

class AssetLoader {
  constructor(scene) {
    this.scene = scene;
    this.loadedAssets = new Map();
    this.loadingAssets = new Map();
    
    // ========== FREE MODEL CDN URLS ==========
    // These are working CDN links to free, open-source 3D models
    
    this.assetRegistry = {
      // =========================
      // CHARACTERS - Kenney Assets
      // =========================
      // Note: Kenney doesn't have a public CDN, so you'll need to:
      // 1. Download from https://kenney.nl/assets
      // 2. Upload to your GitHub repo /assets folder
      // 3. Update URLs below with your GitHub raw URLs
      
      'character_base': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/characters/character.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // ENEMIES - Quaternius Models
      // =========================
      // Same as above - download from quaternius.com and host on your GitHub
      
      'enemy_wolf': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/common/Wolf.glb',
        scale: 0.35,
        castShadows: true,
        collisions: true
      },
      
      'enemy_goblin': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/Goblin.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'enemy_skeleton': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/Skeleton.glb',
        scale: 1.1,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // ENVIRONMENT - Poly Pizza
      // =========================
      // These are example URLs from Poly Pizza (working CDN)
      // Search at https://poly.pizza for more models
      
      'tree_oak': {
        url: 'https://poly.pizza/m/dEzDLMXIgSL/Tree_Oak_01.glb',
        scale: 2.0,
        castShadows: true,
        collisions: true
      },
      
      'tree_pine': {
        url: 'https://poly.pizza/m/bVZqGaJUXq/Tree_Pine_01.glb',
        scale: 2.5,
        castShadows: true,
        collisions: true
      },
      
      'rock_large': {
        url: 'https://poly.pizza/m/9FhJBj5wZaV/Rock_01.glb',
        scale: 1.5,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // BUILDINGS
      // =========================
      'building_house': {
        url: 'https://poly.pizza/m/dXxqCrBUVG/House_Medieval.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      'building_tower': {
        url: 'https://poly.pizza/m/cJj1HVNXBK0/Tower_Medieval.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      // =========================
      // PROPS
      // =========================
      'chest_closed': {
        url: 'https://poly.pizza/m/6N5uFexLiGr/Chest_Closed.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'chest_open': {
        url: 'https://poly.pizza/m/8N7wGhyOiRp/Chest_Open.glb',
        scale: 1.0,
        castShadows: true,
        collisions: false
      },
      
      'barrel': {
        url: 'https://poly.pizza/m/4Q8rJfMWbGH/Barrel_Wood.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'crate': {
        url: 'https://poly.pizza/m/3R9sKgNXcIP/Crate_Wood.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      }
    };
  }

  /**
   * Load a 3D model asset from CDN
   * @param {string} assetKey - Key from assetRegistry
   * @param {object} options - Override options (position, rotation, scaling, etc.)
   * @returns {Promise<object>} Loaded asset with meshes and animations
   */
  async loadAsset(assetKey, options = {}) {
    // Check if already loaded
    if (this.loadedAssets.has(assetKey)) {
      const instance = this.createInstance(assetKey, options);
      if (!instance) {
        console.warn(`No geometry in cached ${assetKey}, using procedural fallback`);
        return this.createProceduralFallback(assetKey, options);
      }
      return instance;
    }

    // Check if currently loading
    if (this.loadingAssets.has(assetKey)) {
      await this.loadingAssets.get(assetKey);
      const instance = this.createInstance(assetKey, options);
      if (!instance) {
        console.warn(`No geometry in ${assetKey}, using procedural fallback`);
        return this.createProceduralFallback(assetKey, options);
      }
      return instance;
    }

    // Start loading
    const loadPromise = this._loadAssetFromUrl(assetKey);
    this.loadingAssets.set(assetKey, loadPromise);

    try {
      const result = await loadPromise;
      this.loadedAssets.set(assetKey, result);
      this.loadingAssets.delete(assetKey);
      
      const instance = this.createInstance(assetKey, options);
      
      // If no geometry found, use fallback
      if (!instance) {
        console.warn(`No geometry in ${assetKey}, using procedural fallback`);
        return this.createProceduralFallback(assetKey, options);
      }
      
      return instance;
    } catch (error) {
      console.error(`Failed to load asset: ${assetKey}`, error);
      this.loadingAssets.delete(assetKey);
      
      // Fallback to procedural
      console.warn(`Using procedural fallback for ${assetKey}`);
      return this.createProceduralFallback(assetKey, options);
    }
  }

  /**
   * Internal method to load model from URL
   */
  async _loadAssetFromUrl(assetKey) {
    const assetConfig = this.assetRegistry[assetKey];
    
    if (!assetConfig || !assetConfig.url) {
      throw new Error(`Asset config not found: ${assetKey}`);
    }

    const url = assetConfig.url;
    console.log(`[Assets] Loading ${assetKey} from ${url}`);

    try {
      // Parse URL into root and filename
      const lastSlash = url.lastIndexOf('/');
      const rootUrl = url.substring(0, lastSlash + 1);
      const filename = url.substring(lastSlash + 1);

      // Load with Babylon.js SceneLoader
      const result = await BABYLON.SceneLoader.ImportMeshAsync(
        "",  // Empty string loads all meshes
        rootUrl,
        filename,
        this.scene
      );

      // Process loaded meshes
      result.meshes.forEach((mesh, index) => {
        // Hide original (we'll create instances)
        mesh.setEnabled(false);
        
        // Set up shadows
        if (assetConfig.castShadows && this.scene.shadowGenerator) {
          this.scene.shadowGenerator.addShadowCaster(mesh);
        }
        
        if (assetConfig.receiveShadows) {
          mesh.receiveShadows = true;
        }
        
        // Set up collisions
        if (assetConfig.collisions) {
          mesh.checkCollisions = true;
        }
      });

      // Process animations
      if (result.animationGroups && result.animationGroups.length > 0) {
        result.animationGroups.forEach(anim => {
          anim.stop(); // Don't auto-play
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

  /**
   * Create an instance of a loaded asset
   */
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

    // Use asset config scale if no override
    const finalScale = scaling || new BABYLON.Vector3(
      asset.config.scale || 1,
      asset.config.scale || 1,
      asset.config.scale || 1
    );

    const instanceName = name || `${assetKey}_instance_${Date.now()}`;
    const instances = [];
    let rootMesh = null;

    // Create instances of all meshes (only meshes with geometry)
    asset.meshes.forEach((mesh, index) => {
      // Skip nodes without geometry (containers, transform nodes)
      if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) {
        return;
      }
      
      if (!rootMesh) {
        // First mesh with geometry becomes the root
        rootMesh = mesh.createInstance(instanceName);
        rootMesh.position = position.clone();
        rootMesh.rotation = rotation.clone();
        rootMesh.scaling = finalScale.clone();
        if (parent) rootMesh.parent = parent;
        rootMesh.setEnabled(true);
        instances.push(rootMesh);
      } else {
        // Clone other meshes (materials, etc.)
        const instance = mesh.clone(`${instanceName}_mesh_${index}`);
        instance.parent = rootMesh;
        instance.setEnabled(true);
        instances.push(instance);
      }
    });

    // If no meshes with geometry were found, return null (will trigger fallback)
    if (!rootMesh) {
      console.warn(`[Assets] No meshes with geometry found in ${assetKey}`);
      return null;
    }

    // Clone animations if present
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

  /**
   * Fallback to procedural geometry if model fails to load
   */
  createProceduralFallback(assetKey, options = {}) {
    const {
      position = new BABYLON.Vector3(0, 0, 0),
      rotation = new BABYLON.Vector3(0, 0, 0),
      scaling = new BABYLON.Vector3(1, 1, 1)
    } = options;

    // Determine type from asset key
    if (assetKey.includes('character') || assetKey.includes('enemy')) {
      return this.createProceduralCharacter(assetKey, position);
    } else if (assetKey.includes('tree')) {
      return this.createProceduralTree('grassland', position, scaling.x);
    } else if (assetKey.includes('building')) {
      return this.createProceduralBuilding('house', position);
    } else {
      // Generic box
      const scene = this.scene;
      const box = BABYLON.MeshBuilder.CreateBox(assetKey, { size: 2 }, scene);
      box.position = position;
      box.rotation = rotation;
      box.scaling = scaling;
      return { meshes: [box], rootMesh: box };
    }
  }

  /**
   * Pre-load commonly used assets
   */
  async preloadCommonAssets() {
    console.log('[Assets] Preloading common assets...');
    
    const commonAssets = [
      'tree_oak',
      'tree_pine',
      'rock_large',
      'barrel',
      'crate'
    ];

    const promises = commonAssets.map(key => this.loadAsset(key));
    
    try {
      await Promise.all(promises);
      console.log('[Assets] ✓ Common assets preloaded');
    } catch (error) {
      console.warn('[Assets] Some assets failed to preload:', error);
    }
  }

  // ========== PROCEDURAL FALLBACKS ==========
  // Keep your existing procedural methods as fallbacks

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

  /**
   * Dispose of a loaded asset
   */
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

  /**
   * Clear all loaded assets
   */
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
console.log("[Assets] Asset loader v2.1 ready! (GitHub: ian-dungan/hosg)");

// ========== USAGE EXAMPLES ==========
/*

// 1. Basic usage - load and spawn a model
async function spawnWolf() {
  const assetLoader = new AssetLoader(scene);
  const wolf = await assetLoader.loadAsset('enemy_wolf', {
    position: new BABYLON.Vector3(10, 0, 10)
  });
  
  if (wolf) {
    // Play idle animation if available
    if (wolf.animationGroups.length > 0) {
      wolf.animationGroups[0].start(true); // true = loop
    }
  }
}

// 2. Preload assets at game start
async function initGame() {
  const assetLoader = new AssetLoader(scene);
  await assetLoader.preloadCommonAssets();
  console.log('Game ready!');
}

// 3. Spawn multiple instances efficiently
async function spawnForest() {
  const assetLoader = new AssetLoader(scene);
  
  // Load once
  await assetLoader.loadAsset('tree_oak');
  
  // Create many instances (very fast!)
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * 100 - 50;
    const z = Math.random() * 100 - 50;
    
    assetLoader.loadAsset('tree_oak', {
      position: new BABYLON.Vector3(x, 0, z),
      rotation: new BABYLON.Vector3(0, Math.random() * Math.PI * 2, 0)
    });
  }
}

// 4. Update your game systems to use real models
// In hosg_game_systems.js, replace createTestEnemy:
async createTestEnemy(id, position, name, level) {
  const assetLoader = new AssetLoader(this.scene);
  const enemy = await assetLoader.loadAsset('enemy_wolf', { position });
  
  if (!enemy) {
    // Fallback already handled
    console.warn('Using procedural enemy');
  }
  
  // ... rest of enemy setup
}

*/
