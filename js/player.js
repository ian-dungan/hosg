// ============================================================\
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.31 (ASSET MANAGER FIX)
// Fix: Removed _initMesh from the constructor to prevent a crash before
//      the AssetManager is loaded. Added assetManager property.
// ============================================================\

class Player extends Character {
    constructor(scene) {
        // ... (existing config and super calls) ...
        
        // New property added in index.html, but defined here for clarity
        this.assetManager = null; 

        // !!! CRITICAL FIX: REMOVE THIS CALL from the constructor !!!
        // this._initMesh(); // <--- DELETE THIS LINE! 
        
        // ... (rest of constructor remains the same) ...
    }

    // _initMesh remains the same, but now it relies on `this.assetManager` being set 
    // and is called manually in index.html *after* assets are loaded.
    _initMesh() {
        // Now it's safe to use this.assetManager
        const assetData = CONFIG.ASSETS.CHARACTERS[this.className || 'knight'];
        const assetName = assetData.model.replace('.glb', '');
        
        // ... (rest of the _initMesh logic) ...
        
        // You may need to access the mesh via the assetManager, like:
        const playerMesh = this.assetManager.getAsset('characters_knight'); // Adjust based on your AssetManager naming
        
        // ... (rest of the _initMesh logic) ...
    }
    
    // ... (rest of Player class methods) ...
}
window.Player = Player;
