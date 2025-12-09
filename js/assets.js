// ===========================================================
// HEROES OF SHADY GROVE - ASSET MANAGER v1.1.0 (ENHANCED)
// Now supports ENEMIES category and per-asset custom paths
// ===========================================================

const getManifestData = () => {
    if (typeof CONFIG !== 'undefined' && CONFIG.ASSETS) {
        return CONFIG.ASSETS;
    }
    console.warn('[Assets] CONFIG not loaded, using defaults');
    return {
        BASE_PATH: "assets/",
        CHARACTERS: {},
        ENVIRONMENT: {}
    };
};
const MANIFEST_DATA = getManifestData();

class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.assets = {}; 
        this.stats = { requested: 0, loaded: 0, failed: 0 };
        this.loader = new BABYLON.AssetsManager(scene);
    }

    async loadAll() {
        console.log('[Assets] Starting asset load...');

        const characters = MANIFEST_DATA.CHARACTERS || {}; 
        const enemies = MANIFEST_DATA.ENEMIES || {};
        const environment = MANIFEST_DATA.ENVIRONMENT || {}; 
        const items = MANIFEST_DATA.ITEMS || {};
        const weapons = MANIFEST_DATA.WEAPONS || {};
        const armor = MANIFEST_DATA.ARMOR || {};

        // Load characters
        for (const key in characters) {
            const assetData = characters[key];
            this.stats.requested++; 
            this.loadAsset(key, assetData, 'CHARACTERS');
        }

        // Load enemies
        for (const key in enemies) {
            const assetData = enemies[key];
            this.stats.requested++; 
            this.loadAsset(key, assetData, 'ENEMIES');
        }

        // Load environment
        for (const key in environment) {
            const assetData = environment[key];
            this.stats.requested++; 
            this.loadAsset(key, assetData, 'ENVIRONMENT');
        }

        // Load items
        for (const key in items) {
            const assetData = items[key];
            this.stats.requested++; 
            this.loadAsset(key, assetData, 'ITEMS');
        }

        // Load weapons
        for (const key in weapons) {
            const assetData = weapons[key];
            this.stats.requested++; 
            this.loadAsset(key, assetData, 'WEAPONS');
        }

        // Load armor
        for (const key in armor) {
            const assetData = armor[key];
            this.stats.requested++; 
            this.loadAsset(key, assetData, 'ARMOR');
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

    loadAsset(key, assetData, category) {
        const taskName = "load_" + key;
        
        // Use CONFIG.ASSETS.getAssetPath to get full path
        const fullPath = CONFIG.ASSETS.getAssetPath(category, key);
        
        if (!fullPath) {
            console.error(`[Assets] Could not determine path for ${category}.${key}`);
            this.stats.failed++;
            return;
        }
        
        // Extract directory and filename from full path
        const lastSlash = fullPath.lastIndexOf('/');
        const directory = fullPath.substring(0, lastSlash + 1);
        const filename = fullPath.substring(lastSlash + 1);
        
        const task = this.loader.addMeshTask(taskName, "", directory, filename);
        
        task.onSuccess = (task) => {
            this.stats.loaded++;
            this.assets[key] = task.loadedMeshes; 
            this.assets[assetData.model] = task.loadedMeshes; 
            task.loadedMeshes.forEach(mesh => {
                mesh.setEnabled(false);
                mesh.isPickable = true;
            });
            console.log(`[Assets] Loaded: ${key} from ${category}`);
        };
        
        task.onError = (task, message, exception) => {
            this.stats.failed++;
            console.error(`[Assets] Failed to load ${key} from ${fullPath}:`, message);
        };
    }
    
    getAsset(name) {
        return this.assets[name] || null;
    }
}
window.AssetManager = AssetManager;
