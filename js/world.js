// World Generation and Environment Systems
class World {
    constructor(scene) {
        this.scene = scene;
        this.terrain = null;
        this.water = null;
        this.skybox = null;
        this.weather = new WeatherSystem(scene);
        this.time = {
            current: 8, // 24-hour format
            day: 1,
            updateSpeed: 0.05, // How fast time progresses
            isDay: true
        };
        
        // Store entities for easy lookup
        this.scene._entities = new Map();
        this.environmentObjects = [];
        
        this.init();
    }

    async init() {
        // Setup scene physics
        this.scene.gravity = new BABYLON.Vector3(0, -9.81, 0);
        this.scene.collisionsEnabled = true;
        
        // Create environment
        this.createTerrain();
        this.createWater();
        this.createSkybox();
        this.setupLighting();
        this.spawnEnvironment();
        
        // Start time update
        this.scene.registerBeforeRender(() => {
            this.update(this.scene.getEngine().getDeltaTime() / 1000);
        });
    }

    createTerrain() {
        // Create ground with procedural heightmap
        const groundMaterial = new BABYLON.StandardMaterial("groundMaterial", this.scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.6, 0.3);
        groundMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        
        // Create a large ground
        this.terrain = BABYLON.MeshBuilder.CreateGround("terrain", {
            width: CONFIG.WORLD.TERRAIN_SIZE,
            height: CONFIG.WORLD.TERRAIN_SIZE,
            subdivisions: 200,
            updatable: true
        }, this.scene);
        
        // Apply heightmap
        const positions = this.terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const normals = [];
        
        // Generate heightmap
        const noise = new SimplexNoise();
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            
            // Generate terrain height using multiple layers of noise
            let height = 0;
            let amplitude = 1;
            let frequency = 0.005;
            
            for (let j = 0; j < 4; j++) {
                height += noise.noise2D(x * frequency, z * frequency) * amplitude;
                amplitude *= 0.5;
                frequency *= 2;
            }
            
            // Scale the height
            height *= 20;
            
            // Flatten areas for cities
            const distFromCenter = Math.sqrt(x * x + z * z);
            if (distFromCenter < 100) {
                height *= 0.3; // Flatten center area
            }
            
            positions[i + 1] = height;
        }
        
        // Update the mesh
        this.terrain.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        this.terrain.updateVerticesData(BABYLON.VertexBuffer.NormalKind, BABYLON.VertexData.ComputeNormals(positions, this.terrain.getIndices()));
        
        // Apply material
        this.terrain.material = groundMaterial;
        this.terrain.receiveShadows = true;
        
        // Add physics
        this.terrain.checkCollisions = true;
        this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.terrain,
            BABYLON.PhysicsImpostor.HeightmapImpostor,
            { mass: 0, friction: 0.9, restitution: 0.2 },
            this.scene
        );
    }

    createWater() {
        // Create a simple water plane
        this.water = BABYLON.MeshBuilder.CreateGround("water", {
            width: CONFIG.WORLD.TERRAIN_SIZE * 1.2,
            height: CONFIG.WORLD.TERRAIN_SIZE * 1.2
        }, this.scene);
        
        const waterMaterial = new BABYLON.StandardMaterial("waterMaterial", this.scene);
        waterMaterial.alpha = 0.7;
        waterMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.5);
        waterMaterial.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        waterMaterial.alpha = 0.8;
        
        // Animate water
        let time = 0;
        const originalPositions = this.water.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const positions = [...originalPositions];
        
        this.scene.registerBeforeRender(() => {
            time += 0.01;
            
            for (let i = 0; i < positions.length; i += 3) {
                const x = originalPositions[i];
                const z = originalPositions[i + 2];
                
                // Simple wave animation
                positions[i + 1] = Math.sin(x * 0.05 + time) * 0.1 + 
                                  Math.cos(z * 0.05 + time * 0.7) * 0.1;
            }
            
            this.water.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        });
        
        this.water.material = waterMaterial;
        this.water.position.y = CONFIG.WORLD.WATER_LEVEL;
        this.water.isPickable = false;
    }

    createSkybox() {
        // Create a simple skybox
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", {size: 1000.0}, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.8, 1.0);
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        skybox.material = skyboxMaterial;
        this.skybox = skybox;
    }

    setupLighting() {
        // Hemispheric light for ambient lighting
        const hemiLight = new BABYLON.HemisphericLight("hemiLight", 
            new BABYLON.Vector3(0, 1, 0), this.scene);
        hemiLight.intensity = 0.6;
        
        // Directional light for sun/moon
        this.sunLight = new BABYLON.DirectionalLight("sunLight", 
            new BABYLON.Vector3(-1, -1, 1), this.scene);
        this.sunLight.intensity = 1.0;
        this.sunLight.shadowEnabled = true;
        
        // Shadow generator
        const shadowGenerator = new BABYLON.ShadowGenerator(1024, this.sunLight);
        shadowGenerator.useBlurExponentialShadowMap = true;
        shadowGenerator.blurKernel = 32;
        
        // Add shadow support to meshes
        this.shadowGenerator = shadowGenerator;
    }

    spawnEnvironment() {
        // Add trees, rocks, and other environment props
        this.spawnTrees(CONFIG.WORLD.TREE_COUNT);
        this.spawnRocks(CONFIG.WORLD.ROCK_COUNT);
        this.spawnGrass(CONFIG.WORLD.GRASS_COUNT);
        
        // Add some buildings
        this.spawnBuildings(5);
    }

    spawnTrees(count) {
        const treeMaterial = new BABYLON.StandardMaterial("treeMaterial", this.scene);
        treeMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.2);
        
        for (let i = 0; i < count; i++) {
            // Create trunk
            const trunk = BABYLON.MeshBuilder.CreateCylinder(`treeTrunk${i}`, {
                height: 1 + Math.random() * 2,
                diameterTop: 0.3 + Math.random() * 0.2,
                diameterBottom: 0.5 + Math.random() * 0.3
            }, this.scene);
            
            // Create leaves
            const leaves = BABYLON.MeshBuilder.CreateSphere(`treeLeaves${i}`, {
                diameter: 2 + Math.random() * 2
            }, this.scene);
            
            // Position leaves on top of trunk
            leaves.position.y = trunk.scaling.y + leaves.scaling.y * 0.8;
            
            // Create a parent mesh
            const tree = BABYLON.Mesh.MergeMeshes([trunk, leaves], true);
            tree.name = `tree${i}`;
            
            // Set material
            tree.material = treeMaterial;
            
            // Position the tree
            this.placeOnTerrain(tree);
            
            // Random rotation and scale
            tree.rotation.y = Math.random() * Math.PI * 2;
            const scale = 0.5 + Math.random() * 0.5;
            tree.scaling = new BABYLON.Vector3(scale, scale, scale);
            
            // Add to environment objects
            this.environmentObjects.push(tree);
        }
    }

    spawnRocks(count) {
        const rockMaterial = new BABYLON.StandardMaterial("rockMaterial", this.scene);
        rockMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
        
        for (let i = 0; i < count; i++) {
            // Create a simple rock
            const rock = BABYLON.MeshBuilder.CreateIcoSphere(`rock${i}`, {
                radius: 0.3 + Math.random() * 0.7,
                subdivisions: 2
            }, this.scene);
            
            // Make it look more like a rock
            rock.scaling.y *= 0.5 + Math.random() * 0.5;
            rock.scaling.x *= 0.7 + Math.random() * 0.6;
            rock.scaling.z *= 0.7 + Math.random() * 0.6;
            
            // Set material
            rock.material = rockMaterial;
            
            // Position the rock
            this.placeOnTerrain(rock);
            
            // Random rotation
            rock.rotation.x = Math.random() * Math.PI;
            rock.rotation.y = Math.random() * Math.PI * 2;
            rock.rotation.z = Math.random() * Math.PI;
            
            // Add to environment objects
            this.environmentObjects.push(rock);
        }
    }

    spawnGrass(count) {
        const grassMaterial = new BABYLON.StandardMaterial("grassMaterial", this.scene);
        grassMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.2);
        grassMaterial.alpha = 0.8;
        grassMaterial.backFaceCulling = false;
        
        for (let i = 0; i < count; i++) {
            // Create a simple grass patch
            const grass = BABYLON.MeshBuilder.CreateGround(`grass${i}`, {
                width: 1 + Math.random() * 2,
                height: 0.1,
                subdivisions: 1
            }, this.scene);
            
            // Make it look like grass
            grass.rotation.x = Math.PI / 2; // Lay it flat
            grass.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
            
            // Set material
            grass.material = grassMaterial;
            
            // Position the grass
            this.placeOnTerrain(grass);
            
            // Random rotation
            grass.rotation.y = Math.random() * Math.PI * 2;
            
            // Add to environment objects
            this.environmentObjects.push(grass);
        }
    }

    spawnBuildings(count) {
        const buildingMaterial = new BABYLON.StandardMaterial("buildingMaterial", this.scene);
        buildingMaterial.diffuseColor = new BABYLON.Color3(0.7, 0.6, 0.5);
        
        for (let i = 0; i < count; i++) {
            // Create a simple building
            const width = 3 + Math.random() * 5;
            const depth = 3 + Math.random() * 5;
            const height = 2 + Math.random() * 5;
            
            const building = BABYLON.MeshBuilder.CreateBox(`building${i}`, {
                width,
                height,
                depth
            }, this.scene);
            
            // Set material
            building.material = buildingMaterial;
            
            // Position the building on a flat area
            let position;
            let attempts = 0;
            const maxAttempts = 10;
            
            do {
                position = new BABYLON.Vector3(
                    (Math.random() - 0.5) * CONFIG.WORLD.TERRAIN_SIZE * 0.8,
                    0,
                    (Math.random() - 0.5) * CONFIG.WORLD.TERRAIN_SIZE * 0.8
                );
                
                // Check if the area is flat enough
                const ray = new BABYLON.Ray(
                    new BABYLON.Vector3(position.x, 1000, position.z),
                    new BABYLON.Vector3(0, -1, 0),
                    2000
                );
                
                const hit = this.scene.pickWithRay(ray);
                if (hit.pickedPoint) {
                    position.y = hit.pickedPoint.y + height / 2;
                    
                    // Check flatness by sampling points around the building
                    const samplePoints = [
                        new BABYLON.Vector3(-width/2, 0, -depth/2),
                        new BABYLON.Vector3(width/2, 0, -depth/2),
                        new BABYLON.Vector3(-width/2, 0, depth/2),
                        new BABYLON.Vector3(width/2, 0, depth/2)
                    ];
                    
                    let isFlat = true;
                    let baseHeight = position.y - height/2;
                    
                    for (const point of samplePoints) {
                        const samplePos = position.add(point);
                        const sampleRay = new BABYLON.Ray(
                            new BABYLON.Vector3(samplePos.x, 1000, samplePos.z),
                            new BABYLON.Vector3(0, -1, 0),
                            2000
                        );
                        
                        const sampleHit = this.scene.pickWithRay(sampleRay);
                        if (sampleHit.pickedPoint && Math.abs(sampleHit.pickedPoint.y - baseHeight) > 0.5) {
                            isFlat = false;
                            break;
                        }
                    }
                    
                    if (isFlat) break;
                }
                
                attempts++;
            } while (attempts < maxAttempts);
            
            if (attempts >= maxAttempts) {
                building.dispose();
                continue;
            }
            
            building.position = position;
            
            // Add a roof
            const roof = BABYLON.MeshBuilder.CreateCylinder(`roof${i}`, {
                diameter: Math.max(width, depth) * 1.2,
                height: 0.5,
                tessellation: 4
            }, this.scene);
            
            roof.position = position.clone();
            roof.position.y += height / 2 + 0.25;
            roof.rotation.y = Math.PI / 4; // Rotate 45 degrees to make it a diamond shape
            roof.material = new BABYLON.StandardMaterial("roofMaterial", this.scene);
            roof.material.diffuseColor = new BABYLON.Color3(0.5, 0.2, 0.1);
            
            // Add to environment objects
            this.environmentObjects.push(building);
            this.environmentObjects.push(roof);
        }
    }

    placeOnTerrain(mesh) {
        // Position mesh on terrain with random rotation and scale
        const x = (Math.random() - 0.5) * CONFIG.WORLD.TERRAIN_SIZE * 0.9;
        const z = (Math.random() - 0.5) * CONFIG.WORLD.TERRAIN_SIZE * 0.9;
        
        // Raycast to find ground position
        const ray = new BABYLON.Ray(
            new BABYLON.Vector3(x, 1000, z),
            new BABYLON.Vector3(0, -1, 0),
            2000
        );
        
        const hit = this.scene.pickWithRay(ray);
        if (hit.pickedPoint) {
            mesh.position = hit.pickedPoint.clone();
            
            // Adjust y position based on mesh bounding box
            if (mesh.getBoundingInfo) {
                const boundingBox = mesh.getBoundingInfo().boundingBox;
                mesh.position.y += (boundingBox.maximum.y - boundingBox.minimum.y) / 2;
            }
            
            return true;
        }
        
        return false;
    }

    update(deltaTime) {
        // Update time of day
        this.updateTime(deltaTime);
        
        // Update weather
        this.weather.update(deltaTime);
        
        // Update environment effects
        this.updateEnvironmentEffects();
    }

    updateTime(deltaTime) {
        // Update time of day
        this.time.current += this.time.updateSpeed * deltaTime;
        
        // Check for day/night cycle
        if (this.time.current >= 24) {
            this.time.current = 0;
            this.time.day++;
        }
        
        // Update lighting based on time of day
        this.updateLighting();
        
        // Update skybox based on time
        this.updateSkybox();
    }

    updateLighting() {
        // Calculate sun position based on time of day
        const hour = this.time.current;
        const isDay = hour > 6 && hour < 20;
        this.time.isDay = isDay;
        
        // Update sun position (0-24 hours maps to 0-2π radians)
        const sunAngle = (hour / 24) * Math.PI * 2;
        this.sunLight.direction = new BABYLON.Vector3(
            Math.sin(sunAngle),
            Math.cos(sunAngle) * 2 - 1,
            Math.cos(sunAngle) * 0.5
        );
        
        // Adjust light intensity and color
        if (isDay) {
            // Daytime lighting
            const dayIntensity = Math.min(1, (hour - 6) / 2);
            this.sunLight.intensity = 1.0 * dayIntensity;
            this.sunLight.diffuse = new BABYLON.Color3(1, 0.95, 0.85);
            this.sunLight.specular = new BABYLON.Color3(1, 0.95, 0.85);
        } else {
            // Nighttime lighting
            const nightIntensity = Math.max(0.1, 1 - (hour > 18 ? hour - 18 : 6 - hour) / 3);
            this.sunLight.intensity = 0.2 * nightIntensity;
            this.sunLight.diffuse = new BABYLON.Color3(0.3, 0.3, 0.5);
            this.sunLight.specular = new BABYLON.Color3(0.1, 0.1, 0.2);
        }
    }

    updateSkybox() {
        // Adjust skybox based on time of day
        const hour = this.time.current;
        const skyboxMaterial = this.skybox.material;
        
        if (hour > 6 && hour < 18) {
            // Daytime
            skyboxMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.8, 1.0);
        } else if (hour > 5 && hour < 7 || hour > 17 && hour < 20) {
            // Sunrise/sunset
            const progress = hour < 7 ? (hour - 5) / 2 : (19 - hour) / 2;
            skyboxMaterial.diffuseColor = new BABYLON.Color3(
                0.5 + 0.5 * progress,
                0.3 + 0.5 * progress,
                0.1 + 0.4 * progress
            );
        } else {
            // Night
            skyboxMaterial.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.1);
        }
    }

    updateEnvironmentEffects() {
        // Update any environment-specific effects like wind, water, etc.
        if (this.water && this.water.material) {
            // Animate water material
            const time = Date.now() * 0.001;
            this.water.material.diffuseColor = new BABYLON.Color3(
                0.1 + Math.sin(time * 0.2) * 0.05,
                0.3 + Math.cos(time * 0.15) * 0.05,
                0.5 + Math.sin(time * 0.1) * 0.05
            );
        }
    }
}

// Simple simplex noise implementation for terrain generation
class SimplexNoise {
    constructor() {
        this.grad3 = [
            [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
            [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
            [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
        ];
        
        this.p = [];
        for (let i = 0; i < 256; i++) {
            this.p[i] = Math.floor(Math.random() * 256);
        }
        
        this.perm = new Array(512);
        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
        }
    }

    dot(g, x, y) {
        return g[0] * x + g[1] * y;
    }

    noise2D(xin, yin) {
        const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
        const t = (i + j) * G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = xin - X0;
        const y0 = yin - Y0;
        
        let i1, j1;
        if (x0 > y0) {
            i1 = 1; j1 = 0;
        } else {
            i1 = 0; j1 = 1;
        }
        
        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + 2.0 * G2;
        const y2 = y0 - 1.0 + 2.0 * G2;
        
        const ii = i & 255;
        const jj = j & 255;
        const gi0 = this.perm[ii + this.perm[jj]] % 12;
        const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
        const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;
        
        let n0, n1, n2;
        
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 < 0) n0 = 0.0;
        else {
            t0 *= t0;
            n0 = t0 * t0 * this.dot(this.grad3[gi0], x0, y0);
        }
        
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 < 0) n1 = 0.0;
        else {
            t1 *= t1;
            n1 = t1 * t1 * this.dot(this.grad3[gi1], x1, y1);
        }
        
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 < 0) n2 = 0.0;
        else {
            t2 *= t2;
            n2 = t2 * t2 * this.dot(this.grad3[gi2], x2, y2);
        }
        
        return 70.0 * (n0 + n1 + n2);
    }
}
