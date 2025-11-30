// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.7
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
            model: 'models/enemies/wolf.glb',
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
        
        this.stats = {
            requested: 0,
            loaded: 0,
            failed: 0,
            procedural: 0
        };
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
        
        const loadPromise = this._loadTextureInternal(fullPath, options);
        this.loadingPromises.set(cacheKey, loadPromise);
        
        try {
            const texture = await loadPromise;
            if (texture) {
                this.loadedAssets.set(cacheKey, texture);
                this.stats.loaded++;
                if (this.config.LOG_LOADING) {
                    console.log(`[Assets] ✓ Loaded texture: ${path}`);
                }
            } else {
                this.failedAssets.add(fullPath);
                this.stats.failed++;
                if (this.config.LOG_LOADING) {
                    console.warn(`[Assets] ✗ Failed texture: ${path}`);
                }
            }
            return texture;
        } catch (error) {
            this.failedAssets.add(fullPath);
            this.stats.failed++;
            if (this.config.LOG_LOADING) {
                console.warn(`[Assets] ✗ Error loading ${path}:`, error.message);
            }
            return null;
        } finally {
            this.loadingPromises.delete(cacheKey);
        }
    }
    
    _loadTextureInternal(fullPath, options = {}) {
        return new Promise((resolve) => {
            try {
                const texture = new BABYLON.Texture(fullPath, this.scene, 
                    this.config.GENERATE_MIPMAPS, 
                    false, 
                    BABYLON.Texture.BILINEAR_SAMPLINGMODE,
                    () => resolve(texture),
                    () => resolve(null)
                );
                
                if (this.config.TEXTURE_ANISOTROPY > 0) {
                    texture.anisotropicFilteringLevel = this.config.TEXTURE_ANISOTROPY;
                }
                
                if (options.uScale) texture.uScale = options.uScale;
                if (options.vScale) texture.vScale = options.vScale;
            } catch (error) {
                resolve(null);
            }
        });
    }
    
    // ========== TERRAIN TEXTURES ==========
    async loadTerrainTextures(terrainTypes = ['grass']) {
        const result = {};
        
        for (const typeName of terrainTypes) {
            const terrainData = ASSET_MANIFEST.TERRAIN.GROUND[typeName];
            if (!terrainData) continue;
            
            result[typeName] = {
                diffuse: null,
                normal: null,
                ao: null,
                scale: terrainData.scale || 50
            };
            
            if (terrainData.diffuse) {
                result[typeName].diffuse = await this.loadTexture(terrainData.diffuse, {
                    uScale: terrainData.scale,
                    vScale: terrainData.scale
                });
            }
            
            if (terrainData.normal) {
                result[typeName].normal = await this.loadTexture(terrainData.normal, {
                    uScale: terrainData.scale,
                    vScale: terrainData.scale
                });
            }
            
            if (terrainData.ao) {
                result[typeName].ao = await this.loadTexture(terrainData.ao, {
                    uScale: terrainData.scale,
                    vScale: terrainData.scale
                });
            }
            
            // If required texture failed, create procedural
            if (terrainData.required && !result[typeName].diffuse) {
                if (this.config.FALLBACK_TO_PROCEDURAL) {
                    result[typeName].procedural = this.createProceduralTerrain(typeName);
                    this.stats.procedural++;
                }
            }
        }
        
        return result;
    }
    
    // ========== SKYBOX ==========
    async loadSkybox(skyboxName = 'default') {
        const skyboxData = ASSET_MANIFEST.SKYBOX[skyboxName];
        if (!skyboxData) return null;
        
        const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
        const textures = [];
        
        for (const face of faces) {
            const path = skyboxData[face];
            if (!path) return null;
            
            const texture = await this.loadTexture(path);
            if (!texture) return null;
            textures.push(texture);
        }
        
        return new BABYLON.CubeTexture.CreateFromImages(textures, this.scene);
    }
    
    // ========== 3D MODELS ==========
    async loadModel(path, options = {}) {
        if (!this.config.USE_ASSETS) {
            return null;
        }
        
        const fullPath = this.basePath + path;
        const cacheKey = 'model_' + fullPath;
        
        if (this.loadedAssets.has(cacheKey)) {
            return this._createModelInstance(this.loadedAssets.get(cacheKey), options);
        }
        
        if (this.loadingPromises.has(cacheKey)) {
            const modelData = await this.loadingPromises.get(cacheKey);
            return this._createModelInstance(modelData, options);
        }
        
        this.stats.requested++;
        
        const loadPromise = this._loadModelInternal(fullPath, options);
        this.loadingPromises.set(cacheKey, loadPromise);
        
        try {
            const modelData = await loadPromise;
            if (modelData) {
                this.loadedAssets.set(cacheKey, modelData);
                this.stats.loaded++;
                if (this.config.LOG_LOADING) {
                    console.log(`[Assets] ✓ Loaded model: ${path}`);
                }
                return this._createModelInstance(modelData, options);
            } else {
                this.failedAssets.add(fullPath);
                this.stats.failed++;
                if (this.config.LOG_LOADING) {
                    console.warn(`[Assets] ✗ Failed model: ${path}`);
                }
                return null;
            }
        } catch (error) {
            this.failedAssets.add(fullPath);
            this.stats.failed++;
            if (this.config.LOG_LOADING) {
                console.warn(`[Assets] ✗ Error loading ${path}:`, error.message);
            }
            return null;
        } finally {
            this.loadingPromises.delete(cacheKey);
        }
    }
    
    async _loadModelInternal(fullPath, options = {}) {
        return new Promise((resolve) => {
            BABYLON.SceneLoader.ImportMesh('', '', fullPath, this.scene,
                (meshes, particleSystems, skeletons, animationGroups) => {
                    meshes.forEach(mesh => mesh.setEnabled(false));
                    resolve({ meshes, animationGroups, skeletons });
                },
                null,
                () => resolve(null)
            );
        });
    }
    
    _createModelInstance(modelData, options = {}) {
        if (!modelData || !modelData.meshes || modelData.meshes.length === 0) {
            return null;
        }
        
        const root = modelData.meshes[0].createInstance('instance_' + Date.now());
        root.position = options.position || BABYLON.Vector3.Zero();
        root.rotation = options.rotation || BABYLON.Vector3.Zero();
        root.scaling = options.scaling || BABYLON.Vector3.One();
        root.setEnabled(true);
        
        const instances = [root];
        for (let i = 1; i < modelData.meshes.length; i++) {
            const instance = modelData.meshes[i].clone();
            instance.parent = root;
            instance.setEnabled(true);
            instances.push(instance);
        }
        
        const animations = modelData.animationGroups ? 
            modelData.animationGroups.map(ag => ag.clone()) : [];
        
        return { root, instances, animationGroups: animations };
    }
    
    // ========== PROCEDURAL FALLBACKS ==========
    createProceduralTerrain(typeName) {
        const mat = new BABYLON.StandardMaterial('proc_' + typeName, this.scene);
        
        const colors = {
            grass: new BABYLON.Color3(0.3, 0.6, 0.3),
            dirt: new BABYLON.Color3(0.4, 0.3, 0.2),
            gravel: new BABYLON.Color3(0.5, 0.5, 0.5),
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
        console.log(`Procedural: ${stats.procedural}`);
        console.log(`Success Rate: ${stats.successRate}`);
    }
}

// ========== EXPORT ==========
window.ASSET_MANIFEST = ASSET_MANIFEST;
window.AssetLoader = AssetLoader;

console.log('[Assets] Asset system loaded (v1.0.7)');
