// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.10 (CONFIG PATHS)
// Update: AssetManager now reads all manifest data from CONFIG.ASSETS.
// Fix: loadModel now correctly uses custom 'path' defined in CONFIG.ASSETS.
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
        
        // Bind methods used as callbacks to the instance
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

        return new Promise((resolve, reject) => {
            // Set up success and error handling before calling load()
            this.loader.onFinish = (tasks) => {
                this.printStats();
                resolve(this.assets);
            };
            
            this.loader.onProgress = (remainingCount, totalCount, lastTask) => {
                // Optional: Update a loading bar/text here
                // console.log(`[Assets] Loading: ${totalCount - remainingCount}/${totalCount} - ${lastTask.name}`);
            };

            this.loader.onError = (task, message, exception) => {
                console.error(`[Assets] A task failed: ${task.name}. Message: ${message}`, exception);
                this.stats.requested = totalCount; // Set total for stats
                this.printStats(); // Print stats on error too
                // We resolve here even on error to prevent a total game crash if a non-required asset fails.
                resolve(this.assets); 
            };
            
            // Check if any tasks were added before running
            if (this.loader.tasks.length > 0) {
                this.stats.requested = this.loader.tasks.length;
                this.loader.load();
            } else {
                console.warn('[Assets] No assets defined to load.');
                resolve(this.assets);
            }
        });
    }

    loadModel(assetData, key, category) {
        // The unique name for asset retrieval (e.g., CHARACTERS_knight)
        const taskName = `${category}_${key}`;
        
        // Use the assetData.path if provided, otherwise use the global BASE_PATH
        const basePath = assetData.path || MANIFEST_DATA.BASE_PATH;
        
        const task = this.loader.addMeshTask(taskName, "", basePath, assetData.model);
        task.required = assetData.required || false; // Assume assets are not strictly required unless marked

        task.onSuccess = (task) => {
            this.stats.loaded++;
            this.assets[taskName] = task.loadedMeshes;
        };
        
        // Add specific error handling to the task itself for better console output
        task.onError = (task, message, exception) => {
            console.warn(`[Assets] Failed to load ${taskName}. Check the path: ${basePath}${assetData.model}`);
            // Do not reject the promise here; let the main loader.onError handle the overall completion
        };
    }
    
    // Helper to retrieve an asset by its full key (e.g., 'CHARACTERS_knight')
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
