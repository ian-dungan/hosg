// ============================================================\
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.33 (CRITICAL CONFIG MESH FIX)
// Fix: Updated _initMesh to use the correctly nested CONFIG.ASSETS.CLASSES path.
// ============================================================\

class Player extends Character {
    // ... (constructor remains the same, but it no longer calls _initMesh) ...

    // --- Mesh and Visuals ---

    _initMesh() {
        if (!this.assetManager) {
            console.error("[Player] Cannot initialize mesh: AssetManager is not assigned to player.");
            return;
        }

        // 1. Get the class config using the correct path
        // The player defaults to the 'Warrior' class model if this.className is null
        const className = this.className || 'Warrior';
        // ** CRITICAL FIX: Use the new CONFIG path **
        const classConfig = CONFIG.ASSETS.CLASSES[className]; 

        if (!classConfig) {
            console.error(`[Player] Class configuration not found for: ${className}`);
            return;
        }

        // 2. Resolve the asset key ('knight' or 'wolf') from the class model property
        // classConfig.model will be 'knight' for Warrior, Rogue, etc.
        const assetModelKey = classConfig.model;
        
        // AssetManager keys are generally 'category_assetName', e.g., 'characters_knight'
        const assetKey = 'characters_' + assetModelKey; 
        
        const meshes = this.assetManager.getAsset(assetKey);
        
        if (!meshes || meshes.length === 0) {
            console.error(`[Player] Failed to load mesh for asset: ${assetKey}. AssetManager load failed or key is wrong.`);
            return;
        }

        // ... (rest of _initMesh logic is fine, assuming it correctly handles meshes) ...
        
        // Clone the root mesh for the player instance
        this.mesh = meshes[0].clone(this.name + "_mesh", null, true);
        if (!this.mesh) {
            console.error("[Player] Failed to clone player mesh.");
            return;
        }
        
        this.mesh.parent = null; 
        this.mesh.isPickable = true;
        this.mesh.checkCollisions = true;
        this.mesh.position.copyFrom(this.position);
        
        // Hide the original asset meshes
        meshes.forEach(m => m.setEnabled(false));

        this._initCollisionMesh(this.mesh); 
        this._updateCameraPosition();
        
        // ... (rest of the Player class) ...
    }
    
    // ... (rest of the Player class) ...
}
window.Player = Player;
