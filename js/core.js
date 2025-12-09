// ===========================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.26
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
            PATH: "assets/environment/skybox/shadygrove_sky_specular.dds", 
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
                spawn_radius: 50,
                max_spawn: 5
            }
        ]
    },
    ASSETS: {
        BASE_PATH: "assets/",
        CHARACTERS: {
            knight: { model: "Knight03.glb", required: true },
            wolf:   { model: "Wolf.glb",     required: false } 
        },
        ENVIRONMENT: {
            tree1:  { model: "Tree01.glb" } 
        },
        CLASSES: {
            Warrior: { 
                model: 'knight', 
                stats: { maxHealth: 120, maxMana: 50, maxStamina: 120, attackPower: 15, magicPower: 5, moveSpeed: 0.15 }, 
                defaultAbility: 'Cleave' 
            },
            Wolf: { 
                 model: 'wolf',
                 stats: { maxHealth: 30, maxMana: 0, maxStamina: 50, attackPower: 5, magicPower: 0, moveSpeed: 0.18 },
                 defaultAbility: 'Bite'
            }
        }
    }
};
window.CONFIG = CONFIG;
