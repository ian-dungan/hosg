// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.9 (PATCHED)
// Combined manifest + loader in one file
// ============================================================

// ==================== ASSET MANIFEST ====================
const ASSET_MANIFEST = {
    // ... (Your existing ASSET_MANIFEST) ...
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
    }
    
    // ... (Your existing loadAll, loadModel, getMaterial, etc. methods) ...

    async loadAll() {
        console.log('[Assets] Starting asset load...');

        // Load Character Models
        for (const type in ASSET_MANIFEST.CHARACTERS) {
            for (const key in ASSET_MANIFEST.CHARACTERS[type]) {
                const assetData = ASSET_MANIFEST.CHARACTERS[type][key];
                this.loadModel(assetData, key, type);
            }
        }
        
        // Load Environment Assets
        for (const key in ASSET_MANIFEST.ENVIRONMENT) {
            const assetData = ASSET_MANIFEST.ENVIRONMENT[key];
            this.loadModel(assetData, key, 'ENVIRONMENT');
        }

        return new Promise((resolve, reject) => {
            this.loader.onFinish = (tasks) => {
                this.printStats();
                console.log(`[Assets] Asset system loaded (v${CONFIG.VERSION})`);
                resolve(true);
            };
            
            this.loader.onError = (task, message, exception) => {
                console.error(`[Assets] Asset loading error for ${task.name}: ${message}`, exception);
                if (task.required) {
                    reject(new Error(`Required asset failed to load: ${task.name}`));
                }
            };
            
            this.loader.load();
        });
    }

    loadModel(assetData, key, category) {
        if (!assetData.model) return;
        
        this.stats.requested++;
        const taskName = `${category}_${key}`;
        
        const task = this.loader.addMeshTask(taskName, "", ASSET_MANIFEST.BASE_PATH, assetData.model);
        task.required = assetData.required || false;
        
        task.onSuccess = (task) => {
            this.stats.loaded++;
            this.assets[taskName] = task.loadedMeshes;
            // Additional processing (scaling, positioning, animation setup) should happen here
        };
        
        task.onError = (task, message, exception) => {
            console.warn(`[Assets] Failed to load ${taskName}.`);
            if (ASSET_MANIFEST.CONFIG.FALLBACK_TO_PROCEDURAL && !task.required) {
                // Handle fallback if necessary
            }
        };
    }
    
    // ... (getAsset method) ...

    // ... (createMaterial, createProceduralSkybox, getStats, printStats methods) ...
}

// ============================================================
// PATCH: Ensure the AssetManager class is globally accessible
// ============================================================
window.AssetManager = AssetManager;
