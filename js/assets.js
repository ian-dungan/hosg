// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.10 (PATCHED)
// Fix: Ensured BASE_PATH is correct for GitHub Pages (/hosg/).
// Update: Defined models for Player, Enemy (Wolf), and Environment (Tree, Grass).
// ============================================================

// ==================== ASSET MANIFEST ====================
const ASSET_MANIFEST = {
    // CRITICAL FIX: Base path must include the /hosg/ subfolder for GitHub Pages
    BASE_PATH: "/hosg/assets/",
    
    CONFIG: {
        // Fallback or setup configurations
        FALLBACK_TO_PROCEDURAL: false,
    },
    
    CHARACTERS: {
        // Models for Player and NPCs
        'knight': { 
            model: 'Knight.glb', 
            required: true, 
            scale: 0.5,
            animations: {}
        },
        'wolf': { 
            model: 'Wolf.glb', 
            required: true, 
            scale: 0.5,
            animations: {}
        },
    },
    
    ENVIRONMENT: {
        // Models for world building
        'grass_tuft': { 
            model: 'GrassTuft.glb', 
            required: false, 
            scale: 1 
        },
        'tree_pine': { 
            model: 'TreePine.glb', 
            required: false, 
            scale: 0.5 
        },
        'terrain_base': { 
            model: 'TerrainBase.glb', 
            required: true, 
            scale: 1 // Assuming this is your main terrain mesh
        }
    }
};

// ==================== ASSET MANAGER CLASS ====================
class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.assets = {}; 
        this.stats = {
            requested: 0,
            loaded: 0
        };
        this.loader = new BABYLON.AssetsManager(scene);
        
        this.printStats = this.printStats.bind(this);
    }

    async loadAll() {
        console.log('[Assets] Starting asset load...');

        // Load Character Models
        for (const key in ASSET_MANIFEST.CHARACTERS) {
            const assetData = ASSET_MANIFEST.CHARACTERS[key];
            this.loadModel(assetData, key, 'CHARACTERS');
        }
        
        // Load Environment Assets
        for (const key in ASSET_MANIFEST.ENVIRONMENT) {
            const assetData = ASSET_MANIFEST.ENVIRONMENT[key];
            this.loadModel(assetData, key, 'ENVIRONMENT');
        }

        return new Promise((resolve, reject) => {
            this.loader.onFinish = (tasks) => {
                this.printStats();
                resolve(this.assets);
            };

            this.loader.onError = (task, message, exception) => {
                console.error(`[Assets] Critical Load Error: ${task.name}`, message);
                // We resolve even on error to allow the game to start if possible
                resolve(this.assets); 
            };

            this.loader.load();
        });
    }

    loadModel(assetData, key, category) {
        this.stats.requested++;
        const taskName = `${category}_${key}`;
        
        // Path construction: BASE_PATH + subfolder (e.g., 'models/') + model filename
        const modelPath = `${ASSET_MANIFEST.BASE_PATH}models/`; 
        
        const task = this.loader.addMeshTask(taskName, "", modelPath, assetData.model);
        task.required = assetData.required || false;
        
        task.onSuccess = (task) => {
            this.stats.loaded++;
            // The result is an array of meshes. We clone the root mesh later for instances.
            this.assets[taskName] = task.loadedMeshes; 
        };
        
        task.onError = (task, message, exception) => {
            console.warn(`[Assets] Failed to load ${taskName}. Check the path: ${modelPath}${assetData.model}`);
        };
    }
    
    getAsset(name) {
        return this.assets[name];
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
        console.log(`Success Rate: ${stats.successRate}`);
        console.log('================================');
    }
}

// Ensure the AssetManager class is globally accessible
window.AssetManager = AssetManager;
window.ASSET_MANIFEST = ASSET_MANIFEST;
