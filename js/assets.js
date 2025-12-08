// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.12 (CRITICAL LOGIC FIX)
// Fix: Corrected MANIFEST_DATA initialization and loadAll iteration to match CONFIG.ASSETS structure.
// ============================================================

// ==================== ASSET MANIFEST ====================
// Use the CONFIG.ASSETS block, falling back to a minimal default if CONFIG is not available
const MANIFEST_DATA = (typeof CONFIG !== 'undefined' && CONFIG.ASSETS) ? CONFIG.ASSETS : {
    BASE_PATH: "/hosg/assets/models/", 
    CHARACTERS: {},
    ENVIRONMENT: {}
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

        // Load Character Models - Iterate directly over MANIFEST_DATA.CHARACTERS keys
        for (const key in MANIFEST_DATA.CHARACTERS) {
            const assetData = MANIFEST_DATA.CHARACTERS[key];
            this.loadModel(assetData, key, 'CHARACTERS');
        }
        
        // Load Environment Assets - Iterate directly over MANIFEST_DATA.ENVIRONMENT keys
        for (const key in MANIFEST_DATA.ENVIRONMENT) {
            const assetData = MANIFEST_DATA.ENVIRONMENT[key];
            this.loadModel(assetData, key, 'ENVIRONMENT');
        }
        
        // This is the total count of assets we've added to the loader
        this.stats.requested = this.loader.tasks.length;

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
            
            if (this.loader.tasks.length > 0) {
                this.loader.load();
            } else {
                console.warn('[Assets] No assets defined to load.');
                resolve(this.assets);
            }
        });
    }

    loadModel(assetData, key, category) {
        const taskName = `${category}_${key}`;
        
        // Use the assetData.path if provided, otherwise use the global BASE_PATH
        const basePath = assetData.path || MANIFEST_DATA.BASE_PATH;
        
        // Note: Babylon.js requires a root URL (basePath), and the filename (assetData.model)
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
