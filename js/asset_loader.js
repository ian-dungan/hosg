// ============================================================
// HEROES OF SHADY GROVE - ASSET LOADER v2.0
// Advanced asset management with fallbacks and caching
// ============================================================

class AssetLoader {
    constructor(scene) {
        this.scene = scene;
        this.loadedAssets = new Map();      // Cached loaded assets
        this.loadingPromises = new Map();   // Track ongoing loads
        this.failedAssets = new Set();      // Track failed assets
        this.proceduralFallbacks = new Map(); // Procedural alternatives
        
        this.stats = {
            requested: 0,
            loaded: 0,
            failed: 0,
            procedural: 0
        };
        
        if (!window.ASSET_MANIFEST) {
            console.error('[AssetLoader] ASSET_MANIFEST not found! Load asset_manifest.js first.');
        }
    }

    // ==================== MAIN LOADING METHODS ====================

    /**
     * Load a texture with automatic fallback
     * @param {string} path - Relative path from assets folder
     * @param {object} options - Loading options
     * @returns {Promise<BABYLON.Texture|null>}
     */
    async loadTexture(path, options = {}) {
        if (!path) return null;
        
        const fullPath = ASSET_MANIFEST.BASE_PATH + path;
        const cacheKey = 'tex_' + fullPath;
        
        // Return cached if available
        if (this.loadedAssets.has(cacheKey)) {
            return this.loadedAssets.get(cacheKey);
        }

        // Return ongoing load
        if (this.loadingPromises.has(cacheKey)) {
            return this.loadingPromises.get(cacheKey);
        }

        // Start new load
        this.stats.requested++;
        const loadPromise = this._loadTextureInternal(fullPath, options);
        this.loadingPromises.set(cacheKey, loadPromise);

        try {
            const texture = await loadPromise;
            this.loadedAssets.set(cacheKey, texture);
            this.loadingPromises.delete(cacheKey);
            this.stats.loaded++;
            
            if (ASSET_MANIFEST.CONFIG.LOG_LOADING) {
                console.log(`[Assets] ✓ Loaded texture: ${path}`);
            }
            
            return texture;
        } catch (error) {
            this.loadingPromises.delete(cacheKey);
            this.failedAssets.add(fullPath);
            this.stats.failed++;
            
            if (ASSET_MANIFEST.CONFIG.LOG_LOADING) {
                console.warn(`[Assets] ✗ Failed texture: ${path} - ${error.message}`);
            }
            
            return null;
        }
    }

    /**
     * Load a 3D model with automatic fallback
     * @param {string} path - Relative path from assets folder
     * @param {object} options - Loading options
     * @returns {Promise<object|null>}
     */
    async loadModel(path, options = {}) {
        if (!path) return null;
        
        const fullPath = ASSET_MANIFEST.BASE_PATH + path;
        const cacheKey = 'model_' + fullPath;
        
        // Return cached if available
        if (this.loadedAssets.has(cacheKey)) {
            return this._createModelInstance(this.loadedAssets.get(cacheKey), options);
        }

        // Check if already loading
        if (this.loadingPromises.has(cacheKey)) {
            const loadedData = await this.loadingPromises.get(cacheKey);
            return this._createModelInstance(loadedData, options);
        }

        // Start new load
        this.stats.requested++;
        const loadPromise = this._loadModelInternal(fullPath, options);
        this.loadingPromises.set(cacheKey, loadPromise);

        try {
            const modelData = await loadPromise;
            this.loadedAssets.set(cacheKey, modelData);
            this.loadingPromises.delete(cacheKey);
            this.stats.loaded++;
            
            if (ASSET_MANIFEST.CONFIG.LOG_LOADING) {
                console.log(`[Assets] ✓ Loaded model: ${path} (${modelData.meshes.length} meshes)`);
            }
            
            return this._createModelInstance(modelData, options);
        } catch (error) {
            this.loadingPromises.delete(cacheKey);
            this.failedAssets.add(fullPath);
            this.stats.failed++;
            
            if (ASSET_MANIFEST.CONFIG.LOG_LOADING) {
                console.warn(`[Assets] ✗ Failed model: ${path} - ${error.message}`);
            }
            
            return null;
        }
    }

    /**
     * Load multiple textures for terrain blending
     * @param {object} terrainTypes - Object with terrain type names and paths
     * @returns {Promise<object>} - Object with loaded textures
     */
    async loadTerrainTextures(terrainTypes = ASSET_MANIFEST.TERRAIN.GROUND) {
        const loaded = {};
        const promises = [];

        for (const [typeName, typeData] of Object.entries(terrainTypes)) {
            if (!typeData || typeof typeData !== 'object') continue;

            loaded[typeName] = {
                diffuse: null,
                normal: null,
                ao: null,
                scale: typeData.scale || 50
            };

            // Load diffuse texture
            if (typeData.diffuse) {
                promises.push(
                    this.loadTexture(typeData.diffuse, {
                        generateMipMaps: ASSET_MANIFEST.CONFIG.GENERATE_MIPMAPS
                    }).then(tex => {
                        if (tex) {
                            tex.uScale = typeData.scale || 50;
                            tex.vScale = typeData.scale || 50;
                            loaded[typeName].diffuse = tex;
                        }
                    })
                );
            }

            // Load normal map
            if (typeData.normal) {
                promises.push(
                    this.loadTexture(typeData.normal, {
                        generateMipMaps: ASSET_MANIFEST.CONFIG.GENERATE_MIPMAPS
                    }).then(tex => {
                        if (tex) {
                            tex.uScale = typeData.scale || 50;
                            tex.vScale = typeData.scale || 50;
                            loaded[typeName].normal = tex;
                        }
                    })
                );
            }

            // Load AO map
            if (typeData.ao) {
                promises.push(
                    this.loadTexture(typeData.ao).then(tex => {
                        if (tex) {
                            tex.uScale = typeData.scale || 50;
                            tex.vScale = typeData.scale || 50;
                            loaded[typeName].ao = tex;
                        }
                    })
                );
            }
        }

        await Promise.all(promises);
        
        if (ASSET_MANIFEST.CONFIG.LOG_LOADING) {
            const loadedCount = Object.values(loaded).filter(t => t.diffuse).length;
            console.log(`[Assets] ✓ Loaded ${loadedCount} terrain textures`);
        }

        return loaded;
    }

    /**
     * Load skybox with automatic fallback to different skybox types
     * @param {string} skyboxName - Name from ASSET_MANIFEST.SKYBOX
     * @returns {Promise<BABYLON.CubeTexture|null>}
     */
    async loadSkybox(skyboxName = 'default') {
        const skyboxData = ASSET_MANIFEST.SKYBOX[skyboxName];
        if (!skyboxData) {
            console.warn(`[Assets] Skybox '${skyboxName}' not found in manifest`);
            return null;
        }

        const paths = [
            ASSET_MANIFEST.BASE_PATH + skyboxData.px,
            ASSET_MANIFEST.BASE_PATH + skyboxData.py,
            ASSET_MANIFEST.BASE_PATH + skyboxData.pz,
            ASSET_MANIFEST.BASE_PATH + skyboxData.nx,
            ASSET_MANIFEST.BASE_PATH + skyboxData.ny,
            ASSET_MANIFEST.BASE_PATH + skyboxData.nz
        ];

        try {
            // Try to load as cube texture
            const cubeTexture = new BABYLON.CubeTexture.CreateFromImages(paths, this.scene);
            
            if (ASSET_MANIFEST.CONFIG.LOG_LOADING) {
                console.log(`[Assets] ✓ Loaded skybox: ${skyboxName}`);
            }
            
            return cubeTexture;
        } catch (error) {
            console.warn(`[Assets] ✗ Failed to load skybox: ${skyboxName}`, error);
            
            // Try alternate skybox
            if (skyboxName !== 'default' && ASSET_MANIFEST.SKYBOX.default) {
                console.log(`[Assets] Trying default skybox...`);
                return this.loadSkybox('default');
            }
            
            return null;
        }
    }

    /**
     * Get a random variant of a prop
     * @param {string} propType - Type from ASSET_MANIFEST.PROPS
     * @param {string} propName - Name of the prop
     * @returns {string} - Model path to load
     */
    getRandomVariant(propType, propName) {
        const prop = ASSET_MANIFEST.PROPS[propType]?.[propName];
        if (!prop) return null;

        if (prop.variants && prop.variants.length > 0) {
            const variantName = prop.variants[Math.floor(Math.random() * prop.variants.length)];
            return `models/props/${variantName}.glb`;
        }

        return prop.model;
    }

    // ==================== INTERNAL LOADING ====================

    _loadTextureInternal(fullPath, options = {}) {
        return new Promise((resolve, reject) => {
            const texture = new BABYLON.Texture(
                fullPath,
                this.scene,
                !options.noMipmap,
                true, // invertY
                BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                () => {
                    // Success callback
                    if (ASSET_MANIFEST.CONFIG.TEXTURE_ANISOTROPY > 0) {
                        texture.anisotropicFilteringLevel = ASSET_MANIFEST.CONFIG.TEXTURE_ANISOTROPY;
                    }
                    resolve(texture);
                },
                (message, exception) => {
                    // Error callback
                    reject(new Error(message || 'Failed to load texture'));
                }
            );
        });
    }

    _loadModelInternal(fullPath, options = {}) {
        return new Promise((resolve, reject) => {
            const fileName = fullPath.substring(fullPath.lastIndexOf('/') + 1);
            const rootUrl = fullPath.substring(0, fullPath.lastIndexOf('/') + 1);

            BABYLON.SceneLoader.ImportMesh(
                '',
                rootUrl,
                fileName,
                this.scene,
                (meshes, particleSystems, skeletons, animationGroups) => {
                    // Success - hide original meshes
                    meshes.forEach(mesh => {
                        mesh.setEnabled(false);
                    });

                    resolve({
                        meshes,
                        particleSystems,
                        skeletons,
                        animationGroups,
                        rootUrl,
                        fileName
                    });
                },
                null, // Progress callback
                (scene, message, exception) => {
                    // Error callback
                    reject(new Error(message || 'Failed to load model'));
                }
            );
        });
    }

    _createModelInstance(modelData, options = {}) {
        if (!modelData || !modelData.meshes || modelData.meshes.length === 0) {
            return null;
        }

        const instances = [];
        let root = null;

        modelData.meshes.forEach((mesh, index) => {
            if (index === 0 || !mesh.parent) {
                // Root mesh - create instance
                root = mesh.createInstance('instance_' + Date.now() + '_' + index);
                root.setEnabled(true);
                instances.push(root);
            } else {
                // Child mesh - clone
                const clone = mesh.clone('clone_' + Date.now() + '_' + index);
                clone.parent = root;
                clone.setEnabled(true);
                instances.push(clone);
            }
        });

        // Apply position/rotation/scale from options
        if (root && options.position) {
            root.position = options.position.clone();
        }
        if (root && options.rotation) {
            root.rotation = options.rotation.clone();
        }
        if (root && options.scaling) {
            root.scaling = options.scaling.clone();
        }

        return {
            root,
            instances,
            animationGroups: modelData.animationGroups || []
        };
    }

    // ==================== PROCEDURAL FALLBACKS ====================

    createProceduralTerrain(typeName) {
        const colors = {
            grass: new BABYLON.Color3(0.3, 0.6, 0.3),
            dirt: new BABYLON.Color3(0.4, 0.3, 0.2),
            gravel: new BABYLON.Color3(0.5, 0.5, 0.5),
            sand: new BABYLON.Color3(0.8, 0.7, 0.4),
            snow: new BABYLON.Color3(0.9, 0.9, 0.95),
            rock: new BABYLON.Color3(0.5, 0.5, 0.5),
            mud: new BABYLON.Color3(0.3, 0.25, 0.2)
        };

        const material = new BABYLON.StandardMaterial('procedural_' + typeName, this.scene);
        material.diffuseColor = colors[typeName] || colors.grass;
        material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

        this.stats.procedural++;
        return material;
    }

    createProceduralSkybox() {
        const size = 1024;
        const skyTexture = new BABYLON.CubeTexture.CreateFromImages([], this.scene);
        
        // Create simple gradient skybox
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        const gradient = ctx.createLinearGradient(0, 0, 0, size);
        gradient.addColorStop(0, '#87CEEB');    // Sky blue
        gradient.addColorStop(0.7, '#E0F6FF');  // Light blue
        gradient.addColorStop(1, '#FFFFFF');    // White
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        this.stats.procedural++;
        
        if (ASSET_MANIFEST.CONFIG.LOG_LOADING) {
            console.log('[Assets] ⚙ Generated procedural skybox');
        }

        return skyTexture;
    }

    // ==================== UTILITIES ====================

    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.requested > 0 
                ? ((this.stats.loaded / this.stats.requested) * 100).toFixed(1) + '%'
                : '0%'
        };
    }

    printStats() {
        const stats = this.getStats();
        console.log('[Assets] Loading Statistics:');
        console.log(`  Requested: ${stats.requested}`);
        console.log(`  Loaded: ${stats.loaded}`);
        console.log(`  Failed: ${stats.failed}`);
        console.log(`  Procedural: ${stats.procedural}`);
        console.log(`  Success Rate: ${stats.successRate}`);
    }

    dispose() {
        // Dispose all loaded assets
        for (const [key, asset] of this.loadedAssets) {
            if (asset && typeof asset.dispose === 'function') {
                asset.dispose();
            }
        }
        this.loadedAssets.clear();
        this.loadingPromises.clear();
        this.failedAssets.clear();
        this.proceduralFallbacks.clear();
    }
}

window.AssetLoader = AssetLoader;
console.log('[Assets] AssetLoader v2.0 ready');
