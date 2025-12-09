// ===========================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.27 (FIXED)
// ===========================================================

const CONFIG = {
    PLAYER: {
        INVENTORY_SIZE: 30, 
        HEALTH: 100,
        MANA: 50,
        STAMINA: 100,
        SPAWN_HEIGHT: 5,
        MOVE_SPEED: 0.15 
    },
    GAME: {
        GRAVITY: 9.81, 
    },
    WORLD: { 
        SKYBOX: {
            // Skybox file (configured in ASSETS section)
            FILE: "shadygrove_sky_specular.dds",
            SIZE: 512,
            EXPOSURE: 0.6,
            CONTRAST: 1.2,
            LEVEL: 0.5
        },
        SPAWNS: [
            {
                id: 1,
                name: "Wolf Den",
                npc_template_id: "Wolf",
                position_x: 20,
                position_y: 0,
                position_z: 20,
                spawn_radius: 10,
                max_spawn: 3
            }
        ]
    },
    // =========================================
    // ASSET CONFIGURATION - EDIT PATHS HERE!
    // =========================================
    ASSETS: {
        // Base asset directory (relative to index.html)
        // Change this to use a CDN, different folder, etc.
        BASE_PATH: "assets/",
        
        // Subfolder structure
        PATHS: {
            CHARACTERS: "player/character/",
            ENVIRONMENT: "environment/",
            SKYBOX: "environment/skybox/",
            ITEMS: "items/",
            EFFECTS: "effects/",
            UI: "ui/",
            AUDIO: "audio/"
        },
        
        // Alternative: Use a CDN
        // Uncomment and modify to use external hosting:
        // BASE_PATH: "https://your-cdn.com/hosg-assets/",
        
        // Alternative: Different local structure
        // BASE_PATH: "../public/game-assets/",
        // PATHS: { CHARACTERS: "models/chars/", ... },
        
        // Character Models (3D meshes)
        CHARACTERS: {
            knight: { 
                model: "assets/player/character/Knight03.glb", 
                required: true 
            },
            wolf: { 
                model: "assets/enemies/Wolf.glb", 
                required: false 
            }
            // Add more characters:
            // goblin: { model: "Goblin.glb", required: false },
            // mage: { model: "Mage01.glb", required: true },
        },
        
        // Environment Assets (trees, rocks, buildings, etc.)
        ENVIRONMENT: {
            tree1: { 
                model: "Tree01.glb" 
            }
            // Add more environment objects:
            // rock1: { model: "Rock01.glb" },
            // house1: { model: "House01.glb" },
            // grass1: { model: "Grass01.glb" },
        },
        
        // Class Definitions (link models to game classes)
        CLASSES: {
            Warrior: { 
                model: 'knight', 
                stats: { 
                    maxHealth: 120, 
                    maxMana: 50, 
                    maxStamina: 120, 
                    attackPower: 15, 
                    magicPower: 5, 
                    moveSpeed: 0.15 
                }, 
                defaultAbility: 'Cleave' 
            },
            Wolf: { 
                model: 'wolf',
                stats: { 
                    maxHealth: 30, 
                    maxMana: 0, 
                    maxStamina: 50, 
                    attackPower: 5, 
                    magicPower: 0, 
                    moveSpeed: 0.18 
                },
                defaultAbility: 'Bite'
            }
            // Add more classes:
            // Mage: { model: 'mage', stats: {...}, defaultAbility: 'Fireball' },
            // Goblin: { model: 'goblin', stats: {...}, defaultAbility: 'Stab' },
        },
        
        // Helper function to build full paths
        getPath: function(category, filename) {
            if (!filename) return null;
            const subPath = this.PATHS[category] || "";
            return this.BASE_PATH + subPath + filename;
        },
        
        // Get character model path
        getCharacterPath: function(modelFile) {
            return this.BASE_PATH + this.PATHS.CHARACTERS + modelFile;
        },
        
        // Get environment model path
        getEnvironmentPath: function(modelFile) {
            return this.BASE_PATH + this.PATHS.ENVIRONMENT + modelFile;
        },
        
        // Get skybox path
        getSkyboxPath: function(filename) {
            return this.BASE_PATH + this.PATHS.SKYBOX + filename;
        }
    }
};
window.CONFIG = CONFIG;
