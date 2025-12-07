// ============================================================
// HEROES OF SHADY GROVE - WORLD CORE v1.0.12 (PATCHED)
// Fix: Added null/undefined checks for spawnData properties.
// ============================================================

// Base Entity class
function Entity(scene, position) {
    // ... (Entity class remains the same) ...
}

Entity.prototype.update = function (deltaTime) {
    // ... (update method remains the same) ...
};

Entity.prototype.dispose = function () {
    // ... (dispose method remains the same) ...
};


// ============================================================
// CHARACTER CLASS (Base for Player and Enemy)
// (Assuming this is complete and correct)
// ============================================================
class Character extends Entity {
    // ... (Character class remains the same) ...
}


// ============================================================
// ENEMY CLASS (Simple placeholder for spawns)
// (Assuming this is complete and correct)
// ============================================================
class Enemy extends Character {
    // ... (Enemy class remains the same) ...
}


// ============================================================
// Loot Container (Placeholder)
// (Assuming this is complete and correct)
// ============================================================
class LootContainer extends Entity {
    // ... (LootContainer class remains the same) ...
}

// World Class
class World {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.options = {
            size: options.size || CONFIG.WORLD.SIZE,
            // ... other options
        };

        this.npcs = [];
        this.loots = [];
        this.activeSpawns = new Map(); 
        
        this.createTerrain();
        this.createWater();
    }

    // Creates a simple ground plane
    createTerrain() {
        // ... (createTerrain method remains the same) ...
    }
    
    // Creates a simple water plane
    createWater() {
        // ... (createWater method remains the same) ...
    }

    /**
     * @param {Array<Object>} spawnPoints - Array of spawn records from Supabase
     * @param {Map<string, Object>} npcTemplates - Map of NPC templates (code -> template)
     */
    loadSpawns(spawnPoints, npcTemplates) {
        console.log(`[World] Loading ${spawnPoints.length} spawn points.`);
        
        this.npcs.forEach(npc => npc.dispose());
        this.npcs = [];
        this.activeSpawns.clear();

        spawnPoints.forEach(spawnData => {
            // === PATCH: Skip if critical data is missing (e.g., if npc_code is undefined/null in DB) ===
            if (!spawnData.npc_code || typeof spawnData.position_x === 'undefined' || typeof spawnData.position_z === 'undefined') {
                console.warn(`[World] Invalid spawn data (missing npc_code or position). Skipping spawn.`);
                return;
            }
            // ===========================================================================================
            
            const template = npcTemplates.get(spawnData.npc_code);
            
            if (!template) {
                console.warn(`[World] NPC template not found for code: ${spawnData.npc_code}. Skipping spawn.`);
                return;
            }
            
            this.activeSpawns.set(spawnData.id, []);
            
            // Create initial spawns up to max_spawn
            for (let i = 0; i < (spawnData.max_spawn || 1); i++) { // Default to 1 if max_spawn is undefined
                this.trySpawn(spawnData, template);
            }
            
            // Set up a permanent respawn loop (only if respawn_seconds is set)
            if (spawnData.respawn_seconds > 0) {
                 setInterval(() => {
                    this.trySpawn(spawnData, template);
                }, spawnData.respawn_seconds * 1000);
            }
        });
    }
    
    trySpawn(spawnData, template) {
        const currentEntities = this.activeSpawns.get(spawnData.id).filter(e => !e.isDead);
        
        if (currentEntities.length >= (spawnData.max_spawn || 1)) return false; 
        
        const angle = Math.random() * Math.PI * 2;
        // === PATCH: Ensured spawn_radius has a default fallback (e.g., 5) ===
        const radius = spawnData.spawn_radius || 5; 
        const distance = Math.random() * radius;
        // ===================================================================
        
        const offsetX = distance * Math.cos(angle);
        const offsetZ = distance * Math.sin(angle);
        
        const spawnPosition = new BABYLON.Vector3(
            spawnData.position_x + offsetX,
            spawnData.position_y + 10, 
            spawnData.position_z + offsetZ
        );
        
        const newEnemy = new Enemy(this.scene, spawnPosition, template, spawnData);
        
        this.npcs.push(newEnemy);
        this.activeSpawns.get(spawnData.id).push(newEnemy);
        
        return newEnemy;
    }
    
    update(deltaTime) {
        this.npcs = this.npcs.filter(npc => !npc.isDead); 
        this.npcs.forEach(npc => npc.update(deltaTime));
        
        this.loots = this.loots.filter(loot => !loot.isDead);
        this.loots.forEach(loot => loot.update(deltaTime));
    }
    
    dispose() {
        // ... (dispose method remains the same) ...
    }
}

window.World = World;
