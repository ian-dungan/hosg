// Core Configuration
const CONFIG = {
    GAME: {
        VERSION: '1.0.0',
        DEBUG: true
    },
    PLAYER: {
        HEALTH: 100,
        MANA: 100,
        STAMINA: 100,
        INVENTORY_SIZE: 20,
        MOVE_SPEED: 0.2,
        JUMP_FORCE: 0.5,
        CAMERA: {
            SENSITIVITY: 0.002,
            MIN_PITCH: -Math.PI/2 + 0.1,
            MAX_PITCH: Math.PI/2 - 0.1
        }
    },
    WORLD: {
        GRAVITY: -9.81,
        CHUNK_SIZE: 32,
        TERRAIN_SIZE: 1000,
        WATER_LEVEL: -0.5,
        TREE_COUNT: 100,
        ROCK_COUNT: 50,
        GRASS_COUNT: 200
    },
    COMBAT: {
        BASE_ATTACK_RANGE: 2.0,
        BASE_ATTACK_RATE: 1.0,
        BASE_DAMAGE: 10
    }
};

// Base Entity Class
class Entity {
    constructor(scene, position) {
        this.scene = scene;
        this.mesh = null;
        this.position = position || BABYLON.Vector3.Zero();
        this.rotation = BABYLON.Vector3.Zero();
        this.scaling = new BABYLON.Vector3(1, 1, 1);
        this.health = 100;
        this.maxHealth = 100;
    }

    update() {
        if (this.mesh) {
            this.mesh.position.copyFrom(this.position);
            this.mesh.rotation.copyFrom(this.rotation);
            this.mesh.scaling.copyFrom(this.scaling);
        }
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        return this.health <= 0;
    }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
        }
    }
}

// Asset Manager
class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.textures = {};
        this.materials = {};
        this.meshes = {};
    }

    createProceduralTexture(name, width = 512, height = 512) {
        const texture = new BABYLON.DynamicTexture(name, { width, height }, this.scene);
        const context = texture.getContext();
        
        // Create a simple procedural texture
        const size = width * height * 4;
        const imageData = context.getImageData(0, 0, width, height);
        
        for (let i = 0; i < size; i += 4) {
            // Generate some interesting patterns
            const x = (i / 4) % width;
            const y = Math.floor((i / 4) / width);
            
            // Simple noise pattern
            const value = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 0.5 + 0.5;
            
            // Set RGBA values
            imageData.data[i] = value * 200 + 55;     // R
            imageData.data[i + 1] = value * 100 + 100; // G
            imageData.data[i + 2] = value * 50 + 50;   // B
            imageData.data[i + 3] = 255;               // A
        }
        
        context.putImageData(imageData, 0, 0);
        texture.update();
        return texture;
    }

    getMaterial(name) {
        if (!this.materials[name]) {
            this.materials[name] = this.createMaterial(name);
        }
        return this.materials[name];
    }

    createMaterial(name) {
        const material = new BABYLON.StandardMaterial(name, this.scene);
        
        switch (name) {
            case 'ground':
                material.diffuseTexture = this.createProceduralTexture('groundTexture');
                material.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
                break;
            case 'water':
                material.alpha = 0.7;
                material.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.5);
                material.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
                material.alpha = 0.8;
                break;
            case 'tree':
                material.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.2);
                break;
            case 'rock':
                material.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
                break;
            case 'grass':
                material.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.2);
                material.alpha = 0.8;
                material.backFaceCulling = false;
                break;
            default:
                material.diffuseColor = new BABYLON.Color3(1, 1, 1);
        }
        
        return material;
    }
}
