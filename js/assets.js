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

// FIX: Expose ASSET_MANIFEST globally so other scripts checking window.ASSET_MANIFEST can find it.
if (typeof window !== 'undefined') {
    window.ASSET_MANIFEST = ASSET_MANIFEST;
}

// ==================== ASSET LOADER ====================
class AssetLoader { 
// ... rest of AssetLoader class (omitted for brevity)
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
            return await this.loadingPromises.get(cacheKey);
        }
        this.stats.requested++;

        const promise = new Promise((resolve, reject) => {
            const texture = new BABYLON.Texture(
                fullPath,
                this.scene,
                !this.config.GENERATE_MIPMAPS, // Skip mipmaps
                true, // Invert Y
                BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                () => {
                    if (this.config.TEXTURE_ANISOTROPY > 1) {
                        texture.level = this.config.TEXTURE_ANISOTROPY;
                    }
                    this.stats.loaded++;
                    this.loadedAssets.set(cacheKey, texture);
                    this.loadingPromises.delete(cacheKey);
                    if (this.config.LOG_LOADING) {
                        console.log(`[AssetLoader] ✓ Loaded texture: ${fullPath}`);
                    }
                    resolve(texture);
                },
                (message, exception) => {
                    this.stats.failed++;
                    this.failedAssets.add(cacheKey);
                    this.loadingPromises.delete(cacheKey);
                    console.error(`[AssetLoader] ❌ Failed to load texture: ${fullPath}`, message, exception);
                    reject(new Error(`Failed to load texture: ${fullPath}`));
                }
            );
            // Apply scale options for tiling
            if (options.uScale) texture.uScale = options.uScale;
            if (options.vScale) texture.vScale = options.vScale;
            
            // Set anisotropy if available
            if (this.scene.getEngine().getCaps().maxAnisotropy > 0) {
                texture.anisotropicFilteringLevel = this.config.TEXTURE_ANISOTROPY;
            }
        });
        this.loadingPromises.set(cacheKey, promise);
        return promise;
    }
    
    // ========== MODEL LOADING ==========
    async loadModel(path, options = {}) {
        if (!this.config.USE_ASSETS) {
            return null;
        }
        const fullPath = this.basePath + path;
        const cacheKey = 'model_' + fullPath;
        if (this.loadedAssets.has(cacheKey)) {
            return this.loadedAssets.get(cacheKey);
        }
        if (this.loadingPromises.has(cacheKey)) {
            return await this.loadingPromises.get(cacheKey);
        }
        this.stats.requested++;

        const promise = new Promise((resolve, reject) => {
            BABYLON.SceneLoader.ImportMesh(
                options.meshNames || "",
                fullPath.substring(0, fullPath.lastIndexOf('/') + 1),
                fullPath.substring(fullPath.lastIndexOf('/') + 1),
                this.scene,
                (meshes, particleSystems, skeletons, animationGroups) => {
                    this.stats.loaded++;
                    
                    // Create a root node for the model
                    const root = new BABYLON.TransformNode(options.name || path, this.scene);
                    
                    // Parent all meshes to the root node
                    meshes.forEach(mesh => {
                        mesh.parent = root;
                        mesh.isPickable = true; // Default pickable
                        
                        // Default shadow casting
                        if (this.scene.shadowGenerator) {
                            this.scene.shadowGenerator.addShadowCaster(mesh);
                        }
                    });

                    // Store the result
                    const result = {
                        root: root,
                        meshes: meshes,
                        skeletons: skeletons,
                        animationGroups: animationGroups
                    };

                    if (this.config.CACHE_ASSETS) {
                        this.loadedAssets.set(cacheKey, result);
                    }
                    this.loadingPromises.delete(cacheKey);
                    
                    if (this.config.LOG_LOADING) {
                        console.log(`[AssetLoader] ✓ Loaded model: ${fullPath} (${meshes.length} meshes)`);
                    }
                    resolve(result);
                },
                null, // Progress callback
                (scene, message, exception) => {
                    this.stats.failed++;
                    this.failedAssets.add(cacheKey);
                    this.loadingPromises.delete(cacheKey);
                    console.error(`[AssetLoader] ❌ Failed to load model: ${fullPath}`, message, exception);
                    reject(new Error(`Failed to load model: ${fullPath}`));
                }
            );
        });
        this.loadingPromises.set(cacheKey, promise);
        return promise;
    }

    // ========== PROCEDURAL FALLBACKS ==========
    createProceduralMaterial(typeName) {
        this.stats.procedural++;

        const mat = new BABYLON.StandardMaterial('proceduralMat', this.scene);
        
        // Simple color mapping
        const colors = {
            grass: new BABYLON.Color3(0.3, 0.7, 0.4),
            dirt: new BABYLON.Color3(0.5, 0.4, 0.3),
            rock: new BABYLON.Color3(0.4, 0.4, 0.4),
            water: new BABYLON.Color3(0.2, 0.5, 0.7),
            player: new BABYLON.Color3(0.1, 0.8, 0.1),
            enemy: new BABYLON.Color3(0.8, 0.2, 0.2),
            default: new BABYLON.Color3(0.8, 0.7, 0.5)
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
