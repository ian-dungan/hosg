// ============================================================
// HEROES OF SHADY GROVE - WORLD SYSTEM v2.0
// Massive world with multiple zones and biomes
// Upload this file to GitHub as: hosg_world_system.js
// ============================================================

class WorldZone {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.biome = config.biome;
    this.level = config.level;
    this.size = config.size || { width: 1000, depth: 1000 };
    this.position = config.position || { x: 0, z: 0 };
    this.connections = config.connections || [];
    this.terrain = config.terrain || {};
    this.weather = config.weather || 'clear';
    this.timeOfDay = config.timeOfDay || 'day';
    this.music = config.music || null;
    this.loaded = false;
    this.meshes = [];
    this.entities = [];
  }
}

class WorldManager {
  constructor(scene, supabase) {
    this.scene = scene;
    this.supabase = supabase;
    this.zones = new Map();
    this.currentZone = null;
    this.playerPosition = { x: 0, y: 0, z: 0 };
    this.loadedZones = new Set();
    this.loadRadius = 1;
    
    this.initializeWorldMap();
  }

  initializeWorldMap() {
    const zoneTypes = [
      { biome: 'grassland', color: '#4a7c4e', enemyLevel: [1, 5] },
      { biome: 'forest', color: '#2d5a2d', enemyLevel: [5, 15] },
      { biome: 'desert', color: '#d4a574', enemyLevel: [15, 25] },
      { biome: 'snow', color: '#e8f4f8', enemyLevel: [25, 35] },
      { biome: 'swamp', color: '#4a5c3a', enemyLevel: [35, 45] },
      { biome: 'mountains', color: '#8b8680', enemyLevel: [45, 55] },
      { biome: 'volcanic', color: '#6b3e3e', enemyLevel: [55, 70] },
      { biome: 'crystal', color: '#b4a8ff', enemyLevel: [70, 85] },
      { biome: 'corrupted', color: '#4a2d5a', enemyLevel: [85, 100] }
    ];

    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        const zoneId = `zone_${x}_${z}`;
        const distFromCenter = Math.sqrt(Math.pow(x - 5, 2) + Math.pow(z - 5, 2));
        const biomeIndex = Math.min(Math.floor(distFromCenter / 1.5), zoneTypes.length - 1);
        const biomeType = zoneTypes[biomeIndex];
        
        const zone = new WorldZone({
          id: zoneId,
          name: this.generateZoneName(biomeType.biome, x, z),
          biome: biomeType.biome,
          level: Math.floor((biomeType.enemyLevel[0] + biomeType.enemyLevel[1]) / 2),
          size: { width: 1000, depth: 1000 },
          position: { x: x * 1000, z: z * 1000 },
          connections: this.getAdjacentZones(x, z),
          terrain: {
            color: biomeType.color,
            elevation: this.getElevationForBiome(biomeType.biome),
            foliage: this.getFoliageDensity(biomeType.biome)
          },
          weather: this.getWeatherForBiome(biomeType.biome),
          timeOfDay: 'day'
        });
        
        this.zones.set(zoneId, zone);
      }
    }
    
    console.log(`[World] Created ${this.zones.size} zones`);
  }

  generateZoneName(biome, x, z) {
    const prefixes = {
      grassland: ['Emerald', 'Verdant', 'Peaceful', 'Shady', 'Golden'],
      forest: ['Dark', 'Ancient', 'Whispering', 'Misty', 'Deep'],
      desert: ['Scorching', 'Endless', 'Golden', 'Shifting', 'Blazing'],
      snow: ['Frozen', 'Icy', 'Blizzard', 'Crystal', 'Frostbitten'],
      swamp: ['Murky', 'Fetid', 'Shadowy', 'Poisoned', 'Sunken'],
      mountains: ['Towering', 'Jagged', 'Storm', 'Cloud', 'Echo'],
      volcanic: ['Burning', 'Molten', 'Ashen', 'Infernal', 'Hellfire'],
      crystal: ['Shimmering', 'Prismatic', 'Arcane', 'Radiant', 'Enchanted'],
      corrupted: ['Twisted', 'Blighted', 'Forsaken', 'Void', 'Cursed']
    };
    
    const suffixes = {
      grassland: ['Plains', 'Fields', 'Meadows', 'Grasslands', 'Grove'],
      forest: ['Woods', 'Forest', 'Thicket', 'Timberland', 'Wilds'],
      desert: ['Dunes', 'Wastes', 'Expanse', 'Barrens', 'Sands'],
      snow: ['Peaks', 'Tundra', 'Wastes', 'Highlands', 'Glacier'],
      swamp: ['Marsh', 'Bog', 'Fen', 'Mire', 'Wetlands'],
      mountains: ['Mountains', 'Peaks', 'Range', 'Cliffs', 'Summit'],
      volcanic: ['Crater', 'Caldera', 'Fissure', 'Forge', 'Volcano'],
      crystal: ['Caverns', 'Grotto', 'Sanctum', 'Realm', 'Spires'],
      corrupted: ['Lands', 'Realm', 'Wastes', 'Abyss', 'Depths']
    };
    
    const prefix = prefixes[biome][Math.abs((x * 7 + z * 13) % prefixes[biome].length)];
    const suffix = suffixes[biome][Math.abs((x * 11 + z * 17) % suffixes[biome].length)];
    
    return `${prefix} ${suffix}`;
  }

  getAdjacentZones(x, z) {
    const adjacent = [];
    if (x > 0) adjacent.push(`zone_${x-1}_${z}`);
    if (x < 9) adjacent.push(`zone_${x+1}_${z}`);
    if (z > 0) adjacent.push(`zone_${x}_${z-1}`);
    if (z < 9) adjacent.push(`zone_${x}_${z+1}`);
    return adjacent;
  }

  getElevationForBiome(biome) {
    const elevations = {
      grassland: { min: 0, max: 5, roughness: 0.3 },
      forest: { min: 0, max: 10, roughness: 0.5 },
      desert: { min: -2, max: 20, roughness: 0.7 },
      snow: { min: 10, max: 40, roughness: 0.8 },
      swamp: { min: -5, max: 2, roughness: 0.2 },
      mountains: { min: 20, max: 80, roughness: 0.9 },
      volcanic: { min: 10, max: 50, roughness: 0.8 },
      crystal: { min: 0, max: 30, roughness: 0.6 },
      corrupted: { min: -10, max: 25, roughness: 0.7 }
    };
    return elevations[biome] || elevations.grassland;
  }

  getFoliageDensity(biome) {
    const densities = {
      grassland: 0.6,
      forest: 0.9,
      desert: 0.1,
      snow: 0.2,
      swamp: 0.7,
      mountains: 0.3,
      volcanic: 0.1,
      crystal: 0.4,
      corrupted: 0.5
    };
    return densities[biome] || 0.5;
  }

  getWeatherForBiome(biome) {
    const weather = {
      grassland: 'clear',
      forest: 'fog',
      desert: 'clear',
      snow: 'snow',
      swamp: 'rain',
      mountains: 'wind',
      volcanic: 'ash',
      crystal: 'sparkles',
      corrupted: 'storm'
    };
    return weather[biome] || 'clear';
  }

  async loadZone(zoneId) {
    const zone = this.zones.get(zoneId);
    if (!zone || zone.loaded) return;

    console.log(`[World] Loading zone: ${zone.name}`);

    await this.createZoneTerrain(zone);
    await this.createZoneFoliage(zone);
    this.createZoneAmbience(zone);
    
    zone.loaded = true;
    this.loadedZones.add(zoneId);
    
    console.log(`[World] Loaded zone: ${zone.name}`);
  }

  async unloadZone(zoneId) {
    const zone = this.zones.get(zoneId);
    if (!zone || !zone.loaded) return;

    console.log(`[World] Unloading zone: ${zone.name}`);

    zone.meshes.forEach(mesh => {
      if (mesh && mesh.dispose) {
        mesh.dispose();
      }
    });
    zone.meshes = [];
    zone.entities = [];
    
    zone.loaded = false;
    this.loadedZones.delete(zoneId);
  }

  async createZoneTerrain(zone) {
    const scene = this.scene;
    const { width, depth } = zone.size;
    const { x: offsetX, z: offsetZ } = zone.position;
    const elevation = zone.terrain.elevation;

    const subdivisions = 100;
    const ground = BABYLON.MeshBuilder.CreateGround(
      `terrain_${zone.id}`,
      { width, height: depth, subdivisions, updatable: true },
      scene
    );

    ground.position = new BABYLON.Vector3(offsetX + width / 2, 0, offsetZ + depth / 2);

    const positions = ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];
      const noise = this.generateNoise(x + offsetX, z + offsetZ, elevation.roughness);
      positions[i + 1] = elevation.min + noise * (elevation.max - elevation.min);
    }
    ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
    ground.createNormals(true);

    const material = this.createBiomeMaterial(zone.biome, zone.id);
    ground.material = material;
    ground.checkCollisions = true;
    ground.receiveShadows = true;

    zone.meshes.push(ground);
    return ground;
  }

  generateNoise(x, z, scale) {
    const s = Math.sin(x * 0.01 * scale) * Math.cos(z * 0.01 * scale);
    const c = Math.cos(x * 0.02 * scale) * Math.sin(z * 0.02 * scale);
    return (s + c) * 0.5 + 0.5;
  }

  createBiomeMaterial(biome, zoneId) {
    const scene = this.scene;
    const mat = new BABYLON.StandardMaterial(`mat_${zoneId}`, scene);
    
    const biomeConfigs = {
      grassland: { diffuse: new BABYLON.Color3(0.3, 0.6, 0.3), texture: 'https://playground.babylonjs.com/textures/grass.jpg' },
      forest: { diffuse: new BABYLON.Color3(0.2, 0.4, 0.2), texture: 'https://playground.babylonjs.com/textures/grass.jpg' },
      desert: { diffuse: new BABYLON.Color3(0.8, 0.7, 0.4), texture: 'https://playground.babylonjs.com/textures/sand.jpg' },
      snow: { diffuse: new BABYLON.Color3(0.9, 0.9, 0.95), texture: 'https://playground.babylonjs.com/textures/floor.png' },
      swamp: { diffuse: new BABYLON.Color3(0.3, 0.4, 0.25), texture: 'https://playground.babylonjs.com/textures/grass.jpg' },
      mountains: { diffuse: new BABYLON.Color3(0.5, 0.5, 0.5), texture: 'https://playground.babylonjs.com/textures/rock.png' },
      volcanic: { diffuse: new BABYLON.Color3(0.4, 0.2, 0.2), emissive: new BABYLON.Color3(0.2, 0.05, 0) },
      crystal: { diffuse: new BABYLON.Color3(0.7, 0.6, 0.9), emissive: new BABYLON.Color3(0.1, 0.1, 0.2) },
      corrupted: { diffuse: new BABYLON.Color3(0.3, 0.2, 0.4), emissive: new BABYLON.Color3(0.1, 0, 0.1) }
    };

    const config = biomeConfigs[biome] || biomeConfigs.grassland;
    
    if (config.texture) {
      const texture = new BABYLON.Texture(config.texture, scene);
      texture.uScale = 50;
      texture.vScale = 50;
      mat.diffuseTexture = texture;
    } else {
      mat.diffuseColor = config.diffuse;
    }
    
    if (config.emissive) {
      mat.emissiveColor = config.emissive;
    }
    
    mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    return mat;
  }

  async createZoneFoliage(zone) {
    const density = zone.terrain.foliage;
    if (density < 0.1) return;

    const { width, depth } = zone.size;
    const { x: offsetX, z: offsetZ } = zone.position;
    const count = Math.floor(density * 200);
    
    for (let i = 0; i < count; i++) {
      const x = offsetX + Math.random() * width;
      const z = offsetZ + Math.random() * depth;
      
      const foliage = this.createFoliageForBiome(zone.biome, zone.id, i);
      if (foliage) {
        foliage.position = new BABYLON.Vector3(x, 0, z);
        const noise = this.generateNoise(x, z, zone.terrain.elevation.roughness);
        foliage.position.y = zone.terrain.elevation.min + noise * (zone.terrain.elevation.max - zone.terrain.elevation.min);
        zone.meshes.push(foliage);
      }
    }
  }

  createFoliageForBiome(biome, zoneId, index) {
    switch (biome) {
      case 'grassland':
      case 'forest':
        return this.createTree(zoneId, index, biome === 'forest' ? 1.5 : 1.0);
      case 'desert':
        return this.createCactus(zoneId, index);
      case 'snow':
        return this.createPineTree(zoneId, index);
      case 'swamp':
        return this.createSwampTree(zoneId, index);
      case 'mountains':
        return this.createRock(zoneId, index);
      case 'volcanic':
        return this.createVolcanicRock(zoneId, index);
      case 'crystal':
        return this.createCrystal(zoneId, index);
      case 'corrupted':
        return this.createCorruptedTree(zoneId, index);
      default:
        return null;
    }
  }

  createTree(zoneId, index, scale = 1.0) {
    const scene = this.scene;
    const trunk = BABYLON.MeshBuilder.CreateCylinder(`tree_trunk_${zoneId}_${index}`, {
      height: 6 * scale, diameterTop: 0.6 * scale, diameterBottom: 1.0 * scale
    }, scene);
    
    const trunkMat = new BABYLON.StandardMaterial(`trunk_mat_${zoneId}`, scene);
    trunkMat.diffuseColor = new BABYLON.Color3(0.4, 0.25, 0.15);
    trunk.material = trunkMat;
    trunk.position.y = 3 * scale;
    trunk.checkCollisions = true;
    
    const canopy = BABYLON.MeshBuilder.CreateSphere(`tree_canopy_${zoneId}_${index}`, {
      diameter: 5 * scale, segments: 8
    }, scene);
    
    const canopyMat = new BABYLON.StandardMaterial(`canopy_mat_${zoneId}`, scene);
    canopyMat.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.2);
    canopy.material = canopyMat;
    canopy.position.y = 6 * scale;
    canopy.parent = trunk;
    
    return trunk;
  }

  createCactus(zoneId, index) {
    const scene = this.scene;
    const cactus = BABYLON.MeshBuilder.CreateCylinder(`cactus_${zoneId}_${index}`, {
      height: 3 + Math.random() * 2, diameter: 0.5
    }, scene);
    
    const mat = new BABYLON.StandardMaterial(`cactus_mat_${zoneId}`, scene);
    mat.diffuseColor = new BABYLON.Color3(0.3, 0.6, 0.3);
    cactus.material = mat;
    cactus.checkCollisions = true;
    return cactus;
  }

  createPineTree(zoneId, index) {
    const scene = this.scene;
    const tree = BABYLON.MeshBuilder.CreateCylinder(`pine_${zoneId}_${index}`, {
      height: 8, diameterTop: 0.01, diameterBottom: 3
    }, scene);
    
    const mat = new BABYLON.StandardMaterial(`pine_mat_${zoneId}`, scene);
    mat.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.1);
    tree.material = mat;
    tree.position.y = 4;
    tree.checkCollisions = true;
    return tree;
  }

  createSwampTree(zoneId, index) {
    return this.createTree(zoneId, index, 0.8);
  }

  createRock(zoneId, index) {
    const scene = this.scene;
    const rock = BABYLON.MeshBuilder.CreateSphere(`rock_${zoneId}_${index}`, {
      diameter: 1 + Math.random() * 2, segments: 6
    }, scene);
    rock.scaling.y = 0.6;
    
    const mat = new BABYLON.StandardMaterial(`rock_mat_${zoneId}`, scene);
    mat.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    rock.material = mat;
    rock.checkCollisions = true;
    return rock;
  }

  createVolcanicRock(zoneId, index) {
    const rock = this.createRock(zoneId, index);
    const mat = rock.material;
    mat.diffuseColor = new BABYLON.Color3(0.3, 0.1, 0.1);
    mat.emissiveColor = new BABYLON.Color3(0.2, 0.05, 0);
    return rock;
  }

  createCrystal(zoneId, index) {
    const scene = this.scene;
    const crystal = BABYLON.MeshBuilder.CreateCylinder(`crystal_${zoneId}_${index}`, {
      height: 2 + Math.random() * 2, diameterTop: 0.2, diameterBottom: 0.5, tessellation: 6
    }, scene);
    
    const mat = new BABYLON.StandardMaterial(`crystal_mat_${zoneId}`, scene);
    mat.diffuseColor = new BABYLON.Color3(0.6, 0.5, 0.9);
    mat.emissiveColor = new BABYLON.Color3(0.2, 0.1, 0.3);
    mat.alpha = 0.8;
    crystal.material = mat;
    return crystal;
  }

  createCorruptedTree(zoneId, index) {
    const tree = this.createTree(zoneId, index, 0.9);
    const mat = tree.material;
    mat.diffuseColor = new BABYLON.Color3(0.2, 0.1, 0.2);
    mat.emissiveColor = new BABYLON.Color3(0.1, 0, 0.1);
    return tree;
  }

  createZoneAmbience(zone) {
    const scene = this.scene;
    const fogConfigs = {
      forest: { density: 0.02, color: new BABYLON.Color3(0.8, 0.9, 0.8) },
      swamp: { density: 0.03, color: new BABYLON.Color3(0.7, 0.8, 0.7) },
      snow: { density: 0.015, color: new BABYLON.Color3(0.9, 0.9, 1.0) },
      corrupted: { density: 0.025, color: new BABYLON.Color3(0.5, 0.4, 0.6) }
    };
    
    if (fogConfigs[zone.biome]) {
      scene.fogMode = BABYLON.Scene.FOGMODE_EXP;
      scene.fogDensity = fogConfigs[zone.biome].density;
      scene.fogColor = fogConfigs[zone.biome].color;
    }
  }

  getZoneFromPosition(x, z) {
    const gridX = Math.floor(x / 1000);
    const gridZ = Math.floor(z / 1000);
    if (gridX < 0 || gridX >= 10 || gridZ < 0 || gridZ >= 10) return null;
    return this.zones.get(`zone_${gridX}_${gridZ}`);
  }

  async updatePlayerPosition(x, y, z) {
    this.playerPosition = { x, y, z };
    const currentZone = this.getZoneFromPosition(x, z);
    
    if (currentZone && currentZone !== this.currentZone) {
      console.log(`[World] Entering ${currentZone.name} (Level ${currentZone.level})`);
      this.currentZone = currentZone;
      
      await this.loadZone(currentZone.id);
      for (const connectedId of currentZone.connections) {
        await this.loadZone(connectedId);
      }
      
      for (const loadedId of this.loadedZones) {
        if (!currentZone.connections.includes(loadedId) && loadedId !== currentZone.id) {
          await this.unloadZone(loadedId);
        }
      }
    }
  }

  getZoneInfo() {
    if (!this.currentZone) return null;
    return {
      name: this.currentZone.name,
      biome: this.currentZone.biome,
      level: this.currentZone.level,
      weather: this.currentZone.weather
    };
  }
}

window.WorldManager = WorldManager;
console.log("[World] World system loaded");
