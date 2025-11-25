// hosg_advanced_features.js - Enhanced Game Features
console.log('[HOSG] Loading advanced features...');

// Wait for the game to be fully initialized
function initAdvancedFeatures() {
    const game = window.game;
    if (!game || !game.scene || !game.canvas) {
        console.error('Game not properly initialized');
        return;
    }

    const scene = game.scene;
    const canvas = game.canvas;

    try {
        console.log('[Advanced] Initializing advanced features...');
        
        // Create a basic camera if one doesn't exist
        if (!scene.activeCamera) {
            console.log('[Advanced] Creating default camera...');
            const camera = new BABYLON.ArcRotateCamera(
                "playerCamera", 
                -Math.PI / 2, 
                Math.PI / 2.5, 
                10, 
                new BABYLON.Vector3(0, 0, 0), 
                scene
            );
            camera.attachControl(canvas, true);
            camera.lowerBetaLimit = 0.1;
            camera.upperBetaLimit = (Math.PI / 2) * 0.9;
            camera.lowerRadiusLimit = 2;
            camera.upperRadiusLimit = 100;
            camera.wheelDeltaPercentage = 0.01;
            camera.pinchDeltaPercentage = 0.01;
            camera.speed = 1.0;
            camera.inertia = 0.9;
            
            scene.activeCamera = camera;
            console.log('[Advanced] Default camera created');
        }

        // Add basic lighting if none exists
        if (scene.lights.length === 0) {
            console.log('[Advanced] Adding default lighting...');
            new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), scene);
            new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(0, -1, 1), scene);
        }

        // Initialize any other advanced features here
        console.log('[Advanced] Advanced features initialized');
        
    } catch (error) {
        console.error('[Advanced] Error initializing advanced features:', error);
    }
}

// Wait for the game to be ready
function waitForGame() {
    if (window.game && window.game.scene && window.game.engine) {
        initAdvancedFeatures();
    } else {
        setTimeout(waitForGame, 100);
    }
}

// Start the initialization process
document.addEventListener('DOMContentLoaded', function() {
    console.log('[Advanced] DOM loaded, waiting for game...');
    waitForGame();
});

// Add to global scope if needed
window.initAdvancedFeatures = initAdvancedFeatures;
