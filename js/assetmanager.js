// assets/AssetManager.js
class AssetManager {
  constructor() {
    this.assets = new Map();
    this.loadingPromises = [];
    this.manifest = null;
  }

  async loadManifest(url) {
    try {
      const response = await fetch(url);
      this.manifest = await response.json();
      return this.manifest;
    } catch (error) {
      console.error('Failed to load asset manifest:', error);
      throw error;
    }
  }

  loadTexture(scene, name, url, options = {}) {
    return new Promise((resolve, reject) => {
      const texture = new BABYLON.Texture(url, scene, null, false, null, () => {
        this.assets.set(name, texture);
        resolve(texture);
      }, (error) => {
        console.error(`Failed to load texture: ${url}`, error);
        reject(error);
      }, null, null, null, null, options);
    });
  }

  loadModel(scene, name, url) {
    return new Promise((resolve, reject) => {
      BABYLON.SceneLoader.ImportMesh('', '', url, scene, (meshes) => {
        this.assets.set(name, meshes);
        resolve(meshes);
      }, null, (scene, message) => {
        console.error(`Failed to load model: ${url}`, message);
        reject(message);
      });
    });
  }

  loadAudio(scene, name, url, options = {}) {
    return new Promise((resolve, reject) => {
      const sound = new BABYLON.Sound(name, url, scene, () => {
        this.assets.set(name, sound);
        resolve(sound);
      }, options);
    });
  }

  async loadAllAssets(scene) {
    if (!this.manifest) {
      throw new Error('Asset manifest not loaded. Call loadManifest() first.');
    }

    const promises = [];

    // Load textures
    for (const [category, items] of Object.entries(this.manifest.assets.textures)) {
      for (const [name, path] of Object.entries(items)) {
        promises.push(
          this.loadTexture(scene, `texture_${category}_${name}`, path)
            .catch(console.error)
        );
      }
    }

    // Load models
    for (const [category, items] of Object.entries(this.manifest.assets.models)) {
      for (const [subcategory, models] of Object.entries(items)) {
        for (const [name, path] of Object.entries(models)) {
          promises.push(
            this.loadModel(scene, `model_${category}_${subcategory}_${name}`, path)
              .catch(console.error)
          );
        }
      }
    }

    // Load audio
    for (const [category, items] of Object.entries(this.manifest.assets.audio)) {
      for (const [name, path] of Object.entries(items)) {
        promises.push(
          this.loadAudio(scene, `audio_${category}_${name}`, path)
            .catch(console.error)
        );
      }
    }

    await Promise.all(promises);
    return this.assets;
  }

  get(name) {
    return this.assets.get(name);
  }

  dispose() {
    for (const asset of this.assets.values()) {
      if (asset.dispose) {
        asset.dispose();
      }
    }
    this.assets.clear();
  }
}

// Export as a singleton
export const assetManager = new AssetManager();