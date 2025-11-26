// world.js - Game world management
import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';

export class World {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.entities = [];
        
        this.init();
    }

    init() {
        // Create ground
        this.createGround();
        
        // Load initial chunks
        this.loadInitialChunks();
    }

    createGround() {
        const ground = MeshBuilder.CreateGround('ground', {
            width: 100,
            height: 100
        }, this.scene);
        
        const material = new StandardMaterial('groundMaterial', this.scene);
        material.diffuseColor = new Color3(0.2, 0.6, 0.3);
        ground.material = material;
    }

    loadInitialChunks() {
        // Load chunks around the player
        const chunkSize = CONFIG.WORLD.CHUNK_SIZE;
        const viewDistance = CONFIG.WORLD.VIEW_DISTANCE;
        
        for (let x = -viewDistance; x <= viewDistance; x++) {
            for (let z = -viewDistance; z <= viewDistance; z++) {
                this.loadChunk(x, 0, z);
            }
        }
    }

    loadChunk(x, y, z) {
        const chunkId = `${x},${y},${z}`;
        
        // Skip if chunk already loaded
        if (this.chunks.has(chunkId)) return;
        
        // Create chunk
        const chunk = {
            x, y, z,
            meshes: []
        };
        
        // Add chunk to map
        this.chunks.set(chunkId, chunk);
        
        // Load chunk data and create meshes
        // This is where you'd load terrain data from your game server
    }

    update(deltaTime) {
        // Update entities
        for (const entity of this.entities) {
            if (entity.update) entity.update(deltaTime);
        }
    }

    dispose() {
        // Clean up all chunks
        for (const chunk of this.chunks.values()) {
            for (const mesh of chunk.meshes) {
                mesh.dispose();
            }
        }
        this.chunks.clear();
    }
}