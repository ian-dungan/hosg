// ===========================================================
// ASSET COMPATIBILITY SHIM
// Bridges old ASSET_MANIFEST system to new ASSET_PATHS
// Include this AFTER assets.js loads
// ===========================================================

(function() {
    'use strict';
    
    // Create ASSET_MANIFEST that references ASSET_PATHS
    window.ASSET_MANIFEST = {
        BASE_PATH: ASSET_PATHS.BASE,
        
        CHARACTERS: {
            PLAYER: {
                knight: {
                    model: ASSET_PATHS.FOLDERS.PLAYER + ASSET_PATHS.PLAYER_MODELS.knight,
                    offset: { x: 0, y: -0.9, z: 0 },
                    scale: 1.0
                }
            },
            ENEMIES: {
                wolf: {
                    model: ASSET_PATHS.FOLDERS.ENEMIES + ASSET_PATHS.ENEMY_MODELS.wolf,
                    offset: { x: 0, y: -0.5, z: 0 },
                    scale: 1.0
                }
            },
            NPCS: {
                // Add NPCs here as needed
            }
        },
        
        TERRAIN: {
            GROUND: {
                grass: {
                    diffuse: ASSET_PATHS.getTexturePath('grass'),
                    scale: 50
                }
            }
        },
        
        WATER: {
            bump: ASSET_PATHS.getTexturePath('water_bump')
        },
        
        SKYBOX: ASSET_PATHS.getTexturePath('sky_hdri'),
        
        PARTICLES: {
            rain: ASSET_PATHS.getTexturePath('rain'),
            snow: ASSET_PATHS.getTexturePath('snowflake')
        }
    };
    
    console.log('[Compat] ASSET_MANIFEST created from ASSET_PATHS');
    
})();
