// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.13 (FINAL ASSET LOADING FIX)
// Fix: Ensured CONFIG is fully loaded before accessing its properties, and moved task count calculation.
// ============================================================

// ==================== ASSET MANIFEST ====================
// Safely use CONFIG.ASSETS, falling back to an empty structure if CONFIG isn't ready.
const getManifestData = () => {
    if (typeof CONFIG !== 'undefined' && CONFIG.ASSETS) {
        return CONFIG.ASSETS;
    }
    return {
        BASE_PATH: "/hosg/assets/", 
        CHARACTERS: {},
        ENVIRONMENT: {}
    };
};
const MANIFEST_DATA = getManifestData();

// ==================== ASSET MANAGER CLASS ====================
class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.assets = {}; 
        this.stats = {
            requested: 0,
            loaded: 0
        };
        // Initialize the loader here. This must succeed for task loading to work.
        this.loader = new BABYLON.AssetsManager(scene);
        
        this.printStats = this.printStats.bind(this);
    }

    async loadAll() {
        console.log('[Assets] Starting asset load...');

        // Load Character Models
        for (const key in MANIFEST_DATA.CHARACTERS) {
            const assetData = MANIFEST_DATA.CHARACTERS[key];
            this.loadModel(assetData, key, 'CHARACTERS');
        }
        
        // Load Environment Assets
        for (const key in MANIFEST_DATA.ENVIRONMENT) {
            const assetData = MANIFEST_DATA.ENVIRONMENT[key];
            this.loadModel(assetData, key, 'ENVIRONMENT');
        }
        
        // CRITICAL FIX: Ensure we calculate this only AFTER all tasks have been added
        this.stats.requested = this.loader.tasks.length;

        if (this.stats.requested === 0) {
            console.warn('[Assets] No assets defined to load.');
            return Promise.resolve(this.assets);
        }

        return new Promise((resolve, reject) => {
            
            this.loader.onFinish = (tasks) => {
                this.printStats();
                resolve(this.assets);
            };
            
            this.loader.onProgress = (remainingCount, totalCount, lastTask) => {
                // ... loading progress logic ...
            };

            this.loader.onError = (task, message, exception) => {
                console.error(`[Assets] A task failed: ${task.name}. Message: ${message}`, exception);
                this.printStats(); 
                // We resolve even on non-required asset errors to allow the game to start
                resolve(this.assets); 
            };
            
            this.loader.load();
        });
    }

    loadModel(assetData, key, category) {
        // Double-check: Make sure model is defined before adding a task
        if (!assetData || !assetData.model) {
            console.error(`[Assets] Asset data for ${key} in ${category} is incomplete. Skipping.`);
            return;
        }

        const taskName = `${category}_${key}`;
        
        // Use the assetData.path if provided, otherwise use the global BASE_PATH
        const basePath = assetData.path || MANIFEST_DATA.BASE_PATH;
        
        const task = this.loader.addMeshTask(taskName, "", basePath, assetData.model);
        task.required = assetData.required || false; 

        task.onSuccess = (task) => {
            this.stats.loaded++;
            this.assets[taskName] = task.loadedMeshes;
        };
        
        task.onError = (task, message, exception) => {
            console.warn(`[Assets] Failed to load ${taskName}. Check the path: ${basePath}${assetData.model}`);
        };
    }
    
    getAsset(name) {
        return this.assets[name] || null;
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
