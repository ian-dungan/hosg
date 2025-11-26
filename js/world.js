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
        
        // Create a material with multiple textures
        const groundMaterial = new BABYLON.StandardMaterial("groundMaterial", this.scene);
        
        // Base texture
        const groundTexture = new BABYLON.Texture("https://assets.babylonjs.com/environments/grass.jpg", this.scene);
        groundTexture.uScale = 20;
        groundTexture.vScale = 20;
        groundMaterial.diffuseTexture = groundTexture;
        
        // Normal map for detail
        const groundNormal = new BABYLON.Texture("https://assets.babylonjs.com/environments/grassn.png", this.scene);
        groundNormal.uScale = 20;
        groundNormal.vScale = 20;
        groundMaterial.bumpTexture = groundNormal;
        groundMaterial.invertNormalMapX = true;
        groundMaterial.invertNormalMapY = true;
        
        // Add some specular
        groundMaterial.specularPower = 1;
        groundMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        
        this.ground.material = groundMaterial;
        this.ground.receiveShadows = true;
        
        // Add physics
        this.ground.checkCollisions = true;
        this.ground.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.ground,
            BABYLON.PhysicsImpostor.HeightmapImpostor,
            { mass: 0, restitution: 0.9 },
            this.scene
        );
        
        // Add some height variation
        const noiseTexture = new BABYLON.NoiseProceduralTexture("perlin", 256, this.scene);
        noiseTexture.animationSpeedFactor = 0;
        noiseTexture.octaves = 4;
        noiseTexture.persistence = 0.2;
        
        // Create heightmap
        const positions = this.ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            
            // Generate some hills and valleys
            let height = 0;
            height += Math.sin(x * 0.05) * 2;
            height += Math.cos(z * 0.05) * 2;
            height += Math.sin(x * 0.1) * Math.cos(z * 0.1) * 3;
            
            // Add some random noise
            height += (Math.random() - 0.5) * 0.5;
            
            positions[i + 1] = height;
        }
        
        this.ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        this.ground.convertToFlatShadedMesh();
    }

    createSkybox() {
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        
        // Use a high-quality skybox texture
        skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture(
            "https://assets.babylonjs.com/textures/skybox/TropicalSunnyDay", 
            this.scene
        );
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        skyboxMaterial.disableLighting = true;
        skybox.material = skyboxMaterial;
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
            subdivisions: 100
        }, this.scene);
        
        waterMesh.position.y = -1; // Slightly below the ground
        
        const waterMaterial = new BABYLON.WaterMaterial("waterMaterial", this.scene);
        waterMaterial.bumpTexture = new BABYLON.Texture("https://assets.babylonjs.com/textures/waterbump.png", this.scene);
        waterMaterial.windForce = -5;
        waterMaterial.waveHeight = 0.5;
        waterMaterial.bumpHeight = 0.1;
        waterMaterial.waveLength = 0.1;
        waterMaterial.waveSpeed = 50;
        waterMaterial.colorBlendFactor = 0;
        waterMaterial.addToRenderList(this.ground);
        
        waterMesh.material = waterMaterial;
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
