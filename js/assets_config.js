// Asset Configuration for world.js
// Add this at the top of world.js or in a separate config

const WORLD_ASSETS = {
    // Set to true to use GitHub assets, false for procedural
    USE_EXTERNAL_ASSETS: true,
    
    // Your GitHub repo assets path
    ASSET_BASE: 'assets/',
    
    // Texture paths (relative to repo root)
    TEXTURES: {
        // Ground/terrain
        grass: 'assets/textures/grass.jpg',
        dirt: 'assets/textures/dirt.jpg',
        sand: 'assets/textures/sand.jpg',
        rock: 'assets/textures/rock.png',
        snow: 'assets/textures/snow.jpg',
        
        // Water
        water: 'assets/textures/water.jpg',
        waterBump: 'assets/textures/waterbump.png',
        waterNormal: 'assets/textures/waternormal.png',
        
        // Skybox (6 faces)
        skybox: {
            px: 'assets/textures/skybox/px.jpg', // +X
            nx: 'assets/textures/skybox/nx.jpg', // -X
            py: 'assets/textures/skybox/py.jpg', // +Y
            ny: 'assets/textures/skybox/ny.jpg', // -Y
            pz: 'assets/textures/skybox/pz.jpg', // +Z
            nz: 'assets/textures/skybox/nz.jpg'  // -Z
        },
        
        // Weather particles
        rain: 'assets/textures/rain.png',
        snow: 'assets/textures/snowflake.png',
        
        // Trees/props
        treeBark: 'assets/textures/bark.jpg',
        leaves: 'assets/textures/leaves.png'
    },
    
    // Fallback to procedural if asset not found
    FALLBACK_TO_PROCEDURAL: true
};

// Helper function to load texture with fallback
function loadTextureWithFallback(scene, assetPath, fallbackCallback) {
    if (!WORLD_ASSETS.USE_EXTERNAL_ASSETS) {
        return fallbackCallback();
    }
    
    try {
        const texture = new BABYLON.Texture(assetPath, scene, null, null, null, 
            function() {
                // Success - texture loaded
                console.log('[Assets] ✓ Loaded:', assetPath);
            },
            function() {
                // Error - use fallback
                if (WORLD_ASSETS.FALLBACK_TO_PROCEDURAL) {
                    console.warn('[Assets] ✗ Failed to load:', assetPath, '- using procedural');
                    return fallbackCallback();
                }
            }
        );
        return texture;
    } catch (error) {
        console.warn('[Assets] Error loading:', assetPath, error);
        return fallbackCallback();
    }
}

window.WORLD_ASSETS = WORLD_ASSETS;
window.loadTextureWithFallback = loadTextureWithFallback;
