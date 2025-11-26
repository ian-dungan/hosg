// world.js - World management
class World {
    constructor(scene) {
        this.scene = scene;
        this.ground = null;
        this.chunks = new Map();
        this.init();
    }

    init() {
        this.createGround();
        this.loadInitialChunks();
    }

    createGround() {
        // Create a simple green ground
        this.ground = BABYLON.MeshBuilder.CreateGround('ground', {
            width: 100,
            height: 100,
            subdivisions: 20  // More subdivisions for better lighting
        }, this.scene);
        
        const groundMaterial = new BABYLON.StandardMaterial('groundMaterial', this.scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.3); // Green color
        groundMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Reduce shininess
        
        // Add some basic bumpiness
        groundMaterial.bumpTexture = new BABYLON.Texture("https://assets.babylonjs.com/environments/grassn.png", this.scene);
        groundMaterial.bumpTexture.level = 0.2;
        
        this.ground.material = groundMaterial;
        this.ground.receiveShadows = true;
        this.ground.checkCollisions = true;
    }

    createSkybox() {
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        
        // Create a simple gradient sky
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.7, 1.0); // Light blue
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        skyboxMaterial.disableLighting = true; // Sky should not be affected by lights
        
        // Add some simple clouds
        const cloudTexture = new BABYLON.Texture("https://assets.babylonjs.com/environments/cloud.png", this.scene);
        cloudTexture.level = 0.2; // Slight cloud effect
        skyboxMaterial.reflectionTexture = cloudTexture;
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        
        skybox.material = skyboxMaterial;
        return skybox;
    }

    loadInitialChunks() {
        // Load initial chunks around the player
        const viewDistance = CONFIG.WORLD.VIEW_DISTANCE;
        
        for (let x = -viewDistance; x <= viewDistance; x++) {
            for (let z = -viewDistance; z <= viewDistance; z++) {
                this.loadChunk(x, 0, z);
            }
        }
    }

    loadChunk(x, y, z) {
        const chunkId = `${x},${y},${z}`;
        if (this.chunks.has(chunkId)) return;

        // Create a simple chunk
        const chunk = BABYLON.MeshBuilder.CreateBox(`chunk_${chunkId}`, {
            width: CONFIG.WORLD.CHUNK_SIZE - 1,
            height: 1,
            depth: CONFIG.WORLD.CHUNK_SIZE - 1
        }, this.scene);
        
        chunk.position = new BABYLON.Vector3(
            x * CONFIG.WORLD.CHUNK_SIZE,
            y * CONFIG.WORLD.CHUNK_SIZE,
            z * CONFIG.WORLD.CHUNK_SIZE
        );
        
        const material = new BABYLON.StandardMaterial(`chunkMat_${chunkId}`, this.scene);
        material.diffuseColor = new BABYLON.Color3(0.8, 0.8, 0.8);
        chunk.material = material;
        chunk.checkCollisions = true;
        
        this.chunks.set(chunkId, chunk);
    }

    update(deltaTime) {
        // Update world logic here
    }

    dispose() {
        // Clean up resources
        if (this.ground) {
            this.ground.dispose();
        }
        this.chunks.forEach(chunk => chunk.dispose());
        this.chunks.clear();
    }
}
