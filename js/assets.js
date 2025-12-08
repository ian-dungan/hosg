// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.16 (DEFINITIVE TYPERROR FIX)
// Fix: Added explicit check for this.loader.tasks existence before reading its length.
// ============================================================

// ==================== ASSET MANIFEST ====================
// Safely retrieve MANIFEST_DATA from CONFIG.ASSETS
const getManifestData = () => {
    if (typeof CONFIG !== 'undefined' && CONFIG.ASSETS) {
        return CONFIG.ASSETS;
    }
    // Safe fallback structure
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
        this.loader = new BABYLON.AssetsManager(scene);
        
        this.printStats = this.printStats.bind(this);
    }

    async loadAll() {
        console.log('[Assets] Starting asset load...');

        // Defensive checks on the iteration object.
        const characters = MANIFEST_DATA.CHARACTERS || {}; 
        const environment = MANIFEST_DATA.ENVIRONMENT || {}; 

        // Load Character Models
        for (const key in characters) {
            const assetData = characters[key];
            this.loadModel(assetData, key, 'CHARACTERS');
        }
        
        // Load Environment Assets
        for (const key in environment) {
            const assetData = environment[key];
            this.loadModel(assetData, key, 'ENVIRONMENT');
        }
        
        // CRITICAL FIX: Ensure this.loader.tasks is defined before accessing length.
        this.stats.requested = (this.loader.tasks && this.loader.tasks.length) ? this.loader.tasks.length : 0;

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
                resolve(this.assets); 
            };
            
            this.loader.load();
        });
    }

    loadModel(assetData, key, category) {
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
