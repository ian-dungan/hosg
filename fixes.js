// ==================== GLOBAL DEBUGGING ====================
window.DEBUG_MODE = true;

function debugLog(...args) {
    if (window.DEBUG_MODE) {
        console.log('[DEBUG]', ...args);
    }
}

// Initialize GameSystems if it doesn't exist
if (!window.GameSystems) {
    window.GameSystems = {
        npcManager: null,
        combat: null,
        init: function() { debugLog("GameSystems initialized"); }
    };
}

// ==================== TARGETING SYSTEM ====================
function targetNearestEnemy() {
    if (!window.GameState || !window.GameState.enemies) {
        debugLog("No GameState or enemies found");
        return null;
    }
    
    const player = window.GameState?.player;
    if (!player?.position) {
        debugLog("Player position not found");
        return null;
    }
    
    let nearestEnemy = null;
    let nearestDistance = Infinity;
    
    Object.values(window.GameState.enemies || {}).forEach(enemy => {
        if (!enemy?.mesh || (enemy.stats?.hp !== undefined && enemy.stats.hp <= 0)) return;
        
        const distance = BABYLON.Vector3.Distance(player.position, enemy.mesh.position);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestEnemy = enemy;
        }
    });
    
    if (nearestEnemy) {
        window.GameState.currentTarget = nearestEnemy;
        debugLog(`Targeting: ${nearestEnemy.name || 'Enemy'}`);
    } else {
        debugLog("No valid enemies found");
    }
    
    return nearestEnemy;
}

// ==================== COMBAT FIXES ====================
function patchCombatSystem() {
    if (!window.GameSystems?.combat?.handleDeath) {
        console.warn("Combat system not found for patching");
        return;
    }

    const originalHandleDeath = window.GameSystems.combat.handleDeath;
    
    window.GameSystems.combat.handleDeath = function(defender, attacker) {
        try {
            const oldLevel = attacker?.stats?.level || 1;
            return originalHandleDeath.call(this, defender, attacker);
        } catch (error) {
            console.error("Error in handleDeath:", error);
            return false;
        }
    };
}

// ==================== SHADOW FIXES ====================
function setupShadows(scene) {
    if (!scene) {
        console.error("No scene provided for shadow setup");
        return null;
    }

    try {
        const shadowGenerator = new BABYLON.ShadowGenerator(1024, scene.lights.find(l => l instanceof BABYLON.DirectionalLight));
        shadowGenerator.useBlurExponentialShadowMap = true;
        shadowGenerator.blurKernel = 32;
        shadowGenerator.forceBackFacesOnly = true; // Helps with shadow artifacts
        
        // Store for later use
        window.shadowGenerator = shadowGenerator;
        return shadowGenerator;
    } catch (error) {
        console.error("Failed to setup shadows:", error);
        return null;
    }
}

// ==================== WEBSOCKET HANDLING ====================
function setupMultiplayer() {
    if (window.gameSocket) {
        try {
            window.gameSocket.close();
        } catch (e) {
            console.warn("Error closing existing socket:", e);
        }
    }

    try {
        const ws = new WebSocket('ws://localhost:8080');
        
        ws.onopen = () => {
            console.log('Connected to game server');
            if (window.onSocketConnected) {
                window.onSocketConnected(ws);
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (window.onSocketError) {
                window.onSocketError(error);
            }
        };
        
        ws.onclose = () => {
            console.log('Disconnected from server');
            if (window.onSocketClosed) {
                window.onSocketClosed();
            }
        };
        
        ws.onmessage = (event) => {
            if (window.onSocketMessage) {
                window.onSocketMessage(event);
            }
        };
        
        window.gameSocket = ws;
        return ws;
    } catch (error) {
        console.error('Failed to connect to server:', error);
        return null;
    }
}

// ==================== ASSET FALLBACKS ====================
function createFallbackMesh(name, scene, options = {}) {
    try {
        const size = options.size || 1;
        const position = options.position || BABYLON.Vector3.Zero();
        
        const mesh = BABYLON.MeshBuilder.CreateBox(name, { 
            width: size, 
            height: size, 
            depth: size 
        }, scene);
        
        mesh.position = position;
        
        if (options.color) {
            const material = new BABYLON.StandardMaterial("fallbackMat", scene);
            material.diffuseColor = BABYLON.Color3.FromHexString(options.color);
            mesh.material = material;
        }
        
        return mesh;
    } catch (error) {
        console.error("Failed to create fallback mesh:", error);
        return null;
    }
}

// ==================== INITIALIZATION ====================
function applyFixes() {
    // Make targetNearestEnemy globally available
    window.targetNearestEnemy = targetNearestEnemy;
    
    // Patch the combat system
    patchCombatSystem();
    
    // Setup error handling
    window.addEventListener('error', (event) => {
        console.error('Unhandled error:', event.error || event.message, event);
    });
    
    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
    });
    
    debugLog("All fixes applied successfully");
}

// Apply fixes when the DOM is fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFixes);
} else {
    applyFixes();
}
