// ===========================================================
// HEROES OF SHADY GROVE - ASSET MANAGER v2.0.0
// ===========================================================

// ============================================================
// CENTRALIZED ASSET PATH CONFIGURATION
// EDIT THIS SECTION TO CONFIGURE ALL ASSET PATHS
// This overrides any other asset path settings in the game
// ============================================================

const ASSET_PATHS = {
    // Base directory (relative to index.html)
    BASE: "assets/",
    
    // Subdirectories - edit these to match your structure
    FOLDERS: {
        PLAYER: "player/",
        ENEMIES: "enemies/",
        NPCS: "npcs/",
        MODELS: "models/",
        ENVIRONMENT: "environment/",
        ANIMATIONS: "animations/",
        SFX: "sfx/"
    },
    
    // Player character models
    PLAYER_MODELS: {
        knight: "knight03.glb"  // Fixed: match actual filename (no dot)
        // Add more: mage: "mage.01.glb"
    },
    
    // Enemy models
    ENEMY_MODELS: {
        wolf: "wolf.glb",
        goblin: "goblin.glb"
    },
    
    // NPC models (friendly characters)
    NPC_MODELS: {
        // Example: villager: "villager_01.glb"
    },
    
    // Generic models (shared objects)
    GENERIC_MODELS: {
        tree_pine: "tree_pine.gltf",
        tree_oak: "tree_oak.gltf",
        tree_birch: "tree_birch.gltf",
        rock: "rock.gltf"
        // Add your .gltf or .glb tree models here
    },
    
    // Environment textures (all in environment folder)
    TEXTURES: {
        sky_hdri: "DaySkyHDRI023B_4K_TONEMAPPED.jpg",
        grass: "Grass004_2K-JPG_Color.jpg",
        water_bump: "water_bump.jpg",
        rain: "rain.jpg",
        snowflake: "snowflake.jpg"
    },
    
    // Helper functions to build full paths
    getPlayerPath: function(modelKey) {
        if (!this.PLAYER_MODELS[modelKey]) return null;
        return this.BASE + this.FOLDERS.PLAYER + this.PLAYER_MODELS[modelKey];
    },
    
    getEnemyPath: function(modelKey) {
        if (!this.ENEMY_MODELS[modelKey]) return null;
        return this.BASE + this.FOLDERS.ENEMIES + this.ENEMY_MODELS[modelKey];
    },
    
    getNPCPath: function(modelKey) {
        if (!this.NPC_MODELS[modelKey]) return null;
        return this.BASE + this.FOLDERS.NPCS + this.NPC_MODELS[modelKey];
    },
    
    getModelPath: function(modelKey) {
        if (!this.GENERIC_MODELS[modelKey]) return null;
        return this.BASE + this.FOLDERS.MODELS + this.GENERIC_MODELS[modelKey];
    },
    
    getTexturePath: function(textureKey) {
        if (!this.TEXTURES[textureKey]) return null;
        return this.BASE + this.FOLDERS.ENVIRONMENT + this.TEXTURES[textureKey];
    },
    
    // Get any asset path by category and key
    getPath: function(category, key) {
        switch(category) {
            case 'player': return this.getPlayerPath(key);
            case 'enemy': return this.getEnemyPath(key);
            case 'npc': return this.getNPCPath(key);
            case 'model': return this.getModelPath(key);
            case 'texture': return this.getTexturePath(key);
            default: 
                console.warn('[AssetPaths] Unknown category:', category);
                return null;
        }
    }
};

// Make globally available
window.ASSET_PATHS = ASSET_PATHS;

// ============================================================
// ASSET MANAGER CLASS
// Handles loading and caching of 3D models
// ============================================================

class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.assets = {}; // Loaded assets cache
        this.stats = { 
            requested: 0, 
            loaded: 0, 
            failed: 0 
        };
        this.loader = new BABYLON.AssetsManager(scene);
        
        console.log('[Assets] Manager initialized');
        console.log('[Assets] Base path:', ASSET_PATHS.BASE);
    }

    async loadAll() {
        console.log('[Assets] Starting asset load...');
        
        // Load all player models
        for (const key in ASSET_PATHS.PLAYER_MODELS) {
            this.stats.requested++;
            this.loadModel('player', key);
        }
        
        // Load all enemy models
        for (const key in ASSET_PATHS.ENEMY_MODELS) {
            this.stats.requested++;
            this.loadModel('enemy', key);
        }
        
        // Load all NPC models
        for (const key in ASSET_PATHS.NPC_MODELS) {
            this.stats.requested++;
            this.loadModel('npc', key);
        }
        
        // Load all generic models
        for (const key in ASSET_PATHS.GENERIC_MODELS) {
            this.stats.requested++;
            this.loadModel('model', key);
        }
        
        return new Promise((resolve) => {
            if (this.stats.requested === 0) {
                console.log('[Assets] No assets to load');
                resolve();
                return;
            }
            
            this.loader.onFinish = (tasks) => {
                console.log(`[Assets] Load complete. ${this.stats.loaded}/${this.stats.requested} succeeded, ${this.stats.failed} failed`);
                resolve();
            };
            
            this.loader.load();
        });
    }
    
    loadModel(category, key) {
        const fullPath = ASSET_PATHS.getPath(category, key);
        
        if (!fullPath) {
            console.error(`[Assets] Could not build path for ${category}.${key}`);
            this.stats.failed++;
            return;
        }
        
        // Split path into directory and filename for Babylon loader
        const lastSlash = fullPath.lastIndexOf('/');
        const directory = fullPath.substring(0, lastSlash + 1);
        const filename = fullPath.substring(lastSlash + 1);
        
        const taskName = `load_${category}_${key}`;
        const task = this.loader.addMeshTask(taskName, "", directory, filename);
        
        task.onSuccess = (task) => {
            this.stats.loaded++;
            
            // Cache by both key and filename
            this.assets[key] = task.loadedMeshes;
            this.assets[filename] = task.loadedMeshes;
            
            // Disable loaded meshes (they'll be cloned when needed)
            task.loadedMeshes.forEach(mesh => {
                mesh.setEnabled(false);
                mesh.isPickable = true;
            });
            
            console.log(`[Assets] ✓ Loaded ${category}:`, key);
        };
        
        task.onError = (task, message, exception) => {
            this.stats.failed++;
            console.error(`[Assets] ✗ Failed to load ${category}: ${key}`);
            console.error(`[Assets]   Path: ${fullPath}`);
            console.error(`[Assets]   Error:`, message);
        };
    }
    
    getAsset(key) {
        return this.assets[key] || null;
    }
    
    hasAsset(key) {
        return !!this.assets[key];
    }
    
    cloneAsset(key, newName) {
        const asset = this.getAsset(key);
        if (!asset) {
            console.warn('[Assets] Cannot clone, asset not found:', key);
            return null;
        }
        
        const clonedMeshes = [];
        asset.forEach(mesh => {
            const cloned = mesh.clone(newName + "_" + mesh.name, null);
            cloned.setEnabled(true);
            clonedMeshes.push(cloned);
        });
        
        return clonedMeshes;
    }
    
    // Load a texture (for terrain, water, etc.)
    loadTexture(path, options = {}) {
        return new Promise((resolve, reject) => {
            if (!path) {
                console.warn('[Assets] No texture path provided');
                resolve(null);
                return;
            }
            
            try {
                const texture = new BABYLON.Texture(
                    path, 
                    this.scene,
                    false,  // noMipmap = false (use mipmaps for better quality)
                    true,   // invertY
                    BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                    () => {
                        // onLoad callback
                        console.log(`[Assets] ✓ Texture loaded: ${path}`);
                        resolve(texture);
                    },
                    () => {
                        // onError callback
                        console.warn(`[Assets] ✗ Failed to load texture: ${path}`);
                        resolve(null); // Resolve with null instead of reject
                    }
                );
                
                // Apply scaling if provided
                if (options.uScale) texture.uScale = options.uScale;
                if (options.vScale) texture.vScale = options.vScale;
                
            } catch (error) {
                console.error('[Assets] Error creating texture:', error);
                resolve(null);
            }
        });
    }
    
    // Load a model directly (for NPCs, enemies, etc.)
    async loadModel(path, options = {}) {
        if (!path) {
            console.warn('[Assets] No model path provided');
            return null;
        }
        
        try {
            // Split path into directory and filename
            const lastSlash = path.lastIndexOf('/');
            const directory = lastSlash >= 0 ? path.substring(0, lastSlash + 1) : '';
            const filename = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
            
            console.log(`[Assets] Loading model: ${path}`);
            
            const result = await BABYLON.SceneLoader.ImportMeshAsync(
                '',
                directory,
                filename,
                this.scene
            );
            
            // Apply scaling if provided
            if (options.scaling && result.meshes[0]) {
                result.meshes[0].scaling = options.scaling;
            }
            
            console.log(`[Assets] ✓ Model loaded: ${path} (${result.meshes.length} meshes)`);
            return result;
            
        } catch (error) {
            console.error(`[Assets] ✗ Failed to load model: ${path}`, error);
            return null;
        }
    }
    
    dispose() {
        for (const key in this.assets) {
            const meshes = this.assets[key];
            if (Array.isArray(meshes)) {
                meshes.forEach(mesh => mesh.dispose());
            }
        }
        this.assets = {};
        console.log('[Assets] Disposed');
    }
}

window.AssetManager = AssetManager;
// Alias for backward compatibility with World.js
window.AssetLoader = AssetManager;
