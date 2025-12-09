// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.18 (ASSET KEY FIX)
// Fix: Explicitly stores loaded assets under their simple config key name.
// ============================================================

// ==================== ASSET MANIFEST ====================
// Safely retrieve MANIFEST_DATA from CONFIG.ASSETS
const getManifestData = () => {
    if (typeof CONFIG !== 'undefined' && CONFIG.ASSETS) {
        return CONFIG.ASSETS;
    }
    // Safe fallback structure
    return {
        BASE_PATH: "assets/", // Changed fallback to relative
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
            this.stats.requested++; 
            this.loadModel(key, assetData, 'characters');
        }

        // Load Environment Models
        for (const key in environment) {
            const assetData = environment[key];
            this.stats.requested++; 
            this.loadModel(key, assetData, 'environment');
        }

        if (this.stats.requested === 0) {
            console.log('[Assets] No assets defined to load.');
            return; 
        }
        
        return new Promise((resolve, reject) => {
            this.loader.onFinish = (tasks) => {
                console.log(`[Assets] Finished loading ${tasks.length} tasks.`);
                resolve(tasks);
            };
            this.loader.onError = (task, message, exception) => {
                console.warn(`[Assets] Failed to load ${task.name}. Check the path: ${task.url}`);
            };
            
            // Start the loading process
            this.loader.load(); 
        }).then(() => {
            this.printStats();
        });
    }

    loadModel(key, assetData, category) {
        const taskName = `${category}_${key}`;

        const basePath = this._resolveRootPath(assetData.path);

        const task = this.loader.addMeshTask(taskName, "", basePath, assetData.model);
        task.required = assetData.required || false;

        task.onSuccess = (task) => {
            this.stats.loaded++;
            // Store by task name
            this.assets[taskName] = task.loadedMeshes;
            // Store by simple config key (e.g., 'knight') for easy Player/World lookup
            this.assets[key] = task.loadedMeshes; 
            // Also store by the exact model filename (e.g., 'Knight03.glb') for more explicit lookups
            this.assets[assetData.model] = task.loadedMeshes; 
        };
        
        task.onError = (task, message, exception) => {
            this.assets[taskName] = null;
            this.assets[key] = null;
            this.assets[assetData.model] = null;
        };
    }

    _resolveRootPath(pathFromConfig) {
        const basePath = MANIFEST_DATA.BASE_PATH || '';
        let root = pathFromConfig || basePath;

        const isAbsolute = /^https?:\/\//.test(root) || root.startsWith('/');
        const alreadyHasBase = !isAbsolute && basePath && root.startsWith(basePath);

        if (!isAbsolute && !alreadyHasBase && basePath) {
            root = basePath + root;
        }

        if (root && !root.endsWith('/')) {
            root += '/';
        }

        return root;
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
