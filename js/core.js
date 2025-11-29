// ====================== CONFIG.JS ======================
const CONFIG = {
    VERSION: '1.0.0',
    DEBUG: true,
    GAME: { FPS: 60, GRAVITY: 9.81, PHYSICS_ENGINE: 'cannon' },
    PLAYER: { MOVE_SPEED: 0.1, RUN_MULTIPLIER: 1.8, JUMP_FORCE: 0.2, HEALTH: 100, STAMINA: 100, INVENTORY_SIZE: 20 },
    WORLD: { SIZE: 1000, CHUNK_SIZE: 32, TERRAIN_SIZE: 1024, WATER_LEVEL: 0 },
    NETWORK: {
        MAX_PLAYERS: 100,
        TICK_RATE: 20,
        TIMEOUT: 30000,
        WS_URL: null,
        RECONNECT_DELAY_MS: 5000
    }
};

// ====================== ASSETMANAGER.JS ======================
class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.assets = new Map();
        this.queue = [];
        this.loading = false;
    }

    addToQueue(name, url, type = 'texture', options = {}) {
        this.queue.push({ name, url, type, options });
    }

    async loadAll() {
        if (this.loading) return;
        this.loading = true;
        
        for (const {name, url, type, options} of this.queue) {
            try {
                await this.loadAsset(name, url, type, options);
            } catch (error) {
                console.error(`Failed to load ${name}:`, error);
            }
        }
        this.loading = false;
    }

    loadAsset(name, url, type) {
        return new Promise((resolve, reject) => {
            try {
                let asset;
                switch (type.toLowerCase()) {
                    case 'texture':
                        asset = new BABYLON.Texture(url, this.scene);
                        break;
                    case 'mesh':
                        BABYLON.SceneLoader.ImportMesh('', '', url, this.scene, 
                            (meshes) => resolve(this.assets.set(name, meshes)),
                            null, 
                            (_, msg) => reject(new Error(`Mesh load failed: ${msg}`))
                        );
                        return;
                    default:
                        return reject(new Error(`Unsupported type: ${type}`));
                }
                asset.onLoadObservable.add(() => {
                    this.assets.set(name, asset);
                    resolve(asset);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    get(name) { return this.assets.get(name); }
    dispose() { 
        this.assets.forEach(asset => asset.dispose?.()); 
        this.assets.clear(); 
    }
}



if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
    window.AssetManager = AssetManager;
}
