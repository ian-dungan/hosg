// ============================================================
// HEROES OF SHADY GROVE - ASSET LOADER v2.1 - PATCHED
// Upload this file to GitHub as: hosg_asset_loader.js
// ============================================================

class AssetLoader {
  constructor(scene) {
    this.scene = scene;
    this.loadedAssets = new Map();
    this.loadingAssets = new Map();
    
    // ========== YOUR GITHUB CDN URLS ==========
    // All URLs point to: https://raw.githubusercontent.com/ian-dungan/hosg/main/
    
    this.assetRegistry = {
      // =========================
      // CHARACTERS
      // =========================
      'character_male': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/characters/player/Male_Warrior.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'character_female': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/characters/player/Female_Warrior.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'character_mage': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/characters/player/Male_Mage.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // NPCs
      // =========================
      'npc_merchant': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/characters/npc/Merchant.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'npc_guard': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/characters/npc/Guard.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // ENEMIES - Common
      // =========================
      'enemy_wolf': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/common/Wolf.glb',
        scale: 0.05,
        castShadows: true,
        collisions: true
      },
      
      'enemy_goblin': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/common/Goblin.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'enemy_skeleton': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/common/Skeleton.glb',
        scale: 1.1,
        castShadows: true,
        collisions: true
      },
      
      'enemy_spider': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/common/Spider.glb',
        scale: 1.5,
        castShadows: true,
        collisions: true
      },
      
      'enemy_orc': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/common/Orc.glb',
        scale: 1.3,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // ENEMIES - Bosses
      // =========================
      'enemy_dragon': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/bosses/Dragon.glb',
        scale: 2.0,
        castShadows: true,
        collisions: true
      },
      
      'enemy_demon': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/enemies/bosses/Demon.glb',
        scale: 1.8,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // ENVIRONMENT - Trees
      // =========================
      'tree_oak': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/environment/trees/Oak_01.glb',
        scale: 2.0,
        castShadows: true,
        collisions: true
      },
      
      'tree_oak_02': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/environment/trees/Oak_02.glb',
        scale: 2.2,
        castShadows: true,
        collisions: true
      },
      
      'tree_pine': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/environment/trees/Pine_01.glb',
        scale: 2.5,
        castShadows: true,
        collisions: true
      },
      
      'tree_willow': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/environment/trees/Willow_01.glb',
        scale: 2.0,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // ENVIRONMENT - Rocks
      // =========================
      'rock_small': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/environment/rocks/Rock_Small.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'rock_medium': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/environment/rocks/Rock_Medium.glb',
        scale: 1.5,
        castShadows: true,
        collisions: true
      },
      
      'rock_large': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/environment/rocks/Rock_Large.glb',
        scale: 2.0,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // ENVIRONMENT - Plants
      // =========================
      'grass_clump': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/environment/plants/Grass_Clump.glb',
        scale: 1.0,
        castShadows: false,
        collisions: false
      },
      
      'bush': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/environment/plants/Bush_01.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'flower_patch': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/environment/plants/Flower_Patch.glb',
        scale: 1.0,
        castShadows: false,
        collisions: false
      },
      
      // =========================
      // BUILDINGS - Houses
      // =========================
      'building_house_small': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/buildings/houses/House_Small.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      'building_house_medium': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/buildings/houses/House_Medium.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      'building_house_large': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/buildings/houses/House_Large.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      // =========================
      // BUILDINGS - Shops
      // =========================
      'building_blacksmith': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/buildings/shops/Blacksmith.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      'building_inn': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/buildings/shops/Inn.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      'building_market_stall': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/buildings/shops/Market_Stall.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      // =========================
      // BUILDINGS - Structures
      // =========================
      'building_tower': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/buildings/structures/Tower.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      'building_castle_wall': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/buildings/structures/Castle_Wall.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      'building_bridge': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/buildings/structures/Bridge.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true,
        receiveShadows: true
      },
      
      // =========================
      // PROPS - Containers
      // =========================
      'chest_closed': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/props/containers/Chest_Closed.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'chest_open': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/props/containers/Chest_Open.glb',
        scale: 1.0,
        castShadows: true,
        collisions: false
      },
      
      'barrel': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/props/containers/Barrel.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'crate': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/props/containers/Crate.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // PROPS - Decorative
      // =========================
      'campfire': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/props/decorative/Campfire.glb',
        scale: 1.0,
        castShadows: false,
        collisions: false
      },
      
      'torch': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/props/decorative/Torch.glb',
        scale: 1.0,
        castShadows: false,
        collisions: false
      },
      
      'lantern': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/props/decorative/Lantern.glb',
        scale: 1.0,
        castShadows: false,
        collisions: false
      },
      
      // =========================
      // PROPS - Interactive
      // =========================
      'anvil': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/props/interactive/Anvil.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      'well': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/props/interactive/Well.glb',
        scale: 1.0,
        castShadows: true,
        collisions: true
      },
      
      // =========================
      // EQUIPMENT - Weapons
      // =========================
      'weapon_sword_iron': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/equipment/weapons/Sword_Iron.glb',
        scale: 1.0,
        castShadows: true,
        collisions: false
      },
      
      'weapon_sword_steel': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/equipment/weapons/Sword_Steel.glb',
        scale: 1.0,
        castShadows: true,
        collisions: false
      },
      
      'weapon_axe': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/equipment/weapons/Axe_Battle.glb',
        scale: 1.0,
        castShadows: true,
        collisions: false
      },
      
      'weapon_bow': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/equipment/weapons/Bow_Long.glb',
        scale: 1.0,
        castShadows: true,
        collisions: false
      },
      
      'weapon_staff': {
        url: 'https://raw.githubusercontent.com/ian-dungan/hosg/main/assets/equipment/weapons/Staff_Wizard.glb',
        scale: 1.0,
        castShadows: true,
        collisions: false
      }
    };
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
        mesh.setEnabled(false);
        
        if (assetConfig.castShadows && this.scene.shadowGenerator) {
          this.scene.shadowGenerator.addShadowCaster(mesh);
        }
        
        if (assetConfig.receiveShadows) {
          mesh.receiveShadows = true;
        }
        
        if (assetConfig.collisions) {
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
      if (index === 0) {
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

    console.warn(`[Assets] Using procedural fallback for ${assetKey}`);

    if (assetKey.includes('character') || assetKey.includes('enemy') || assetKey.includes('npc')) {
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
      'rock_medium',
      'barrel',
      'chest_closed'
    ];

    const promises = commonAssets.map(key => 
      this.loadAsset(key).catch(err => {
        console.warn(`Failed to preload ${key}:`, err.message);
      })
    );
    
    await Promise.allSettled(promises);
    console.log('[Assets] ✓ Preload complete');
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
      character_male: new BABYLON.Color3(0.7, 0.7, 0.8),
      character_female: new BABYLON.Color3(0.8, 0.6, 0.7),
      character_mage: new BABYLON.Color3(0.4, 0.5, 0.9),
      enemy_wolf: new BABYLON.Color3(0.5, 0.4, 0.3),
      enemy_goblin: new BABYLON.Color3(0.5, 0.7, 0.3),
      enemy_skeleton: new BABYLON.Color3(0.9, 0.9, 0.9),
      npc_merchant: new BABYLON.Color3(0.6, 0.5, 0.4),
      npc_guard: new BABYLON.Color3(0.5, 0.5, 0.6)
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

    const canopy = BABYLON.MeshBuilder.CreateSphere('canopy', { diameter: 5 * scale, segments: 10 }, scene);
    canopy.parent = root;
    canopy.position.y = 6 * scale;

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
console.log("[Assets] Asset loader v2.1 ready! (GitHub: ian-dungan/hosg)");
