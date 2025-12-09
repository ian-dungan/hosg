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
        this.stats = {
            requested: 0,
            loaded: 0
        };
        this.loader = new BABYLON.AssetsManager(scene);

        // Preserve method bindings so loadAll can safely call helpers even if
        // the context is lost or older code grabs these functions directly.
        this.loadAll = this.loadAll.bind(this);
        this.loadAsset = this.loadAsset.bind(this);
        this.loadModel = this.loadModel.bind(this);
        this.printStats = this.printStats.bind(this);
    }

    async loadAll() {
        console.log('[Assets] Starting asset load...');

        const characters = MANIFEST_DATA.CHARACTERS || {};
        const environment = MANIFEST_DATA.ENVIRONMENT || {};

        // Use whatever loader the runtime exposes (legacy callers expect
        // loadAsset, newer code calls loadModel). Binding above guarantees the
        // function exists even if detached from the instance.
        const loadFn = (typeof this.loadAsset === 'function')
            ? this.loadAsset
            : this.loadModel;

        // Load characters
        for (const key in characters) {
            const assetData = characters[key];
            this.stats.requested++;
            loadFn(key, assetData, 'characters');
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
            loadFn(key, assetData, 'environment');
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

    // Legacy compatibility: some callers still expect a loadAsset helper
    // that forwards to the mesh loader. Keep it as a thin wrapper to
    // prevent "loadAsset is not a function" crashes during bootstrap.
    loadAsset(key, assetData, category) {
        return this.loadModel(key, assetData, category);
    }

    loadModel(key, assetData, category) {
        const safeData = assetData || {};
        const modelName = safeData.model;

        if (!modelName) {
            console.warn(`[Assets] Missing model name for ${category} asset '${key}'. Skipping load.`);
            return;
        }

        const taskName = `${category}_${key}`;

        const basePath = this._resolveRootPath(safeData.path);

        const task = this.loader.addMeshTask(taskName, "", basePath, modelName);
        task.required = safeData.required || false;

        task.onSuccess = (task) => {
            this.stats.loaded++;
            this.assets[key] = task.loadedMeshes; 
            // Also store by the exact model filename (e.g., 'Knight03.glb') for more explicit lookups
            this.assets[modelName] = task.loadedMeshes;
        };

        task.onError = (task, message, exception) => {
            this.assets[taskName] = null;
            this.assets[key] = null;
            this.assets[modelName] = null;
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
}
window.AssetManager = AssetManager;
