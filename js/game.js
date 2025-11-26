// game.js - Main game class
import { Engine, Scene, Vector3, HemisphericLight, ArcRotateCamera } from '@babylonjs/core';
import { Player } from './player.js';
import { World } from './world.js';
import { Network } from './network.js';
import { UI } from './ui.js';

class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.engine = new Engine(canvas, true);
        this.scene = new Scene(this.engine);
        this.network = new Network();
        this.player = new Player(this.scene);
        this.world = new World(this.scene);
        this.ui = new UI(this.scene, this.player);
        
        this.init();
    }

    async init() {
        // Setup camera
        this.setupCamera();
        
        // Setup lighting
        this.setupLighting();
        
        // Load assets
        await this.loadAssets();
        
        // Connect to server
        await this.network.connect();
        
        // Start game loop
        this.engine.runRenderLoop(() => {
            this.update();
            this.scene.render();
        });
        
        // Handle window resize
        window.addEventListener('resize', () => this.engine.resize());
    }

    setupCamera() {
        this.camera = new ArcRotateCamera(
            'camera',
            -Math.PI / 2,
            Math.PI / 3,
            10,
            Vector3.Zero(),
            this.scene
        );
        this.camera.attachControl(this.canvas, true);
        this.camera.lowerRadiusLimit = 2;
        this.camera.upperRadiusLimit = 20;
    }

    setupLighting() {
        const light = new HemisphericLight(
            'light',
            new Vector3(0, 1, 0),
            this.scene
        );
        light.intensity = 0.7;
    }

    async loadAssets() {
        // Load game assets here
        // Example: await this.assetManager.loadTexture('player', 'assets/textures/player.png');
    }

    update() {
        const deltaTime = this.engine.getDeltaTime() / 1000;
        this.player.update(deltaTime);
        this.world.update(deltaTime);
        this.ui.update();
    }

    dispose() {
        this.engine.dispose();
        this.network.disconnect();
    }
}

// Start the game when the page loads
window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const game = new Game(canvas);
});