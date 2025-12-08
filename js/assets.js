// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.17 (CRITICAL LOADING FIX)
// Fix: Corrected loadAll to count requested assets and correctly start the AssetsManager.
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

        const characters = MANIFEST_DATA.CHARACTERS || {}; 
        const environment = MANIFEST_DATA.ENVIRONMENT || {}; 

        // Load Character Models
        for (const key in characters) {
            const assetData = characters[key];
            // CRITICAL FIX: Increment count
            this.stats.requested++; 
            this.loadModel(key, assetData, 'characters');
        }

        // Load Environment Models
        for (const key in environment) {
            const assetData = environment[key];
            // CRITICAL FIX: Increment count
            this.stats.requested++; 
            this.loadModel(key, assetData, 'environment');
        }

        if (this.stats.requested === 0) {
            console.log('[Assets] No assets defined to load.');
            return; 
        }
        
        // CRITICAL FIX: Start the asset loader and wait for completion
        return new Promise((resolve, reject) => {
            this.loader.onFinish = (tasks) => {
                console.log(`[Assets] Finished loading ${tasks.length} tasks.`);
                resolve(tasks);
            };
            this.loader.onError = (task, message, exception) => {
                console.error(`[Assets] Critical error during load of task ${task.name}: ${message}`, exception);
                reject(new Error(message));
            };
            // Start the loading process
            this.loader.load(); 
        });
    }

    loadModel(key, assetData, category) {
        const taskName = `${category}_${key}`;
        
        // Use the assetData.path if provided, otherwise use the global BASE_PATH
        const basePath = assetData.path || MANIFEST_DATA.BASE_PATH;
        
        const task = this.loader.addMeshTask(taskName, "", basePath, assetData.model);
        task.required = assetData.required || false; 

        task.onSuccess = (task) => {
            this.stats.loaded++;
            this.assets[taskName] = task.loadedMeshes;
            // Also store the loaded meshes under the base name without category prefix for easy access
            this.assets[key] = task.loadedMeshes; 
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

window.AssetManager = AssetManager;
