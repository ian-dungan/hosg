// ============================================================
// HEROES OF SHADY GROVE - ASSET MANIFEST v2.0
// Complete asset registry for /assets folder
// ============================================================

const ASSET_MANIFEST = {
    // Base path (your GitHub repo /assets folder)
    BASE_PATH: 'assets/',
    
    // Asset loading behavior
    CONFIG: {
        USE_ASSETS: true,                    // Try to load from /assets folder
        FALLBACK_TO_PROCEDURAL: true,        // Generate procedurally if asset missing
        LOG_LOADING: true,                   // Console log asset loading
        CACHE_ASSETS: true,                  // Cache loaded assets
        TEXTURE_ANISOTROPY: 4,              // Texture filtering quality
        GENERATE_MIPMAPS: true              // Better texture quality at distance
    },

    // ==================== TERRAIN TEXTURES ====================
    TERRAIN: {
        // Multiple ground types - system will blend based on height/biome
        GROUND: {
            grass: {
                diffuse: 'textures/terrain/grass_diffuse.jpg',
                normal: 'textures/terrain/grass_normal.jpg',
                ao: 'textures/terrain/grass_ao.jpg',
                scale: 50,  // UV scale (how many times to repeat)
                required: true
            },
            dirt: {
                diffuse: 'textures/terrain/dirt_diffuse.jpg',
                normal: 'textures/terrain/dirt_normal.jpg',
                ao: 'textures/terrain/dirt_ao.jpg',
                scale: 50,
                required: false
            },
            gravel: {
                diffuse: 'textures/terrain/gravel_diffuse.jpg',
                normal: 'textures/terrain/gravel_normal.jpg',
                scale: 40,
                required: false
            },
            sand: {
                diffuse: 'textures/terrain/sand_diffuse.jpg',
                normal: 'textures/terrain/sand_normal.jpg',
                scale: 45,
                required: false
            },
            snow: {
                diffuse: 'textures/terrain/snow_diffuse.jpg',
                normal: 'textures/terrain/snow_normal.jpg',
                scale: 50,
                required: false
            },
            rock: {
                diffuse: 'textures/terrain/rock_diffuse.jpg',
                normal: 'textures/terrain/rock_normal.jpg',
                scale: 30,
                required: false
            },
            mud: {
                diffuse: 'textures/terrain/mud_diffuse.jpg',
                normal: 'textures/terrain/mud_normal.jpg',
                scale: 45,
                required: false
            }
        },

        // Path/road textures
        PATHS: {
            cobblestone: 'textures/terrain/cobblestone.jpg',
            brick_path: 'textures/terrain/brick_path.jpg',
            dirt_road: 'textures/terrain/dirt_road.jpg'
        }
    },

    // ==================== WATER ====================
    WATER: {
        diffuse: 'textures/water/water_diffuse.jpg',
        bump: 'textures/water/water_bump.png',
        normal: 'textures/water/water_normal.png',
        foam: 'textures/water/water_foam.png'
    },

    // ==================== SKYBOX ====================
    SKYBOX: {
        // Multiple skybox options (system will pick one or allow switching)
        default: {
            px: 'textures/skybox/default/px.jpg',  // Right
            nx: 'textures/skybox/default/nx.jpg',  // Left
            py: 'textures/skybox/default/py.jpg',  // Up
            ny: 'textures/skybox/default/ny.jpg',  // Down
            pz: 'textures/skybox/default/pz.jpg',  // Front
            nz: 'textures/skybox/default/nz.jpg'   // Back
        },
        night: {
            px: 'textures/skybox/night/px.jpg',
            nx: 'textures/skybox/night/nx.jpg',
            py: 'textures/skybox/night/py.jpg',
            ny: 'textures/skybox/night/ny.jpg',
            pz: 'textures/skybox/night/pz.jpg',
            nz: 'textures/skybox/night/nz.jpg'
        },
        sunset: {
            px: 'textures/skybox/sunset/px.jpg',
            nx: 'textures/skybox/sunset/nx.jpg',
            py: 'textures/skybox/sunset/py.jpg',
            ny: 'textures/skybox/sunset/ny.jpg',
            pz: 'textures/skybox/sunset/pz.jpg',
            nz: 'textures/skybox/sunset/nz.jpg'
        }
    },

    // ==================== CHARACTERS ====================
    CHARACTERS: {
        // Player character models
        PLAYER: {
            male_warrior: {
                model: 'models/characters/male_warrior.glb',
                texture: 'textures/characters/male_warrior_diffuse.png',
                animations: ['idle', 'walk', 'run', 'jump', 'attack']
            },
            female_warrior: {
                model: 'models/characters/female_warrior.glb',
                texture: 'textures/characters/female_warrior_diffuse.png',
                animations: ['idle', 'walk', 'run', 'jump', 'attack']
            },
            male_mage: {
                model: 'models/characters/male_mage.glb',
                texture: 'textures/characters/male_mage_diffuse.png',
                animations: ['idle', 'walk', 'run', 'jump', 'cast']
            },
            female_mage: {
                model: 'models/characters/female_mage.glb',
                texture: 'textures/characters/female_mage_diffuse.png',
                animations: ['idle', 'walk', 'run', 'jump', 'cast']
            },
            // Fallback: simple procedural human (current system)
            procedural: null
        },

        // NPC models
        NPC: {
            merchant: {
                model: 'models/npcs/merchant.glb',
                texture: 'textures/npcs/merchant_diffuse.png'
            },
            guard: {
                model: 'models/npcs/guard.glb',
                texture: 'textures/npcs/guard_diffuse.png'
            },
            villager_male: {
                model: 'models/npcs/villager_male.glb',
                texture: 'textures/npcs/villager_male_diffuse.png'
            },
            villager_female: {
                model: 'models/npcs/villager_female.glb',
                texture: 'textures/npcs/villager_female_diffuse.png'
            }
        }
    },

    // ==================== ENEMIES ====================
    ENEMIES: {
        // Common enemies
        wolf: {
            model: 'models/enemies/wolf.glb',
            texture: 'textures/enemies/wolf_diffuse.png',
            animations: ['idle', 'walk', 'run', 'attack', 'die'],
            scale: 1.0
        },
        goblin: {
            model: 'models/enemies/goblin.glb',
            texture: 'textures/enemies/goblin_diffuse.png',
            animations: ['idle', 'walk', 'attack', 'die'],
            scale: 0.9
        },
        skeleton: {
            model: 'models/enemies/skeleton.glb',
            texture: 'textures/enemies/skeleton_diffuse.png',
            animations: ['idle', 'walk', 'attack', 'die'],
            scale: 1.1
        },
        orc: {
            model: 'models/enemies/orc.glb',
            texture: 'textures/enemies/orc_diffuse.png',
            animations: ['idle', 'walk', 'attack', 'die'],
            scale: 1.3
        },
        spider: {
            model: 'models/enemies/spider.glb',
            texture: 'textures/enemies/spider_diffuse.png',
            animations: ['idle', 'walk', 'attack', 'die'],
            scale: 0.8
        },
        zombie: {
            model: 'models/enemies/zombie.glb',
            texture: 'textures/enemies/zombie_diffuse.png',
            animations: ['idle', 'walk', 'attack', 'die'],
            scale: 1.0
        },

        // Boss enemies
        BOSSES: {
            dragon: {
                model: 'models/enemies/bosses/dragon.glb',
                texture: 'textures/enemies/bosses/dragon_diffuse.png',
                animations: ['idle', 'walk', 'fly', 'attack', 'breath', 'die'],
                scale: 3.0
            },
            demon: {
                model: 'models/enemies/bosses/demon.glb',
                texture: 'textures/enemies/bosses/demon_diffuse.png',
                animations: ['idle', 'walk', 'attack', 'special', 'die'],
                scale: 2.5
            }
        }
    },

    // ==================== BUILDINGS ====================
    BUILDINGS: {
        // Houses
        HOUSES: {
            cottage: {
                model: 'models/buildings/cottage.glb',
                texture: 'textures/buildings/cottage_diffuse.png',
                collisions: true
            },
            house_small: {
                model: 'models/buildings/house_small.glb',
                texture: 'textures/buildings/house_small_diffuse.png',
                collisions: true
            },
            house_medium: {
                model: 'models/buildings/house_medium.glb',
                texture: 'textures/buildings/house_medium_diffuse.png',
                collisions: true
            },
            house_large: {
                model: 'models/buildings/house_large.glb',
                texture: 'textures/buildings/house_large_diffuse.png',
                collisions: true
            }
        },

        // Shops/Merchants
        SHOPS: {
            blacksmith: {
                model: 'models/buildings/blacksmith.glb',
                texture: 'textures/buildings/blacksmith_diffuse.png',
                collisions: true
            },
            tavern: {
                model: 'models/buildings/tavern.glb',
                texture: 'textures/buildings/tavern_diffuse.png',
                collisions: true
            },
            general_store: {
                model: 'models/buildings/general_store.glb',
                texture: 'textures/buildings/store_diffuse.png',
                collisions: true
            },
            armory: {
                model: 'models/buildings/armory.glb',
                texture: 'textures/buildings/armory_diffuse.png',
                collisions: true
            }
        },

        // Defensive structures
        DEFENSIVE: {
            tower: {
                model: 'models/buildings/tower.glb',
                texture: 'textures/buildings/tower_diffuse.png',
                collisions: true
            },
            wall_straight: {
                model: 'models/buildings/wall_straight.glb',
                texture: 'textures/buildings/wall_diffuse.png',
                collisions: true
            },
            wall_corner: {
                model: 'models/buildings/wall_corner.glb',
                texture: 'textures/buildings/wall_diffuse.png',
                collisions: true
            },
            gate: {
                model: 'models/buildings/gate.glb',
                texture: 'textures/buildings/gate_diffuse.png',
                collisions: true
            }
        },

        // Other structures
        OTHER: {
            well: {
                model: 'models/buildings/well.glb',
                texture: 'textures/buildings/well_diffuse.png',
                collisions: true
            },
            fountain: {
                model: 'models/buildings/fountain.glb',
                texture: 'textures/buildings/fountain_diffuse.png',
                collisions: true
            },
            statue: {
                model: 'models/buildings/statue.glb',
                texture: 'textures/buildings/statue_diffuse.png',
                collisions: true
            }
        }
    },

    // ==================== PROPS/OBJECTS ====================
    PROPS: {
        // Nature
        NATURE: {
            tree_oak: {
                model: 'models/props/tree_oak.glb',
                texture: 'textures/props/tree_oak_diffuse.png',
                collisions: true,
                variants: ['tree_oak_1', 'tree_oak_2', 'tree_oak_3']
            },
            tree_pine: {
                model: 'models/props/tree_pine.glb',
                texture: 'textures/props/tree_pine_diffuse.png',
                collisions: true,
                variants: ['tree_pine_1', 'tree_pine_2']
            },
            tree_birch: {
                model: 'models/props/tree_birch.glb',
                texture: 'textures/props/tree_birch_diffuse.png',
                collisions: true
            },
            rock_small: {
                model: 'models/props/rock_small.glb',
                texture: 'textures/props/rock_diffuse.png',
                collisions: true,
                variants: ['rock_small_1', 'rock_small_2', 'rock_small_3']
            },
            rock_large: {
                model: 'models/props/rock_large.glb',
                texture: 'textures/props/rock_diffuse.png',
                collisions: true,
                variants: ['rock_large_1', 'rock_large_2']
            },
            bush: {
                model: 'models/props/bush.glb',
                texture: 'textures/props/bush_diffuse.png',
                collisions: false,
                variants: ['bush_1', 'bush_2', 'bush_3']
            },
            grass_patch: {
                model: 'models/props/grass_patch.glb',
                texture: 'textures/props/grass_diffuse.png',
                collisions: false,
                variants: ['grass_1', 'grass_2', 'grass_3', 'grass_4']
            },
            flower_patch: {
                model: 'models/props/flower_patch.glb',
                texture: 'textures/props/flowers_diffuse.png',
                collisions: false,
                variants: ['flowers_red', 'flowers_blue', 'flowers_yellow']
            }
        },

        // Containers/Interactive
        CONTAINERS: {
            chest_closed: {
                model: 'models/props/chest_closed.glb',
                texture: 'textures/props/chest_diffuse.png',
                collisions: true
            },
            chest_open: {
                model: 'models/props/chest_open.glb',
                texture: 'textures/props/chest_diffuse.png',
                collisions: false
            },
            barrel: {
                model: 'models/props/barrel.glb',
                texture: 'textures/props/barrel_diffuse.png',
                collisions: true,
                variants: ['barrel_wood', 'barrel_metal']
            },
            crate: {
                model: 'models/props/crate.glb',
                texture: 'textures/props/crate_diffuse.png',
                collisions: true,
                variants: ['crate_wood', 'crate_metal']
            },
            sack: {
                model: 'models/props/sack.glb',
                texture: 'textures/props/sack_diffuse.png',
                collisions: true
            }
        },

        // Decorative
        DECORATIVE: {
            lamp_post: {
                model: 'models/props/lamp_post.glb',
                texture: 'textures/props/lamp_post_diffuse.png',
                collisions: true,
                emissive: true
            },
            torch: {
                model: 'models/props/torch.glb',
                texture: 'textures/props/torch_diffuse.png',
                collisions: false,
                emissive: true
            },
            campfire: {
                model: 'models/props/campfire.glb',
                texture: 'textures/props/campfire_diffuse.png',
                collisions: true,
                emissive: true,
                particles: 'fire'
            },
            fence_straight: {
                model: 'models/props/fence_straight.glb',
                texture: 'textures/props/fence_diffuse.png',
                collisions: true
            },
            sign_post: {
                model: 'models/props/sign_post.glb',
                texture: 'textures/props/sign_diffuse.png',
                collisions: true
            }
        }
    },

    // ==================== PARTICLES ====================
    PARTICLES: {
        rain: 'textures/particles/rain.png',
        snow: 'textures/particles/snowflake.png',
        fire: 'textures/particles/fire.png',
        smoke: 'textures/particles/smoke.png',
        sparkle: 'textures/particles/sparkle.png',
        leaf: 'textures/particles/leaf.png'
    },

    // ==================== UI ELEMENTS ====================
    UI: {
        cursor: 'textures/ui/cursor.png',
        health_bar: 'textures/ui/health_bar.png',
        mana_bar: 'textures/ui/mana_bar.png',
        button: 'textures/ui/button.png',
        panel: 'textures/ui/panel.png',
        inventory_slot: 'textures/ui/inventory_slot.png'
    }
};

window.ASSET_MANIFEST = ASSET_MANIFEST;
console.log('[Assets] Manifest loaded - ' + Object.keys(ASSET_MANIFEST).length + ' categories');
