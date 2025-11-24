// ==================== GLOBAL DEBUGGING ====================
if (typeof window.DEBUG_MODE === 'undefined') {
    window.DEBUG_MODE = true;
}

function debugLog(...args) {
    if (window.DEBUG_MODE) {
        console.log('[DEBUG]', ...args);
    }
}

// ==================== BOUNDING BOX PATCH ====================
function patchBoundingBox() {
    if (typeof BABYLON === 'undefined' || !BABYLON.Mesh) {
        debugLog("BABYLON not available for bounding box patch");
        return;
    }

    if (!BABYLON.Mesh.prototype._originalGetBoundingInfo) {
        // Store original method
        BABYLON.Mesh.prototype._originalGetBoundingInfo = BABYLON.Mesh.prototype.getBoundingInfo;
        
        // Create safe version
        BABYLON.Mesh.prototype.getBoundingInfo = function() {
            if (!this._boundingInfo) {
                if (this.getTotalVertices && this.getTotalIndices) {
                    this._boundingInfo = this._originalGetBoundingInfo.call(this);
                } else {
                    // Fallback for meshes without geometry
                    this._boundingInfo = new BABYLON.BoundingInfo(
                        new BABYLON.Vector3(-1, -1, -1),
                        new BABYLON.Vector3(1, 1, 1)
                    );
                }
            }
            return this._boundingInfo;
        };
        
        debugLog("Applied bounding box patch");
    }
}

// ==================== WEBSOCKET HANDLING ====================
if (typeof window.reconnectAttempts === 'undefined') {
    window.reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_DELAY = 3000; // 3 seconds

    function setupMultiplayer() {
        if (window.gameSocket) {
            try {
                window.gameSocket.onclose = null;
                window.gameSocket.close();
            } catch (e) {
                debugLog("Error closing existing socket:", e);
            }
        }

        try {
            const ws = new WebSocket('ws://localhost:8080');
            
            ws.onopen = () => {
                debugLog('Connected to game server');
                window.reconnectAttempts = 0;
                if (window.onSocketConnected) {
                    window.onSocketConnected(ws);
                }
            };
            
            ws.onerror = (error) => {
                debugLog('WebSocket error:', error);
                if (window.onSocketError) {
                    window.onSocketError(error);
                }
            };
            
            ws.onclose = () => {
                debugLog('Disconnected from server');
                if (window.onSocketClosed) {
                    window.onSocketClosed();
                }
                
                if (window.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    window.reconnectAttempts++;
                    const delay = RECONNECT_DELAY * Math.pow(1.5, window.reconnectAttempts - 1);
                    debugLog(`Attempting to reconnect (${window.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${delay/1000}s...`);
                    setTimeout(setupMultiplayer, delay);
                } else {
                    debugLog('Max reconnection attempts reached. Please refresh the page to try again.');
                }
            };
            
            ws.onmessage = (event) => {
                if (window.onSocketMessage) {
                    try {
                        window.onSocketMessage(event);
                    } catch (e) {
                        debugLog('Error processing WebSocket message:', e);
                    }
                }
            };
            
            window.gameSocket = ws;
            return ws;
        } catch (error) {
            debugLog('Failed to connect to server:', error);
            return null;
        }
    }
}

// ==================== ERROR HANDLING ====================
function setupErrorHandling() {
    // Only set up error handlers once
    if (window._errorHandlersInitialized) return;
    
    window.addEventListener('error', (event) => {
        debugLog('Unhandled error:', event.error || event.message, event);
    });
    
    window.addEventListener('unhandledrejection', (event) => {
        debugLog('Unhandled promise rejection:', event.reason);
    });
    
    window._errorHandlersInitialized = true;
}

// ==================== SCENE SETUP ====================
function setupBasicScene() {
    try {
        const canvas = document.getElementById("renderCanvas");
        if (!canvas) {
            throw new Error("Canvas element not found");
        }

        // Initialize the engine
        const engine = new BABYLON.Engine(canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true
        });

        // Create scene
        const scene = new BABYLON.Scene(engine);
        scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.2, 1);

        // Add a camera
        const camera = new BABYLON.ArcRotateCamera(
            "camera", 
            -Math.PI / 2, 
            Math.PI / 3, 
            10, 
            BABYLON.Vector3.Zero(), 
            scene
        );
        camera.attachControl(canvas, true);
        camera.lowerBetaLimit = 0.1;
        camera.upperBetaLimit = (Math.PI / 2) * 0.9;
        camera.lowerRadius = 3;
        camera.upperRadius = 20;
        camera.wheelPrecision = 50;

        // Add lights
        const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
        light.intensity = 0.7;

        const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-1, -2, -1), scene);
        sun.position = new BABYLON.Vector3(20, 40, 20);
        sun.intensity = 0.8;

        // Create ground
        const ground = BABYLON.MeshBuilder.CreateGround(
            "ground", 
            {width: 100, height: 100}, 
            scene
        );
        const groundMaterial = new BABYLON.StandardMaterial("groundMaterial", scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.3, 0.1);
        ground.material = groundMaterial;

        // Initialize game systems if available
        if (window.GameSystems && typeof window.GameSystems.init === 'function') {
            window.GameSystems.init(scene);
        }

        // Handle window resize
        window.addEventListener('resize', function() {
            engine.resize();
        });

        // Hide loading screen if it exists
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
        }

        // Run render loop
        engine.runRenderLoop(function() {
            scene.render();
        });

        debugLog("Basic scene setup complete");
        return scene;
    } catch (error) {
        console.error('Failed to setup scene:', error);
        const loadingText = document.getElementById('loadingText');
        if (loadingText) {
            loadingText.textContent = 'Error: ' + error.message;
        }
        throw error;
    }
}

// ==================== INITIALIZATION ====================
function applyFixes() {
    // Only apply fixes once
    if (window._fixesApplied) {
        debugLog("Fixes already applied");
        return;
    }
    
    debugLog("Applying fixes...");
    
    // Set up error handling first
    setupErrorHandling();
    
    // Apply bounding box patch
    patchBoundingBox();
    
    // Set up multiplayer
    if (document.readyState === 'complete') {
        if (typeof setupMultiplayer === 'function') {
            setupMultiplayer();
        }
    } else {
        window.addEventListener('load', function() {
            if (typeof setupMultiplayer === 'function') {
                setupMultiplayer();
            }
        });
    }
    
    // Set up basic scene if createScene doesn't exist
    if (typeof window.createScene !== 'function') {
        debugLog("No createScene found, setting up basic scene");
        window.createScene = setupBasicScene;
    }
    
    window._fixesApplied = true;
    debugLog("All fixes applied successfully");
}

// Apply fixes when the DOM is fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFixes);
} else {
    // If the document is already loaded, run immediately
    setTimeout(applyFixes, 0);
}

// Export for Node.js/CommonJS if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        applyFixes,
        setupBasicScene,
        patchBoundingBox,
        setupErrorHandling
    };
}
