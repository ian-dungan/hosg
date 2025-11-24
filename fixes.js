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
let reconnectAttempts = 0;
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
            reconnectAttempts = 0;
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
            
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1);
                debugLog(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${delay/1000}s...`);
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

// ==================== INITIALIZATION ====================
function applyFixes() {
    // Only apply fixes once
    if (window._fixesApplied) return;
    
    setupErrorHandling();
    patchBoundingBox();
    
    // Wait for the rest of the page to load before setting up multiplayer
    if (document.readyState === 'complete') {
        setupMultiplayer();
    } else {
        window.addEventListener('load', setupMultiplayer);
    }
    
    debugLog("All fixes applied successfully");
    window._fixesApplied = true;
}

// Apply fixes when the DOM is fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFixes);
} else {
    applyFixes();
}
