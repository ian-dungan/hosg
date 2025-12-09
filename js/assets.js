// ============================================================
// HEROES OF SHADY GROVE - COMPLETE ASSET SYSTEM v1.0.18 (ES5)
// Converts the asset loader to ES5-compatible syntax so older
// environments don't choke on class/bind usage while keeping all
// existing loading stats, fallbacks, and manifest handling.
// ============================================================

// ==================== ASSET MANIFEST ====================
// Safely retrieve MANIFEST_DATA from CONFIG.ASSETS
function getManifestData() {
    if (typeof CONFIG !== 'undefined' && CONFIG.ASSETS) {
        return CONFIG.ASSETS;
    }
    // Safe fallback structure
    return {
        BASE_PATH: "assets/", // Changed fallback to relative
        CHARACTERS: {},
        ENVIRONMENT: {}
    };
}

var MANIFEST_DATA = getManifestData();

// ==================== ASSET MANAGER ====================
function AssetManager(scene) {
    this.scene = scene;
    this.assets = {};
    this.stats = {
        requested: 0,
        loaded: 0
    };

    // Guard against missing BABYLON or scene to avoid crashes in constrained contexts.
    if (typeof BABYLON !== 'undefined' && scene) {
        try {
            this.loader = new BABYLON.AssetsManager(scene);
            // Some constrained environments patch prototypes; make sure critical methods exist.
            if (!this.loader.load || !this.loader.addMeshTask) {
                throw new Error('AssetsManager incomplete');
            }
        } catch (err) {
            console.warn('[Assets] Failed to create AssetsManager; running without loader.', err);
            this.loader = null;
        }
    } else {
        this.loader = null;
    }

    // Preserve method bindings manually for legacy callers that detach helpers.
    var self = this;
    this.loadAll = function () { return AssetManager.prototype.loadAll.call(self); };
    this.loadAsset = function (key, assetData, category) {
        return AssetManager.prototype.loadAsset.call(self, key, assetData, category);
    };
    this.loadModel = function (key, assetData, category) {
        return AssetManager.prototype.loadModel.call(self, key, assetData, category);
    };
    this.printStats = function () { return AssetManager.prototype.printStats.call(self); };
}

AssetManager.prototype.loadAll = function () {
    console.log('[Assets] Starting asset load...');

    var characters = MANIFEST_DATA.CHARACTERS || {};
    var environment = MANIFEST_DATA.ENVIRONMENT || {};

    // Use whatever loader the runtime exposes (legacy callers expect
    // loadAsset, newer code calls loadModel). Manual binding above guarantees the
    // function exists even if detached from the instance.
    var loadFn = (typeof this.loadAsset === 'function')
        ? this.loadAsset
        : this.loadModel;

    // Load Character Models
    for (var key in characters) {
        var assetDataChar = characters[key];
        this.stats.requested++;
        loadFn(key, assetDataChar, 'characters');
    }

    // Load Environment Models
    for (var envKey in environment) {
        var assetDataEnv = environment[envKey];
        this.stats.requested++;
        loadFn(envKey, assetDataEnv, 'environment');
    }

    if (this.stats.requested === 0) {
        console.log('[Assets] No assets defined to load.');
        return;
    }

    var self = this;
    return new Promise(function (resolve) {
        if (!self.loader) {
            console.warn('[Assets] Babylon AssetsManager unavailable; skipping load.');
            resolve([]);
            return;
        }

        self.loader.onFinish = function (tasks) {
            console.log('[Assets] Finished loading ' + tasks.length + ' tasks.');
            resolve(tasks);
        };
        self.loader.onError = function (task) {
            console.warn('[Assets] Failed to load ' + task.name + '. Check the path: ' + task.url);
        };

        // Start the loading process
        self.loader.load();
    }).then(function () {
        self.printStats();
    });
};

// Legacy compatibility: some callers still expect a loadAsset helper
// that forwards to the mesh loader. Keep it as a thin wrapper to
// prevent "loadAsset is not a function" crashes during bootstrap.
AssetManager.prototype.loadAsset = function (key, assetData, category) {
    return this.loadModel(key, assetData, category);
};

AssetManager.prototype.loadModel = function (key, assetData, category) {
    if (!this.loader) {
        console.warn('[Assets] Loader unavailable; cannot load ' + category + ' asset ' + key + '.');
        return;
    }

    var safeData = assetData || {};
    var modelName = safeData.model;

    if (!modelName) {
        console.warn('[Assets] Missing model name for ' + category + ' asset ' + key + '. Skipping load.');
        return;
    }

    var taskName = category + '_' + key;
    var basePath = this._resolveRootPath(safeData.path);

    var task = this.loader.addMeshTask(taskName, "", basePath, modelName);
    task.required = safeData.required || false;

    var self = this;
    task.onSuccess = function (taskResult) {
        self.stats.loaded++;
        // Store by task name
        self.assets[taskName] = taskResult.loadedMeshes;
        // Store by simple config key (e.g., 'knight') for easy Player/World lookup
        self.assets[key] = taskResult.loadedMeshes;
        // Also store by the exact model filename (e.g., 'Knight03.glb') for more explicit lookups
        self.assets[modelName] = taskResult.loadedMeshes;
    };

    task.onError = function () {
        self.assets[taskName] = null;
        self.assets[key] = null;
        self.assets[modelName] = null;
    };
};

AssetManager.prototype._resolveRootPath = function (pathFromConfig) {
    var basePath = MANIFEST_DATA.BASE_PATH || '';
    var root = pathFromConfig || basePath;

    var isAbsolute = /^https?:\/\//.test(root) || root.indexOf('/') === 0;
    var alreadyHasBase = !isAbsolute && basePath && root.indexOf(basePath) === 0;

    if (!isAbsolute && !alreadyHasBase && basePath) {
        root = basePath + root;
    }

    if (root && root.charAt(root.length - 1) !== '/') {
        root += '/';
    }

    return root;
};

AssetManager.prototype.getAsset = function (name) {
    return this.assets[name] || null;
};

// ========== STATS ==========
AssetManager.prototype.getStats = function () {
    var successRate = this.stats.requested > 0 ?
        ((this.stats.loaded / this.stats.requested) * 100).toFixed(1) : 0;

    return {
        requested: this.stats.requested,
        loaded: this.stats.loaded,
        successRate: successRate + '%'
    };
};

AssetManager.prototype.printStats = function () {
    var stats = this.getStats();
    console.log('=== Asset Loading Statistics ===');
    console.log('Requested: ' + stats.requested);
    console.log('Loaded: ' + stats.loaded);
    console.log('Success Rate: ' + stats.successRate);
    console.log('================================');
};

window.AssetManager = AssetManager;
