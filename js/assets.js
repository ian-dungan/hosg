// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.8
// Combined manifest + loader in one file
// ============================================================

// ==================== ASSET MANIFEST ====================
const ASSET_MANIFEST = {
    BASE_PATH: 'assets/',
    
    CONFIG: {
        USE_ASSETS: true,
        FALLBACK_TO_PROCEDURAL: true,
        LOG_LOADING: true,
        CACHE_ASSETS: true,
        TEXTURE_ANISOTROPY: 4,
        GENERATE_MIPMAPS: true
    },
    
    // ==================== CHARACTER MODELS ====================
    CHARACTERS: {
        PLAYER: {
            knight: {
                model: 'player/character/knight03.glb',
                scale: 1.0,
                offset: { x: 0, y: -0.9, z: 0 }, // Position relative to physics body
                required: true,
                animations: {
                    idle: 'Idle',
                    walk: 'Walk',
                    run: 'Run',
                    jump: 'Jump',
                    attack: 'Attack'
                }
            }
        },
        NPCS: {
            merchant: {
                model: 'npcs/merchant.glb',
                scale: 1.0,
                required: false
            },
            guard: {
                model: 'npcs/guard.glb',
                scale: 1.0,
                required: false
            }
        },
        ENEMIES: {
            wolf: {
                model: 'enemies/wolf.glb',
                scale: 0.02,
                required: false
            },
            goblin: {
                model: 'enemies/goblin.glb',
                scale: 1.0,
                required: false
            }
        }
    },
    
    TERRAIN: {
        GROUND: {
            grass: {
                diffuse: 'textures/terrain/grass_diffuse.jpg',
                normal: 'textures/terrain/grass_normal.jpg',
                ao: 'textures/terrain/grass_ao.jpg',
                scale: 50,
                required: true
            },
            dirt: {
                diffuse: 'textures/terrain/dirt_diffuse.jpg',
                normal: 'textures/terrain/dirt_normal.jpg',
                ao: 'textures/terrain/dirt_ao.jpg',
                scale: 50,
                required: false
            },
            gravel: {
                diffuse: 'textures/terrain/gravel_diffuse.jpg',
                normal: 'textures/terrain/gravel_normal.jpg',
                scale: 50,
                required: false
            },
            sand: {
                diffuse: 'textures/terrain/sand_diffuse.jpg',
                normal: 'textures/terrain/sand_normal.jpg',
                scale: 50,
                required: false
            }
        }
    },
    
    WATER: {
        diffuse: 'textures/water/water_diffuse.jpg',
        bump: 'textures/water/water_bump.png',
        normal: 'textures/water/water_normal.png'
    },
    
    SKYBOX: {
        default: {
            px: 'textures/skybox/default/px.jpg',
            nx: 'textures/skybox/default/nx.jpg',
            py: 'textures/skybox/default/py.jpg',
            ny: 'textures/skybox/default/ny.jpg',
            pz: 'textures/skybox/default/pz.jpg',
            nz: 'textures/skybox/default/nz.jpg'
        }
    },
    
    // NOTE: This section appears redundant with CHARACTERS.ENEMIES, but serves as a dedicated block for enemy-specific data (e.g., animations, non-model assets)
    ENEMIES: {
        wolf: {
            model: 'enemies/wolf.glb',
            texture: 'textures/enemies/wolf_diffuse.png',
            animations: ['idle', 'walk', 'run', 'attack', 'die'],
            scale: 1.0
        },
        goblin: {
            model: 'models/enemies/goblin.glb',
            texture: 'textures/enemies/goblin_diffuse.png',
            animations: ['idle', 'walk', 'run', 'attack', 'die'],
            scale: 0.8
        }
    }
};

// ==================== ASSET LOADER ====================
class AssetLoader {
    constructor(scene) {
        this.scene = scene;
        this.basePath = ASSET_MANIFEST.BASE_PATH;
        this.config = ASSET_MANIFEST.CONFIG;
        this.loadedAssets = new Map();
        this.loadingPromises = new Map();
        this.failedAssets = new Set();
        this.stats = { requested: 0, loaded: 0, failed: 0, procedural: 0 };
    }

    // ========== TEXTURE LOADING ==========
    async loadTexture(path, options = {}) {
        if (!this.config.USE_ASSETS) {
            return null;
        }

        const fullPath = this.basePath + path;
        const cacheKey = 'texture_' + fullPath;

        if (this.loadedAssets.has(cacheKey)) {
            return this.loadedAssets.get(cacheKey);
        }

        if (this.loadingPromises.has(cacheKey)) {
            return this.loadingPromises.get(cacheKey);
        }

        this.stats.requested++;
        if (this.config.LOG_LOADING) {
            console.log(`[AssetLoader] Requesting texture: ${fullPath}`);
        }

        const loadPromise = new Promise((resolve, reject) => {
            const texture = new BABYLON.Texture(fullPath, this.scene,
                false, // No skipMipMap
                true,  // Invert Y axis
                BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                () => {
                    this.loadedAssets.set(cacheKey, texture);
                    this.loadingPromises.delete(cacheKey);
                    this.stats.loaded++;
                    if (this.config.LOG_LOADING) {
                        console.log(`[AssetLoader] ✓ Loaded texture: ${fullPath}`);
                    }

                    // Apply options
                    if (options.uScale) texture.uScale = options.uScale;
                    if (options.vScale) texture.vScale = options.vScale;
                    if (this.config.TEXTURE_ANISOTROPY > 1) {
                        texture.maxAnisotropy = this.config.TEXTURE_ANISOTROPY;
                    }

                    resolve(texture);
                },
                (message, exception) => {
                    this.loadingPromises.delete(cacheKey);
                    this.failedAssets.add(fullPath);
                    this.stats.failed++;
                    console.error(`[AssetLoader] ✗ Failed to load texture: ${fullPath}`, message, exception);
                    resolve(null); // Resolve with null on failure
                }
            );
        });

        this.loadingPromises.set(cacheKey, loadPromise);
        return loadPromise;
    }

    // ========== MODEL LOADING ==========
    async loadModel(path, options = {}) {
        if (!this.config.USE_ASSETS) {
            return null;
        }

        const fullPath = this.basePath + path;
        const cacheKey = 'model_' + fullPath;

        if (this.loadedAssets.has(cacheKey)) {
            // Return a cloned instance if caching is desired and model is cloneable
            const cachedModel = this.loadedAssets.get(cacheKey);
            return {
                root: cachedModel.root.clone(`clone_${cachedModel.root.name}_${Date.now()}`),
                instances: cachedModel.instances.map(m => m.clone(`clone_${m.name}_${Date.now()}`)),
                animationGroups: cachedModel.animationGroups.map(ag => ag.clone())
            };
        }

        if (this.loadingPromises.has(cacheKey)) {
            return this.loadingPromises.get(cacheKey);
        }

        this.stats.requested++;
        if (this.config.LOG_LOADING) {
            console.log(`[AssetLoader] Requesting model: ${fullPath}`);
        }

        const rootUrl = fullPath.substring(0, fullPath.lastIndexOf('/') + 1);
        const sceneFileName = fullPath.substring(fullPath.lastIndexOf('/') + 1);

        const loadPromise = new Promise((resolve, reject) => {
            BABYLON.SceneLoader.ImportMesh(
                null,
                rootUrl,
                sceneFileName,
                this.scene,
                (meshes, particleSystems, skeletons, animationGroups) => {
                    if (meshes.length === 0) {
                        this.stats.failed++;
                        this.loadingPromises.delete(cacheKey);
                        console.error(`[AssetLoader] ✗ Model loaded with 0 meshes: ${fullPath}`);
                        return resolve(null);
                    }

                    // Create a root transform node to house all meshes
                    const rootNode = new BABYLON.Mesh('assetRoot_' + sceneFileName, this.scene);

                    // Parent all top-level meshes to the root node
                    const topLevelMeshes = meshes.filter(m => !m.parent);
                    topLevelMeshes.forEach(m => {
                        // Position the root node to the model's initial position
                        if (m.name === '__root__') {
                            rootNode.position.copyFrom(m.position);
                            m.position.setAll(0);
                        }
                        m.parent = rootNode;

                        // Apply default options
                        if (options.scaling) {
                            rootNode.scaling.copyFrom(options.scaling);
                        }
                    });

                    const assetData = {
                        root: rootNode,
                        instances: meshes,
                        animationGroups: animationGroups
                    };

                    // Cache the asset (root mesh is the key to managing instances)
                    this.loadedAssets.set(cacheKey, assetData);
                    this.loadingPromises.delete(cacheKey);
                    this.stats.loaded++;
                    if (this.config.LOG_LOADING) {
                        console.log(`[AssetLoader] ✓ Loaded model: ${fullPath}`);
                    }

                    resolve(assetData);
                },
                null, // Progress callback
                (scene, message, exception) => {
                    this.loadingPromises.delete(cacheKey);
                    this.failedAssets.add(fullPath);
                    this.stats.failed++;
                    console.error(`[AssetLoader] ✗ Failed to load model: ${fullPath}`, message, exception);
                    resolve(null);
                }
            );
        });

        this.loadingPromises.set(cacheKey, loadPromise);
        return loadPromise;
    }

    // ========== PROCEDURAL FALLBACKS ==========

    /**
     * Creates a simple procedural material based on a type name.
     * @param {string} typeName - e.g., 'grass', 'dirt', 'wood'
     */
    createProceduralMaterial(typeName) {
        const mat = new BABYLON.StandardMaterial(`proceduralMat_${typeName}`, this.scene);

        const colors = {
            grass: new BABYLON.Color3(0.3, 0.6, 0.3),
            dirt: new BABYLON.Color3(0.5, 0.4, 0.3),
            stone: new BABYLON.Color3(0.4, 0.4, 0.4),
            water: new BABYLON.Color3(0.1, 0.3, 0.5),
            wood: new BABYLON.Color3(0.5, 0.3, 0.1),
            skin: new BABYLON.Color3(0.8, 0.7, 0.5)
        };
        
        mat.diffuseColor = colors[typeName] || colors.grass;
        mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        
        return mat;
    }
    
    createProceduralSkybox() {
        const skybox = BABYLON.MeshBuilder.CreateBox('skybox', { size: 1000 }, this.scene);
        const skyMat = new BABYLON.StandardMaterial('skyMat', this.scene);
        skyMat.backFaceCulling = false;
        skyMat.diffuseColor = new BABYLON.Color3(0.5, 0.7, 0.9);
        skyMat.emissiveColor = new BABYLON.Color3(0.5, 0.7, 0.9);
        skybox.material = skyMat;
        return skybox;
    }
    
    // ========== STATS ==========
    getStats() {
        const successRate = this.stats.requested > 0 ? 
            ((this.stats.loaded / this.stats.requested) * 100).toFixed(1) : 0;
        
        return {
            ...this.stats,
            successRate: successRate + '%'
        };
    }
    
    printStats() {
        const stats = this.getStats();
        console.log('=== Asset Loading Statistics ===');
        console.log(`Requested: ${stats.requested}`);
        console.log(`Loaded: ${stats.loaded}`);
        console.log(`Failed: ${stats.failed}`);
        console.log(`Procedural Fallbacks: ${stats.procedural}`);
        console.log(`Success Rate: ${stats.successRate}`);
    }
}
