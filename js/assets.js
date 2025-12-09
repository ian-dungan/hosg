// ===========================================================
// HEROES OF SHADY GROVE - ASSET MANAGER v1.0.1 (FIXED)
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
        const environment = MANIFEST_DATA.ENVIRONMENT || {}; 

        for (const key in characters) {
            const assetData = characters[key];
            this.stats.requested++; 
            this.loadModel(key, assetData, 'characters/');
        }

        for (const key in environment) {
            const assetData = environment[key];
            this.stats.requested++; 
            this.loadModel(key, assetData, 'environment/');
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

    loadModel(key, assetData, subFolder) {
        const taskName = "load_" + key;
        const fullPath = MANIFEST_DATA.BASE_PATH + subFolder; 
        
        const task = this.loader.addMeshTask(taskName, "", fullPath, assetData.model);
        
        task.onSuccess = (task) => {
            this.stats.loaded++;
            this.assets[key] = task.loadedMeshes; 
            this.assets[assetData.model] = task.loadedMeshes; 
            task.loadedMeshes.forEach(mesh => {
                mesh.setEnabled(false);
                mesh.isPickable = true;
            });
            console.log(`[Assets] Loaded: ${key}`);
        };
        
        task.onError = (task, message, exception) => {
            this.stats.failed++;
            console.error(`[Assets] Failed to load ${key} from ${fullPath}${assetData.model}:`, message);
        };
    }
    
    getAsset(name) {
        return this.assets[name] || null;
    }
}
window.AssetManager = AssetManager;
