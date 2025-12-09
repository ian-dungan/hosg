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
            // FIX: Commented out missing merchant model to prevent 404 errors.
            // merchant: {
            //     model: 'npcs/merchant.glb',
            //     scale: 1.0,
            //     required: false
            // },
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
            model: 'enemies/goblin.glb',
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

    // ... (Remaining AssetLoader implementation)

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

        this.stats.requested++;
        if (this.loadingPromises.has(cacheKey)) {
            return this.loadingPromises.get(cacheKey);
        }

        const promise = new Promise((resolve, reject) => {
            const texture = new BABYLON.Texture(fullPath, this.scene, true, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                () => {
                    if (this.config.LOG_LOADING) {
                        console.log(`[Assets] ✓ Loaded texture: ${path}`);
                    }
                    if (options.uScale) texture.uScale = options.uScale;
                    if (options.vScale) texture.vScale = options.vScale;
                    this.loadedAssets.set(cacheKey, texture);
                    this.loadingPromises.delete(cacheKey);
                    this.stats.loaded++;
                    resolve(texture);
                },
                (message, exception) => {
                    console.error(`[Assets] ✗ Failed texture: ${path}`, exception || message);
                    this.failedAssets.add(path);
                    this.loadingPromises.delete(cacheKey);
                    this.stats.failed++;
                    resolve(this.createProceduralMaterial("grass").albedoTexture); // Fallback
                }
            );
        });

        this.loadingPromises.set(cacheKey, promise);
        return promise;
    }

    // ========== MODEL LOADING ==========
    async loadModel(assetKey, options = {}) {
        if (!this.config.USE_ASSETS) {
            return null;
        }

        const manifestEntry = this._getManifestEntry(assetKey);
        if (!manifestEntry) {
            console.warn(`[Assets] Model manifest entry not found for: ${assetKey}`);
            return null;
        }

        const fullPath = this.basePath + manifestEntry.model;
        const cacheKey = 'model_' + fullPath;

        if (this.loadedAssets.has(cacheKey)) {
            return this._cloneLoadedModel(cacheKey, options);
        }

        this.stats.requested++;
        if (this.loadingPromises.has(cacheKey)) {
            return this.loadingPromises.get(cacheKey).then(() => this._cloneLoadedModel(cacheKey, options));
        }

        const promise = this._loadModelInternal(fullPath, assetKey, cacheKey, manifestEntry);

        this.loadingPromises.set(cacheKey, promise);
        return promise.then(() => this._cloneLoadedModel(cacheKey, options));
    }

    _loadModelInternal(fullPath, assetKey, cacheKey, manifestEntry) {
        return new Promise((resolve, reject) => {
            BABYLON.SceneLoader.ImportMesh(
                null,
                '', // Root url
                fullPath,
                this.scene,
                (meshes, particleSystems, skeletons, animationGroups) => {
                    const rootMesh = new BABYLON.Mesh(`root_${assetKey}`, this.scene);
                    rootMesh.isVisible = false;
                    
                    meshes.forEach(m => {
                        m.parent = rootMesh;
                        if (manifestEntry.offset) {
                            m.position.addInPlace(new BABYLON.Vector3(manifestEntry.offset.x, manifestEntry.offset.y, manifestEntry.offset.z));
                        }
                    });

                    // Store original data
                    const modelData = {
                        root: rootMesh,
                        meshes: meshes,
                        skeletons: skeletons,
                        animationGroups: animationGroups
                    };

                    this.loadedAssets.set(cacheKey, modelData);
                    this.loadingPromises.delete(cacheKey);
                    this.stats.loaded++;

                    if (this.config.LOG_LOADING) {
                        console.log(`[Assets] ✓ Loaded model: ${manifestEntry.model}`);
                    }
                    resolve(modelData);
                },
                null, // Progress callback
                (scene, message, exception) => {
                    console.error(`[Assets] ✗ ImportMesh failed for ${fullPath}: ${message}`, exception);
                    this.failedAssets.add(manifestEntry.model);
                    this.loadingPromises.delete(cacheKey);
                    this.stats.failed++;
                    reject(new Error(`Unable to load from ${fullPath}: ${message}`));
                }
            );
        });
    }

    _cloneLoadedModel(cacheKey, options) {
        const originalData = this.loadedAssets.get(cacheKey);
        if (!originalData || !originalData.root) {
            return null;
        }

        const newRoot = originalData.root.clone(`instance_${originalData.root.name}_${Date.now()}`);
        if (!newRoot) return null;

        const instances = [];
        const clonedMeshes = [];

        originalData.meshes.forEach(originalMesh => {
            const clonedMesh = originalMesh.createInstance(originalMesh.name + "_instance");
            clonedMesh.parent = newRoot;
            clonedMeshes.push(clonedMesh);
            instances.push(clonedMesh);
        });

        if (options.scaling) {
            newRoot.scaling.copyFrom(options.scaling);
        } else if (options.scale) {
            newRoot.scaling.setAll(options.scale);
        }

        // Clone/Retarget animations/skeletons if needed (simplified for this example)
        
        return {
            root: newRoot,
            meshes: clonedMeshes,
            instances: instances,
            animationGroups: originalData.animationGroups.map(ag => ag.clone(ag.name + "_clone", null))
        };
    }

    _getManifestEntry(assetKey) {
        const parts = assetKey.split('/');
        let current = ASSET_MANIFEST.CHARACTERS;
        
        if (parts.length === 1) { // Check ENEMIES directly
            return ASSET_MANIFEST.ENEMIES[parts[0]];
        }
        
        // Check CHARACTERS/NPCS or CHARACTERS/ENEMIES
        if (current[parts[0]]) {
            current = current[parts[0]];
        } else {
            return null;
        }

        if (current[parts[1]]) {
            return current[parts[1]];
        }

        return null;
    }

    // ... (Stats/Procedural methods from original snippet)
    createProceduralMaterial(typeName) {
        const mat = new BABYLON.StandardMaterial(`proceduralMat_${typeName}`, this.scene);
        const colors = {
            grass: new BABYLON.Color3(0.3, 0.6, 0.3),
            dirt: new BABYLON.Color3(0.6, 0.4, 0.2),
            rock: new BABYLON.Color3(0.5, 0.5, 0.5),
            sand: new BABYLON.Color3(0.8, 0.7, 0.5)
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
