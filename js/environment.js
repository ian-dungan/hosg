class WeatherSystem {
    constructor(scene) {
        this.scene = scene;
        this.weather = 'clear'; // clear, rain, snow, storm
        this.particleSystems = new Map();
        this.init();
    }

    init() {
        // Setup particle systems for different weather effects
        this.setupRain();
        this.setupSnow();
        // Other weather setups...
    }

    setupRain() {
        const rain = new BABYLON.ParticleSystem('rain', 10000, this.scene);
        rain.particleTexture = new BABYLON.Texture('assets/particles/rain.png', this.scene);
        rain.emitter = new BABYLON.Vector3(0, 50, 0);
        rain.minEmitBox = new BABYLON.Vector3(-100, 0, -100);
        rain.maxEmitBox = new BABYLON.Vector3(100, 0, 100);
        
        // Configure rain
        rain.color1 = new BABYLON.Color4(0.8, 0.8, 1.0, 1.0);
        rain.color2 = new BABYLON.Color4(0.8, 0.8, 1.0, 1.0);
        rain.minSize = 0.1;
        rain.maxSize = 0.2;
        rain.minLifeTime = 1.0;
        rain.maxLifeTime = 2.0;
        rain.emitRate = 5000;
        rain.direction1 = new BABYLON.Vector3(-1, -1, -1);
        rain.direction2 = new BABYLON.Vector3(1, -1, 1);
        rain.minEmitPower = 20;
        rain.maxEmitPower = 30;
        rain.updateSpeed = 0.01;
        
        this.particleSystems.set('rain', rain);
    }

    setupSnow() {
        const snow = new BABYLON.ParticleSystem('snow', 10000, this.scene);
        snow.particleTexture = new BABYLON.Texture('assets/particles/snowflake.png', this.scene);
        snow.emitter = new BABYLON.Vector3(0, 50, 0);
        snow.minEmitBox = new BABYLON.Vector3(-100, 0, -100);
        snow.maxEmitBox = new BABYLON.Vector3(100, 0, 100);
        
        // Configure snow
        snow.color1 = new BABYLON.Color4(1, 1, 1, 1);
        snow.color2 = new BABYLON.Color4(1, 1, 1, 1);
        snow.minSize = 0.1;
        snow.maxSize = 0.3;
        snow.minLifeTime = 5.0;
        snow.maxLifeTime = 10.0;
        snow.emitRate = 1000;
        snow.direction1 = new BABYLON.Vector3(-0.5, -0.5, -0.5);
        snow.direction2 = new BABYLON.Vector3(0.5, -1, 0.5);
        snow.minEmitPower = 1;
        snow.maxEmitPower = 3;
        snow.updateSpeed = 0.01;
        
        this.particleSystems.set('snow', snow);
    }

    setWeather(type) {
        // Stop all particle systems
        this.particleSystems.forEach(system => system.stop());
        
        // Start the selected weather effect
        const system = this.particleSystems.get(type);
        if (system) {
            system.start();
        }
        this.weather = type;
    }

    update() {
        // Update weather effects
        if (this.weather === 'rain' || this.weather === 'snow') {
            const system = this.particleSystems.get(this.weather);
            if (system) {
                // Update emitter position to follow camera
                if (window.game?.camera) {
                    system.emitter = window.game.camera.position.add(new BABYLON.Vector3(0, 20, 0));
                }
            }
        }
    }

    dispose() {
        this.particleSystems.forEach(system => system.dispose());
        this.particleSystems.clear();
    }
}

class Minimap {
    constructor(scene, player) {
        this.scene = scene;
        this.player = player;
        this.size = 200; // Size in pixels
        this.margin = 20;
        this.isVisible = true;
        this.init();
    }

    init() {
        // Create minimap camera
        this.minimapCamera = new BABYLON.FreeCamera('minimapCamera', 
            new BABYLON.Vector3(0, 100, 0), 
            this.scene
        );
        this.minimapCamera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
        this.minimapCamera.layerMask = 0x10000000; // Use layer mask for rendering
        
        // Create minimap texture
        this.minimapTexture = new BABYLON.RenderTargetTexture('minimap', {
            width: this.size,
            height: this.size
        }, this.scene);
        this.minimapTexture.activeCamera = this.minimapCamera;
        this.minimapTexture.renderList = this.scene.meshes.filter(mesh => 
            mesh !== this.player.mesh && 
            mesh.name !== 'skybox' && 
            mesh.name !== 'ground'
        );
        
        // Create minimap UI
        this.createUI();
    }

    createUI() {
        // Create advanced dynamic texture for UI
        this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('minimapUI');
        
        // Create container for minimap
        const container = new BABYLON.GUI.Rectangle();
        container.width = `${this.size}px`;
        container.height = `${this.size}px`;
        container.cornerRadius = 10;
        container.thickness = 2;
        container.color = 'white';
        container.background = 'rgba(0, 0, 0, 0.5)';
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.top = `${this.margin}px`;
        container.right = `${this.margin}px`;
        this.advancedTexture.addControl(container);
        
        // Add minimap texture to container
        const minimapImage = new BABYLON.GUI.Image('minimap', '');
        minimapImage.stretch = BABYLON.GUI.Image.STRETCH_FILL;
        minimapImage.width = 1.0;
        minimapImage.height = 1.0;
        container.addControl(minimapImage);
        
        // Add player indicator
        this.playerIndicator = new BABYLON.GUI.Ellipse();
        this.playerIndicator.width = '10px';
        this.playerIndicator.height = '10px';
        this.playerIndicator.color = 'red';
        this.playerIndicator.background = 'red';
        container.addControl(this.playerIndicator);
    }

    update() {
        if (!this.player?.mesh) return;
        
        // Update minimap camera position
        const playerPos = this.player.mesh.position;
        this.minimapCamera.position.x = playerPos.x;
        this.minimapCamera.position.z = playerPos.z - 50; // Offset to see ahead
        
        // Update player indicator
        if (this.playerIndicator) {
            // Convert world position to minimap coordinates
            const x = (playerPos.x / 100) * (this.size / 2) + (this.size / 2);
            const y = (playerPos.z / 100) * (this.size / 2) + (this.size / 2);
            
            this.playerIndicator.left = `${x - 5}px`;
            this.playerIndicator.top = `${y - 5}px`;
        }
    }

    toggle() {
        this.isVisible = !this.isVisible;
        this.advancedTexture.isVisible = this.isVisible;
    }

    dispose() {
        this.minimapTexture.dispose();
        this.advancedTexture.dispose();
        this.minimapCamera.dispose();
    }
}
