// world.js - Enhanced world with beautiful terrain

class World {
    constructor(scene) {
        this.scene = scene;
        this.ground = null;
        this.environment = null;
        this.chunks = new Map();
        this.init();
    }

    async init() {
        await this.createTerrain();
        this.createSkybox();
        this.createEnvironment();
    }

    async createTerrain() {
        // Create a large ground
        this.ground = BABYLON.MeshBuilder.CreateGround('ground', {
            width: 200,
            height: 200,
            subdivisions: 100
        }, this.scene);
        
        // Create a material with procedural textures
        const groundMaterial = new BABYLON.StandardMaterial("groundMaterial", this.scene);
        
        // Create a grass-like texture procedurally
        const grassTexture = new BABYLON.NoiseProceduralTexture("grassNoise", 512, this.scene);
        grassTexture.octaves = 3;
        grassTexture.persistence = 0.8;
        grassTexture.animationSpeedFactor = 0;
        
        // Create a green color for grass
        const grassColor = new BABYLON.Color3(0.2, 0.5, 0.2);
        
        groundMaterial.diffuseTexture = grassTexture;
        groundMaterial.diffuseColor = grassColor;
        
        // Add some bump mapping
        const bumpTexture = new BABYLON.NoiseProceduralTexture("bumpNoise", 512, this.scene);
        bumpTexture.octaves = 4;
        bumpTexture.persistence = 0.2;
        groundMaterial.bumpTexture = bumpTexture;
        groundMaterial.bumpTexture.level = 0.1;
        
        this.ground.material = groundMaterial;
        this.ground.receiveShadows = true;
        
        // Add some height variation
        const positions = this.ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            
            // Generate some hills and valleys
            let height = 0;
            height += Math.sin(x * 0.02) * 2;
            height += Math.cos(z * 0.02) * 2;
            height += Math.sin(x * 0.05) * Math.cos(z * 0.05) * 3;
            
            // Add some random noise
            height += (Math.random() - 0.5) * 0.5;
            
            positions[i + 1] = height;
        }
        
        this.ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        this.ground.convertToFlatShadedMesh();
        
        // Add physics
        this.ground.checkCollisions = true;
        this.ground.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.ground,
            BABYLON.PhysicsImpostor.HeightmapImpostor,
            { mass: 0, restitution: 0.3 },
            this.scene
        );
    }

    createSkybox() {
        // Use a simple color skybox instead of texture
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        
        // Create a gradient sky
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.8); // Blue sky
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        skyboxMaterial.disableLighting = true;
        
        // Add some simple clouds with noise
        const noiseTexture = new BABYLON.NoiseProceduralTexture("clouds", 512, this.scene);
        noiseTexture.animationSpeedFactor = 0.01;
        noiseTexture.persistence = 0.2;
        noiseTexture.brightness = 0.7;
        noiseTexture.octaves = 4;
        
        skyboxMaterial.reflectionTexture = noiseTexture;
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        
        skybox.material = skyboxMaterial;
        return skybox;
    }

    createEnvironment() {
        // Add some trees
        this.addTrees();
        
        // Add some rocks
        this.addRocks();
        
        // Add a water plane
        this.addWater();
    }

    addTrees() {
        // Create a tree prototype
        const createTree = (x, z) => {
            // Trunk
            const trunk = BABYLON.MeshBuilder.CreateCylinder("trunk", {
                height: 2,
                diameterBottom: 0.5,
                diameterTop: 0.3
            }, this.scene);
            trunk.position = new BABYLON.Vector3(x, 1, z);
            
            const trunkMaterial = new BABYLON.StandardMaterial("trunkMaterial", this.scene);
            trunkMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.1);
            trunk.material = trunkMaterial;
            
            // Leaves
            const leaves = BABYLON.MeshBuilder.CreateSphere("leaves", {
                diameter: 3,
                segments: 8
            }, this.scene);
            leaves.position = new BABYLON.Vector3(x, 3.5, z);
            
            const leavesMaterial = new BABYLON.StandardMaterial("leavesMaterial", this.scene);
            leavesMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.1);
            leavesMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
            leaves.material = leavesMaterial;
            
            return [trunk, leaves];
        };
        
        // Add some random trees
        for (let i = 0; i < 50; i++) {
            const x = Math.random() * 180 - 90;
            const z = Math.random() * 180 - 90;
            createTree(x, 0, z);
        }
    }

    addRocks() {
        // Create a rock prototype
        const createRock = (x, z) => {
            const rock = BABYLON.MeshBuilder.CreateIcoSphere("rock", {
                radius: 0.5 + Math.random(),
                subdivisions: 2
            }, this.scene);
            
            rock.position = new BABYLON.Vector3(
                x + (Math.random() - 0.5) * 5,
                0.5,
                z + (Math.random() - 0.5) * 5
            );
            
            rock.rotation = new BABYLON.Vector3(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            
            const rockMaterial = new BABYLON.StandardMaterial("rockMaterial", this.scene);
            rockMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
            rockMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
            rock.material = rockMaterial;
            
            return rock;
        };
        
        // Add some random rocks
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * 180 - 90;
            const z = Math.random() * 180 - 90;
            createRock(x, z);
        }
    }

    addWater() {
        // Create a water material
        const waterMesh = BABYLON.MeshBuilder.CreateGround("water", {
            width: 200,
            height: 200,
            subdivisions: 50
        }, this.scene);
        
        waterMesh.position.y = -0.5; // Slightly below the ground
        
        // Create a simple water material
        const waterMaterial = new BABYLON.StandardMaterial("waterMaterial", this.scene);
        waterMaterial.alpha = 0.7;
        waterMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.5);
        waterMaterial.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        waterMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.3);
        waterMaterial.alphaMode = BABYLON.Engine.ALPHA_COMBINE;
        
        // Add some wave effect
        waterMaterial.bumpTexture = new BABYLON.NoiseProceduralTexture("waterBump", 256, this.scene);
        waterMaterial.bumpTexture.level = 0.1;
        waterMaterial.bumpTexture.animationSpeedFactor = 0.1;
        
        waterMesh.material = waterMaterial;
        
        // Animate the water
        let time = 0;
        this.scene.registerBeforeRender(() => {
            time += 0.01;
            waterMesh.rotation.z = Math.sin(time * 0.1) * 0.1;
            waterMesh.rotation.x = Math.cos(time * 0.05) * 0.1;
        });
    }

    update(deltaTime) {
        // Update any world animations here
    }

    dispose() {
        // Clean up resources
        if (this.ground) {
            this.ground.dispose();
        }
        if (this.environment) {
            this.environment.dispose();
        }
        this.chunks.forEach(chunk => chunk.dispose());
        this.chunks.clear();
    }
}

// Make World globally available
window.World = World;
