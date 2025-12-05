// Base Entity class for dynamic world objects (NPCs, enemies, items, etc.)
function Entity(scene, position) {
  this.scene = scene;

  if (typeof BABYLON !== "undefined" && BABYLON.Vector3) {
    if (position instanceof BABYLON.Vector3) {
      this.position = position.clone();
    } else if (position && typeof position === "object" &&
               "x" in position && "y" in position && "z" in position) {
      this.position = new BABYLON.Vector3(position.x, position.y, position.z);
    } else {
      this.position = BABYLON.Vector3.Zero();
    }
  } else {
    this.position = position || { x: 0, y: 0, z: 0 };
  }

  this.mesh = null;
  this._isDisposed = false;
}

Entity.prototype.update = function (deltaTime) {
  if (this.mesh && this.mesh.position && this.position &&
      typeof this.mesh.position.copyFrom === "function") {
    this.mesh.position.copyFrom(this.position);
  }
};

Entity.prototype.dispose = function () {
  this._isDisposed = true;
  if (this.mesh && typeof this.mesh.dispose === "function") {
    this.mesh.dispose();
    this.mesh = null;
  }
};

// World Class

class World {
    constructor(scene, options = {}) {
        this.scene = scene;

        // Merge options without relying on object spread for broader runtime support
        this.options = {
            size: options.size || 1000,
            segments: options.segments || 100,
            maxHeight: options.maxHeight || 20,
            seed: options.seed || Math.random(),
            waterLevel: options.waterLevel || 0.2
        };

        // Apply any provided overrides explicitly
        for (const key in options) {
            if (Object.prototype.hasOwnProperty.call(options, key)) {
                this.options[key] = options[key];
            }
        }
        
        // Terrain
        this.terrain = null;
        this.terrainMaterial = null;
        this.water = null;
        this.waterMaterial = null;
        this.skybox = null;
        
        // Environment
        this.trees = [];
        this.rocks = [];
        this.grass = [];
        this.buildings = [];
        this.npcs = [];
        this.enemies = [];
        this.items = [];
        
        // Time and weather
        this.time = 0; // 0-24 hours
        this.day = 1;
        this.weather = 'clear'; // clear, rain, snow, storm
        this.weatherIntensity = 0; // 0-1
        this.weatherTargetIntensity = 0;
        this.weatherTransitionSpeed = 0.1;
        
        // Lighting
        this.sunLight = null;
        this.ambientLight = null;
        this.shadowGenerator = null;

        // Physics
        this.gravity = new BABYLON.Vector3(0, -9.81, 0);

        // Shared asset loader to cache models/textures across entities
        this.assetLoader = (typeof AssetLoader !== 'undefined') ? new AssetLoader(this.scene) : null;
        if (this.scene) {
            this.scene.world = this;
            if (this.scene.game) {
                this.scene.game.world = this;
            }

            // Make available to anything with a reference to the scene
            this.scene.assetLoader = this.assetLoader;
            if (this.scene.game) {
                this.scene.game.assetLoader = this.assetLoader;
            }
        }
        
        // Initialize
        this.init();
    }

    init() {
        this.createLights();
        this.createSkybox();
        this.createTerrain();
        this.createWater();
        this.populateWorld();
        this.setupEventListeners();
        
        // CRITICAL: Signal player that world is ready
        // Wait a bit to ensure physics is fully stabilized
        setTimeout(() => {
            console.log('[World] ✅ World fully initialized, signaling player...');
            const player = this.scene.player || (this.scene.game && this.scene.game.player);
            if (player && typeof player.startAfterWorldReady === 'function') {
                player.startAfterWorldReady();
            } else {
                console.warn('[World] Player not found or startAfterWorldReady not available');
            }
        }, 500); // 500ms delay to ensure physics is stable
    }

    createLights() {
        // Sun light (directional)
        this.sunLight = new BABYLON.DirectionalLight('sunLight', new BABYLON.Vector3(-1, -2, -1), this.scene);
        this.sunLight.intensity = 1.0;
        this.sunLight.diffuse = new BABYLON.Color3(1, 0.95, 0.9);
        this.sunLight.specular = new BABYLON.Color3(1, 0.95, 0.9);
        
        // Enable shadows
        this.sunLight.shadowEnabled = true;
        this.shadowGenerator = new BABYLON.ShadowGenerator(1024, this.sunLight);
        this.shadowGenerator.useBlurExponentialShadowMap = true;
        this.shadowGenerator.blurKernel = 32;
        
        // Ambient light
        this.ambientLight = new BABYLON.HemisphericLight('ambientLight', new BABYLON.Vector3(0, 1, 0), this.scene);
        this.ambientLight.intensity = 0.5;
        this.ambientLight.diffuse = new BABYLON.Color3(0.5, 0.5, 0.6);
        this.ambientLight.specular = new BABYLON.Color3(0.1, 0.1, 0.1);
    }

    createSkybox() {
        // Try to load custom HDRI skybox
        const skyPath = 'assets/sky/DaySkyHDRI007B_1K_TONEMAPPED.jpg';
        
        try {
            // Use PhotoDome for 360° panoramic skybox
            this.skybox = new BABYLON.PhotoDome(
                "skyDome",
                skyPath,
                {
                    resolution: 32,
                    size: 5000,
                    useDirectMapping: false
                },
                this.scene
            );
            
            console.log('[World] ✓ Custom HDRI skybox loaded');
            
            // Set scene clear color to match sky
            this.scene.clearColor = new BABYLON.Color4(0.5, 0.7, 0.9, 1.0);
            
        } catch (e) {
            console.warn('[World] Failed to load HDRI skybox, using fallback:', e);
            
            // Fallback: Create simple box skybox
            this.skybox = BABYLON.MeshBuilder.CreateBox("skybox", { size: 10000 }, this.scene);
            const skyboxMaterial = new BABYLON.StandardMaterial("skyboxMaterial", this.scene);
            skyboxMaterial.backFaceCulling = false;
            skyboxMaterial.disableLighting = true;
            
            // Try gradient texture
            let skyTexture = null;
            try {
                if (BABYLON.Texture && typeof BABYLON.Texture.CreateGradientTexture === "function") {
                    skyTexture = BABYLON.Texture.CreateGradientTexture("skyGradient", this.scene, 512, function (gradient) {
                        gradient.addColorStop(0, "#87CEEB");
                        gradient.addColorStop(0.5, "#1E90FF");
                        gradient.addColorStop(1, "#E0F7FF");
                    });
                }
            } catch (gradErr) {
                console.warn("[World] Gradient texture failed:", gradErr);
            }

            if (skyTexture) {
                skyboxMaterial.reflectionTexture = skyTexture;
                skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
                skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
                skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
            } else {
                // Solid color fallback
                this.scene.clearColor = new BABYLON.Color4(0.45, 0.65, 0.9, 1.0);
                skyboxMaterial.diffuseColor = new BABYLON.Color3(0.45, 0.65, 0.9);
                skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
                skyboxMaterial.emissiveColor = new BABYLON.Color3(0.45, 0.65, 0.9);
            }

            this.skybox.material = skyboxMaterial;
        }
    }


    createTerrain() {
        // Create a large ground
        this.terrain = BABYLON.MeshBuilder.CreateGround('terrain', {
            width: this.options.size,
            height: this.options.size,
            subdivisions: this.options.segments,
            updatable: true
        }, this.scene);
        
        // Generate heightmap
        this.generateHeightmap();
        
        // Create PBR material for terrain
        const scene = this.scene;
        this.terrainMaterial = new BABYLON.PBRMaterial('terrainMaterial', scene);
        this.terrainMaterial.metallic = 0.0;
        this.terrainMaterial.roughness = 0.8; // Slightly shiny grass

        // Load realistic grass textures
        const grassPath = 'assets/textures/ground/grass/';
        const tileScale = 40; // How many times texture repeats across terrain
        
        try {
            // Color/Albedo texture (main appearance)
            const colorTex = new BABYLON.Texture(
                grassPath + 'Grass004_2K-JPG_Color.jpg',
                scene
            );
            colorTex.uScale = tileScale;
            colorTex.vScale = tileScale;
            this.terrainMaterial.albedoTexture = colorTex;
            console.log('[World] ✓ Grass color texture loaded');
            
            // Normal map (surface detail/bumps)
            const normalTex = new BABYLON.Texture(
                grassPath + 'Grass004_2K-JPG_NormalGL.jpg',
                scene
            );
            normalTex.uScale = tileScale;
            normalTex.vScale = tileScale;
            this.terrainMaterial.bumpTexture = normalTex;
            console.log('[World] ✓ Grass normal texture loaded');
            
            // Ambient Occlusion (adds depth to crevices)
            const aoTex = new BABYLON.Texture(
                grassPath + 'Grass004_2K-JPG_AmbientOcclusion.jpg',
                scene
            );
            aoTex.uScale = tileScale;
            aoTex.vScale = tileScale;
            this.terrainMaterial.ambientTexture = aoTex;
            console.log('[World] ✓ Grass AO texture loaded');
            
        } catch (error) {
            // Fallback to simple green if textures fail
            console.warn('[World] Failed to load grass textures, using procedural green:', error);
            this.terrainMaterial.albedoColor = new BABYLON.Color3(0.3, 0.6, 0.3);
        }
        
        // Assign material to terrain
        this.terrain.material = this.terrainMaterial;
        
        // CRITICAL: Make terrain visible and enabled IMMEDIATELY
        this.terrain.isVisible = true;
        this.terrain.setEnabled(true);
        
        // Enable collisions
        this.terrain.checkCollisions = true;
        
        // Add solid terrain physics. Heightmap impostor is the most stable for a generated ground
        // and avoids the tunneling we were seeing with the triangle-mesh impostor.
        this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.terrain,
            BABYLON.PhysicsImpostor.HeightmapImpostor,
            {
                mass: 0,              // Static (immovable)
                friction: 0.9,        // High friction
                restitution: 0.0      // No bounce
            },
            this.scene
        );
        
        // Make terrain globally accessible for player spawn
        window.gameWorld = this;
        
        console.log('[World] ✓ Terrain physics created and enabled');
        
        // ============================================================
        // COLLISION SAFETY NET - full terrain clone just below surface
        // Matches the heightmap so nothing can slip through seams
        // ============================================================
        this.collisionBarrier = this.terrain.clone('terrainCollisionBarrier');
        this.collisionBarrier.material = null;
        this.collisionBarrier.isVisible = false;
        this.collisionBarrier.visibility = 0;
        this.collisionBarrier.renderingGroupId = -1;

        // Sit just beneath the visual terrain so feet rest on the real surface
        this.collisionBarrier.position.y -= 0.25;

        // Enable collisions and physics so both kinematic and physics actors collide
        this.collisionBarrier.checkCollisions = true;
        this.collisionBarrier.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.collisionBarrier,
            BABYLON.PhysicsImpostor.HeightmapImpostor,
            {
                mass: 0,
                friction: 1.0,
                restitution: 0.0
            },
            this.scene
        );

        console.log('[World] ✓ Collision barrier cloned from terrain and offset -0.25y');
    }

    generateHeightmap() {
        const positions = this.terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const normals = [];
        
        // Create noise generator
        const noise = new SimplexNoise(this.options.seed);
        
        // Generate height values
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            
            // Generate height using multiple layers of noise
            let height = 0;
            let amplitude = 1;
            let frequency = 0.002;
            
            // Base terrain
            for (let j = 0; j < 6; j++) {
                height += noise.noise2D(x * frequency, z * frequency) * amplitude;
                amplitude *= 0.5;
                frequency *= 2;
            }
            
            // Add some mountains
            const mountainNoise = noise.noise2D(x * 0.0005, z * 0.0005) * 0.5 + 0.5;
            height += Math.pow(mountainNoise, 3) * 5;
            
            // Flatten areas for cities
            const distFromCenter = Math.sqrt(x * x + z * z);
            if (distFromCenter < this.options.size * 0.2) {
                height *= 0.3; // Flatten center area
            }
            
            // Scale the height
            height *= this.options.maxHeight;
            
            // Apply height to vertex
            positions[i + 1] = height;
        }
        
        // Update the mesh
        this.terrain.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        
        // Recalculate normals for proper lighting
        BABYLON.VertexData.ComputeNormals(
            positions,
            this.terrain.getIndices(),
            normals
        );
        this.terrain.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    }
    
    // Get terrain height at world position (x, z)
    // This is MUCH more reliable than raycasting!
    getTerrainHeight(x, z) {
        if (!this.terrain) return 0;
        
        // Get terrain bounds
        const size = this.options.size;
        const halfSize = size / 2;
        
        // Check if position is within terrain bounds
        if (x < -halfSize || x > halfSize || z < -halfSize || z > halfSize) {
            return 0; // Outside terrain
        }
        
        // Get terrain vertex data
        const positions = this.terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const subdivisions = this.options.segments;
        
        // Convert world position to grid coordinates
        const gridX = ((x + halfSize) / size) * subdivisions;
        const gridZ = ((z + halfSize) / size) * subdivisions;
        
        // Get the four surrounding vertices
        const x0 = Math.floor(gridX);
        const z0 = Math.floor(gridZ);
        const x1 = Math.min(x0 + 1, subdivisions);
        const z1 = Math.min(z0 + 1, subdivisions);
        
        // Get heights at corners
        const getHeight = (gx, gz) => {
            const index = (gz * (subdivisions + 1) + gx) * 3;
            return positions[index + 1];
        };
        
        const h00 = getHeight(x0, z0);
        const h10 = getHeight(x1, z0);
        const h01 = getHeight(x0, z1);
        const h11 = getHeight(x1, z1);
        
        // Bilinear interpolation
        const fx = gridX - x0;
        const fz = gridZ - z0;
        
        const h0 = h00 * (1 - fx) + h10 * fx;
        const h1 = h01 * (1 - fx) + h11 * fx;
        const height = h0 * (1 - fz) + h1 * fz;
        
        return height;
    }

    async loadTerrainAssets() {
        try {
            const loader = this.assetLoader || new AssetLoader(this.scene);
            
            // Try to load grass textures
            const grassData = ASSET_MANIFEST.TERRAIN.GROUND.grass;
            
            if (grassData && grassData.diffuse) {
                console.log('[World] Attempting to load grass textures...');
                
                // Load diffuse texture
                try {
                    const diffuseTexture = await loader.loadTexture(grassData.diffuse, {
                        uScale: grassData.scale || 50,
                        vScale: grassData.scale || 50
                    });
                    
                    if (diffuseTexture) {
                        this.terrainMaterial.albedoTexture = diffuseTexture;
                        this.terrainMaterial.albedoColor = new BABYLON.Color3(1, 1, 1); // Reset to white to show texture
                        console.log('[World] ✓ Grass diffuse texture loaded');
                    }
                } catch (e) {
                    console.log('[World] Grass diffuse texture not found, using procedural green');
                }
                
                // Try to load normal map
                if (grassData.normal) {
                    try {
                        const normalTexture = await loader.loadTexture(grassData.normal, {
                            uScale: grassData.scale || 50,
                            vScale: grassData.scale || 50
                        });
                        
                        if (normalTexture) {
                            this.terrainMaterial.bumpTexture = normalTexture;
                            console.log('[World] ✓ Grass normal texture loaded');
                        }
                    } catch (e) {
                        console.log('[World] Grass normal texture not found, continuing without it');
                    }
                }
                
                // Try to load AO map
                if (grassData.ao) {
                    try {
                        const aoTexture = await loader.loadTexture(grassData.ao, {
                            uScale: grassData.scale || 50,
                            vScale: grassData.scale || 50
                        });
                        
                        if (aoTexture) {
                            this.terrainMaterial.ambientTexture = aoTexture;
                            console.log('[World] ✓ Grass AO texture loaded');
                        }
                    } catch (e) {
                        console.log('[World] Grass AO texture not found, continuing without it');
                    }
                }
            }
        } catch (error) {
            console.log('[World] Asset loading skipped or failed, using procedural terrain');
        }
    }
    
    createWater() {
        // Create a water plane
        this.water = BABYLON.MeshBuilder.CreateGround('water', {
            width: this.options.size * 1.2,
            height: this.options.size * 1.2,
            subdivisions: 1
        }, this.scene);
        
        // Position water at water level
        this.water.position.y = this.options.waterLevel * this.options.maxHeight;
        
        // Create water material
        this.waterMaterial = new BABYLON.StandardMaterial('waterMaterial', this.scene);
        this.waterMaterial.alpha = 0.7;
        this.waterMaterial.diffuseColor = new BABYLON.Color3(0.12, 0.28, 0.42);
        this.waterMaterial.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
        this.waterMaterial.alpha = 0.7;
        
        // Add reflection and refraction
        this.waterMaterial.reflectionTexture = new BABYLON.MirrorTexture('waterReflection', 512, this.scene, true);
        this.waterMaterial.reflectionTexture.mirrorPlane = new BABYLON.Plane(0, -1, 0, -this.water.position.y);
        this.waterMaterial.reflectionTexture.renderList = [this.terrain, ...this.trees, ...this.buildings];
        this.waterMaterial.reflectionTexture.level = 0.35;
        
        this.waterMaterial.refractionTexture = new BABYLON.RefractionTexture('waterRefraction', 512, this.scene, true);
        this.waterMaterial.refractionTexture.depth = 0.05;
        this.waterMaterial.refractionTexture.refractionPlane = new BABYLON.Plane(0, -1, 0, -this.water.position.y);
        this.waterMaterial.refractionTexture.level = 0.5;
        
        this.waterMaterial.useReflectionFresnelFromSpecular = true;
        this.waterMaterial.useReflectionFresnel = true;
        this.waterMaterial.useRefractionFresnel = true;
        this.waterMaterial.refractionFresnelParameters = new BABYLON.FresnelParameters();
        this.waterMaterial.refractionFresnelParameters.bias = 0.1;
        
        this.waterMaterial.reflectionFresnelParameters = new BABYLON.FresnelParameters();
        this.waterMaterial.reflectionFresnelParameters.bias = 0.1;
        
        this.waterMaterial.specularPower = 32;
        
        this.water.material = this.waterMaterial;
        this.water.isPickable = false;
        this.water.checkCollisions = false; // CRITICAL: Don't block player movement!
        
        console.log(`[World] ✓ Water created at y=${this.water.position.y.toFixed(2)} (non-solid)`);
        
        // Try to load water bump texture if available
        if (window.AssetLoader && ASSET_MANIFEST.CONFIG.USE_ASSETS) {
            this.loadWaterAssets();
        }
    }

    async loadWaterAssets() {
        try {
            const loader = this.assetLoader || new AssetLoader(this.scene);
            const waterData = ASSET_MANIFEST.WATER;
            
            if (waterData && waterData.bump) {
                console.log('[World] Attempting to load water bump texture...');
                
                try {
                    const bumpTexture = await loader.loadTexture(waterData.bump, {
                        uScale: 10,
                        vScale: 10
                    });

                    if (bumpTexture) {
                        this.waterMaterial.bumpTexture = bumpTexture;
                        this.waterMaterial.bumpTexture.level = 0.1;
                        console.log('[World] ✓ Water bump texture loaded');
                    }
                } catch (e) {
                    console.log('[World] Water bump texture not found, using smooth water');
                }
            }
        } catch (error) {
            console.log('[World] Water asset loading skipped');
        }
    }

    populateWorld() {
        // Define static landmark positions for consistent world
        this.landmarks = [
            // Town Center
            { type: 'building', name: 'Town Hall', x: 0, z: 0, scale: 1.5 },
            { type: 'building', name: 'Inn', x: 15, z: 10, scale: 1.2 },
            { type: 'building', name: 'Blacksmith', x: -12, z: 8, scale: 1.0 },
            { type: 'building', name: 'Market', x: 10, z: -15, scale: 1.3 },
            { type: 'building', name: 'Temple', x: -20, z: -10, scale: 1.4 },
            
            // Forest Areas
            { type: 'tree_grove', name: 'Dark Forest', x: -50, z: 50, count: 20 },
            { type: 'tree_grove', name: 'Whispering Woods', x: 60, z: -40, count: 15 },
            { type: 'tree_grove', name: 'Ancient Grove', x: 40, z: 60, count: 12 },
            
            // Points of Interest
            { type: 'rock_formation', name: 'Stone Circle', x: -70, z: -70, count: 8 },
            { type: 'rock_formation', name: 'Boulder Field', x: 80, z: 20, count: 12 },
            
            // Scattered objects
            { type: 'scatter_trees', count: 50 },
            { type: 'scatter_rocks', count: 30 },
            { type: 'scatter_grass', count: 100 }
        ];
        
        // Create landmarks
        this.createLandmarks();
        
        // NPCs, enemies, items still placed (for gameplay)
        this.createNPCs(10);
        this.createEnemies(20);
        this.createItems(30);
        
        console.log('[World] Static world with', this.landmarks.length, 'landmarks created');
    }
    
    createLandmarks() {
        for (const landmark of this.landmarks) {
            switch (landmark.type) {
                case 'building':
                    this.createNamedBuilding(landmark);
                    break;
                case 'tree_grove':
                    this.createTreeGrove(landmark);
                    break;
                case 'rock_formation':
                    this.createRockFormation(landmark);
                    break;
                case 'scatter_trees':
                    this.createTrees(landmark.count);
                    break;
                case 'scatter_rocks':
                    this.createRocks(landmark.count);
                    break;
                case 'scatter_grass':
                    this.createGrass(landmark.count);
                    break;
            }
        }
    }
    
    createNamedBuilding(landmark) {
        const { name, x, z, scale } = landmark;
        
        // Create building at specific position
        const building = BABYLON.MeshBuilder.CreateBox(name, {
            width: 3 * scale,
            height: 4 * scale,
            depth: 3 * scale
        }, this.scene);
        
        const y = this.getHeightAt(x, z);
        building.position = new BABYLON.Vector3(x, y + 2 * scale, z);
        building.checkCollisions = true;
        
        const buildingMaterial = new BABYLON.StandardMaterial('buildingMaterial', this.scene);
        buildingMaterial.diffuseColor = new BABYLON.Color3(0.7, 0.6, 0.5);
        building.material = buildingMaterial;
        
        // Add a roof
        const roof = BABYLON.MeshBuilder.CreateCylinder(`${name}_roof`, {
            diameter: Math.max(3, 3) * scale * 1.2,
            height: 0.5 * scale,
            tessellation: 4
        }, this.scene);
        
        roof.position = building.position.clone();
        roof.position.y += 2 * scale + 0.25 * scale;
        roof.rotation.y = Math.PI / 4;
        
        const roofMaterial = new BABYLON.StandardMaterial('roofMaterial', this.scene);
        roofMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.2, 0.1);
        roof.material = roofMaterial;
        
        // Enable shadows
        this.shadowGenerator.addShadowCaster(building);
        this.shadowGenerator.addShadowCaster(roof);
        
        // Store landmark info
        building.landmarkData = { name, type: 'building', position: { x, z } };
        
        this.buildings.push(building);
        this.buildings.push(roof);
    }
    
    createTreeGrove(landmark) {
        const { name, x, z, count } = landmark;
        const treeMaterial = new BABYLON.StandardMaterial('treeMaterial', this.scene);
        treeMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.2);
        
        // Create trees in a cluster
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const radius = 5 + Math.random() * 10;
            const treeX = x + Math.cos(angle) * radius + (Math.random() - 0.5) * 5;
            const treeZ = z + Math.sin(angle) * radius + (Math.random() - 0.5) * 5;
            
            // Create trunk
            const trunk = BABYLON.MeshBuilder.CreateCylinder(`treeTrunk_${name}_${i}`, {
                height: 1 + Math.random() * 2,
                diameterTop: 0.3 + Math.random() * 0.2,
                diameterBottom: 0.5 + Math.random() * 0.3
            }, this.scene);
            
            // Create leaves
            const leaves = BABYLON.MeshBuilder.CreateSphere(`treeLeaves_${name}_${i}`, {
                diameter: 2 + Math.random() * 2
            }, this.scene);
            
            leaves.position.y = trunk.scaling.y + leaves.scaling.y * 0.8;
            
            const tree = BABYLON.Mesh.MergeMeshes([trunk, leaves], true);
            tree.name = `tree_${name}_${i}`;
            tree.material = treeMaterial;
            
            const drySpot = this.findDrySpot(treeX, treeZ, 12, 10, 0.4);
            tree.position = new BABYLON.Vector3(drySpot.x, drySpot.y, drySpot.z);
            tree.rotation.y = Math.random() * Math.PI * 2;
            
            const scale = 0.5 + Math.random() * 0.5;
            tree.scaling = new BABYLON.Vector3(scale, scale, scale);
            
            this.shadowGenerator.addShadowCaster(tree);
            
            // Store landmark info on first tree of grove
            if (i === 0) {
                tree.landmarkData = { name, type: 'tree_grove', position: { x, z } };
            }
            
            this.trees.push(tree);
        }
    }
    
    createRockFormation(landmark) {
        const { name, x, z, count } = landmark;
        const rockMaterial = new BABYLON.StandardMaterial('rockMaterial', this.scene);
        rockMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
        
        // Create rocks in formation
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const radius = 3 + Math.random() * 5;
            const rockX = x + Math.cos(angle) * radius;
            const rockZ = z + Math.sin(angle) * radius;
            
            const rock = BABYLON.MeshBuilder.CreateIcoSphere(`rock_${name}_${i}`, {
                radius: 0.5 + Math.random() * 1.0,
                subdivisions: 2
            }, this.scene);
            
            rock.scaling.y *= 0.5 + Math.random() * 0.5;
            rock.scaling.x *= 0.7 + Math.random() * 0.6;
            rock.scaling.z *= 0.7 + Math.random() * 0.6;
            
            rock.material = rockMaterial;
            
            const drySpot = this.findDrySpot(rockX, rockZ, 8, 8, 0.4);
            rock.position = new BABYLON.Vector3(drySpot.x, drySpot.y, drySpot.z);
            rock.rotation.y = Math.random() * Math.PI * 2;
            
            // Store landmark info on first rock
            if (i === 0) {
                rock.landmarkData = { name, type: 'rock_formation', position: { x, z } };
            }
            
            this.rocks.push(rock);
        }
    }

    createTrees(count) {
        const treeMaterial = new BABYLON.StandardMaterial('treeMaterial', this.scene);
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
            
            // Enable shadows
            this.shadowGenerator.addShadowCaster(tree);
            
            // Add to trees array
            this.trees.push(tree);
        }
    }

    createRocks(count) {
        const rockMaterial = new BABYLON.StandardMaterial('rockMaterial', this.scene);
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
            
            // Enable physics
            rock.physicsImpostor = new BABYLON.PhysicsImpostor(
                rock,
                BABYLON.PhysicsImpostor.SphereImpostor,
                { mass: 10, friction: 0.9, restitution: 0.2 },
                this.scene
            );
            
            // Add to rocks array
            this.rocks.push(rock);
        }
    }

    createGrass(count) {
        const grassMaterial = new BABYLON.StandardMaterial('grassMaterial', this.scene);
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
            
            // Add to grass array
            this.grass.push(grass);
        }
    }

    createBuildings(count) {
        const buildingMaterial = new BABYLON.StandardMaterial('buildingMaterial', this.scene);
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
            
            // Find a flat area for the building
            let position;
            let attempts = 0;
            const maxAttempts = 10;
            
            do {
                position = new BABYLON.Vector3(
                    (Math.random() - 0.5) * this.options.size * 0.8,
                    0,
                    (Math.random() - 0.5) * this.options.size * 0.8
                );
                
                // Check if the area is flat enough
                const isFlat = this.isAreaFlat(position, width, depth, 0.5);
                if (isFlat) break;
                
                attempts++;
            } while (attempts < maxAttempts);
            
            if (attempts >= maxAttempts) {
                building.dispose();
                continue;
            }
            
            // Position the building
            position.y = this.getHeightAt(position.x, position.z) + height / 2;
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
            
            const roofMaterial = new BABYLON.StandardMaterial('roofMaterial', this.scene);
            roofMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.2, 0.1);
            roof.material = roofMaterial;
            
            // Enable shadows
            this.shadowGenerator.addShadowCaster(building);
            this.shadowGenerator.addShadowCaster(roof);
            
            // Add to buildings array
            this.buildings.push(building);
            this.buildings.push(roof);
        }
    }

    createNPCs(count) {
        for (let i = 0; i < count; i++) {
            // Create a simple NPC
            const npc = new NPC(this.scene, {
                name: `NPC ${i + 1}`,
                position: this.getRandomPositionOnTerrain(),
                health: 100,
                speed: 0.05 + Math.random() * 0.1
            });
            
            // Add to NPCs array
            this.npcs.push(npc);
        }
    }

    createEnemies(count) {
        // Keep enemies close to the playable spawn so they are easy to find
        const spawnRadius = Math.min(80, this.options.size * 0.2);

        for (let i = 0; i < count; i++) {
            // Bias positions toward the center of the map
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const position = new BABYLON.Vector3(
                Math.sin(angle) * distance,
                0,
                Math.cos(angle) * distance
            );

            position.y = this.getHeightAt(position.x, position.z);

            // Create a simple enemy
            const enemy = new Enemy(this.scene, {
                name: `Enemy ${i + 1}`,
                position,
                health: 50 + Math.floor(Math.random() * 50),
                damage: 5 + Math.floor(Math.random() * 10),
                speed: 0.05 + Math.random() * 0.1
            });

            // Add to enemies array
            this.enemies.push(enemy);
        }
    }

    createItems(count) {
        const itemTypes = [
            { name: 'Health Potion', type: 'consumable', effect: { health: 30 } },
            { name: 'Mana Potion', type: 'consumable', effect: { mana: 30 } },
            { name: 'Sword', type: 'weapon', damage: 10 },
            { name: 'Shield', type: 'armor', defense: 5 },
            { name: 'Gold Coin', type: 'currency', value: 1 }
        ];
        
        for (let i = 0; i < count; i++) {
            // Random item type
            const itemType = itemTypes[Math.floor(Math.random() * itemTypes.length)];
            
            // Create item
            const item = new Item(this.scene, {
                name: itemType.name,
                type: itemType.type,
                position: this.getRandomPositionOnTerrain(0.5),
                ...itemType
            });
            
            // Add to items array
            this.items.push(item);
        }
    }
    
    getLandmarks() {
        // Return all static landmarks for minimap display
        const landmarks = [];
        
        // Add buildings
        for (const building of this.buildings) {
            if (building.landmarkData) {
                landmarks.push(building.landmarkData);
            }
        }
        
        // Add tree groves
        for (const tree of this.trees) {
            if (tree.landmarkData) {
                landmarks.push(tree.landmarkData);
            }
        }
        
        // Add rock formations
        for (const rock of this.rocks) {
            if (rock.landmarkData) {
                landmarks.push(rock.landmarkData);
            }
        }
        
        return landmarks;
    }

    placeOnTerrain(mesh) {
        // Position mesh on terrain with random rotation and scale
        const x = (Math.random() - 0.5) * this.options.size * 0.9;
        const z = (Math.random() - 0.5) * this.options.size * 0.9;

        // Get a dry spot near the sampled position
        const drySpot = this.findDrySpot(x, z, 10, 10, 0.4);

        // Set position
        mesh.position.set(drySpot.x, drySpot.y, drySpot.z);
        
        // Random rotation
        mesh.rotation.y = Math.random() * Math.PI * 2;
        
        return mesh.position.clone();
    }

    getHeightAt(x, z) {
        // Cast a ray downward to find the terrain height
        const ray = new BABYLON.Ray(
            new BABYLON.Vector3(x, this.options.maxHeight * 2, z),
            new BABYLON.Vector3(0, -1, 0),
            this.options.maxHeight * 3
        );

        const hit = this.scene.pickWithRay(ray, (mesh) => mesh === this.terrain);
        return hit.pickedPoint ? hit.pickedPoint.y : 0;
    }

    findDrySpot(x, z, attempts = 10, radius = 8, margin = 0.3) {
        const waterY = this.water ? this.water.position.y : -Infinity;

        // Fast path if we're already above the water line
        const currentY = this.getHeightAt(x, z);
        if (currentY > waterY + margin) {
            return { x, z, y: currentY };
        }

        let best = { x, z, y: currentY };

        for (let i = 0; i < attempts; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * radius;
            const candX = x + Math.cos(angle) * dist;
            const candZ = z + Math.sin(angle) * dist;
            const candY = this.getHeightAt(candX, candZ);

            if (candY > waterY + margin) {
                return { x: candX, z: candZ, y: candY };
            }

            if (candY > best.y) {
                best = { x: candX, z: candZ, y: candY };
            }
        }

        // Fall back to highest candidate but lift above the water plane
        best.y = Math.max(best.y, waterY + margin);
        return best;
    }

    isAreaFlat(position, width, depth, maxSlope = 0.1) {
        // Check multiple points in the area to determine if it's flat enough
        const points = [
            new BABYLON.Vector3(-width/2, 0, -depth/2),
            new BABYLON.Vector3(width/2, 0, -depth/2),
            new BABYLON.Vector3(-width/2, 0, depth/2),
            new BABYLON.Vector3(width/2, 0, depth/2)
        ];
        
        // Get height at center
        const centerHeight = this.getHeightAt(position.x, position.z);
        
        // Check each point
        for (const point of points) {
            const worldPos = position.add(point);
            const height = this.getHeightAt(worldPos.x, worldPos.z);
            
            // If the height difference is too large, area is not flat
            if (Math.abs(height - centerHeight) > maxSlope) {
                return false;
            }
        }
        
        return true;
    }

    getRandomPositionOnTerrain(heightOffset = 0) {
        const x = (Math.random() - 0.5) * this.options.size * 0.9;
        const z = (Math.random() - 0.5) * this.options.size * 0.9;
        const y = this.getHeightAt(x, z) + heightOffset;
        
        return new BABYLON.Vector3(x, y, z);
    }

    setupEventListeners() {
        // Update water animation
        this.scene.registerBeforeRender(() => {
            this.updateWater();
            this.updateTime();
            this.updateWeather();
        });
    }

    updateWater() {
        if (!this.waterMaterial) return;

        // Animate water bump texture if it exists
        if (this.waterMaterial.bumpTexture) {
            const time = Date.now() * 0.001;
            const drift = 0.00025;
            this.waterMaterial.bumpTexture.uOffset += drift;
            this.waterMaterial.bumpTexture.vOffset += drift;
        }
    }

    updateTime() {
        // Update time of day (24-hour cycle)
        const deltaTime = this.scene.getEngine().getDeltaTime() / 1000; // Convert to seconds
        this.time += deltaTime * 0.01; // Speed up time for demo
        
        if (this.time >= 24) {
            this.time = 0;
            this.day++;
        }
        
        // Update lighting based on time of day
        this.updateLighting();
    }

    updateLighting() {
        // Calculate sun position based on time of day
        const hour = this.time;
        const isDay = hour > 6 && hour < 20;
        
        // Update sun position (0-24 hours maps to 0-2π radians)
        const sunAngle = (hour / 24) * Math.PI * 2;
        this.sunLight.direction = new BABYLON.Vector3(
            Math.sin(sunAngle),
            Math.cos(sunAngle) * 2 - 1,
            Math.cos(sunAngle) * 0.5
        );
        
        // Adjust light intensity and color based on time of day
        if (isDay) {
            // Daytime lighting
            const dayProgress = (hour - 6) / 14; // 6 AM to 8 PM is day
            const intensity = Math.min(1, dayProgress * 2); // Ramp up in the morning
            this.sunLight.intensity = intensity;
            
            // Warmer light at sunrise/sunset
            if (hour < 9 || hour > 17) {
                const progress = hour < 9 ? 
                    (hour - 6) / 3 : // 6-9 AM
                    (20 - hour) / 3;  // 5-8 PM
                    
                this.sunLight.diffuse = new BABYLON.Color3(
                    1,
                    0.9 - (0.4 * (1 - progress)),
                    0.8 - (0.7 * (1 - progress))
                );
            } else {
                this.sunLight.diffuse = new BABYLON.Color3(1, 0.95, 0.9);
            }
        } else {
            // Nighttime lighting
            const nightProgress = hour < 6 ? 
                hour / 6 : // 12-6 AM
                (24 - hour) / 4; // 8 PM - 12 AM
                
            this.sunLight.intensity = nightProgress * 0.2;
            this.sunLight.diffuse = new BABYLON.Color3(0.3, 0.3, 0.5);
        }
        
        // Update ambient light
        this.ambientLight.intensity = 0.2 + (this.sunLight.intensity * 0.3);
    }

    updateWeather() {
        // Gradually change weather intensity
        if (Math.abs(this.weatherIntensity - this.weatherTargetIntensity) > 0.01) {
            this.weatherIntensity += (this.weatherTargetIntensity - this.weatherIntensity) * this.weatherTransitionSpeed;
        } else {
            // Randomly change target intensity
            if (Math.random() < 0.001) {
                this.weatherTargetIntensity = Math.random();
            }
        }
        
        // Randomly change weather type
        if (Math.random() < 0.0005) {
            const weatherTypes = ['clear', 'rain', 'snow', 'storm'];
            this.setWeather(weatherTypes[Math.floor(Math.random() * weatherTypes.length)]);
        }
    }

    setWeather(type, intensity = 1) {
        if (this.weather === type) return;
        
        this.weather = type;
        this.weatherTargetIntensity = intensity;
        
        // Apply weather effects
        switch (type) {
            case 'rain':
                this.startRain();
                break;
            case 'snow':
                this.startSnow();
                break;
            case 'storm':
                this.startStorm();
                break;
            case 'clear':
            default:
                this.clearWeather();
                break;
        }
    }

    startRain() {
        // Create rain particle system
        if (this.rainSystem) return;
        
        this.rainSystem = new BABYLON.ParticleSystem('rain', 5000, this.scene);
        this.rainSystem.particleTexture = new BABYLON.Texture('assets/textures/rain.png', this.scene);
        
        // Configure rain
        this.rainSystem.emitter = new BABYLON.Vector3(0, 50, 0);
        this.rainSystem.minEmitBox = new BABYLON.Vector3(-100, 0, -100);
        this.rainSystem.maxEmitBox = new BABYLON.Vector3(100, 0, 100);
        
        this.rainSystem.color1 = new BABYLON.Color4(0.8, 0.8, 1.0, 1.0);
        this.rainSystem.color2 = new BABYLON.Color4(0.8, 0.8, 1.0, 1.0);
        this.rainSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0.0);
        
        this.rainSystem.minSize = 0.1;
        this.rainSystem.maxSize = 0.2;
        
        this.rainSystem.minLifeTime = 1.0;
        this.rainSystem.maxLifeTime = 2.0;
        
        this.rainSystem.emitRate = 5000;
        
        this.rainSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ONEONE;
        
        this.rainSystem.gravity = new BABYLON.Vector3(0, -9.81, 0);
        
        this.rainSystem.direction1 = new BABYLON.Vector3(-1, -1, -1);
        this.rainSystem.direction2 = new BABYLON.Vector3(1, -1, 1);
        
        this.rainSystem.minEmitPower = 20;
        this.rainSystem.maxEmitPower = 30;
        this.rainSystem.updateSpeed = 0.01;
        
        // Start the particle system
        this.rainSystem.start();
    }

    startSnow() {
        // Create snow particle system
        if (this.snowSystem) return;
        
        this.snowSystem = new BABYLON.ParticleSystem('snow', 5000, this.scene);
        this.snowSystem.particleTexture = new BABYLON.Texture('assets/textures/snowflake.png', this.scene);
        
        // Configure snow
        this.snowSystem.emitter = new BABYLON.Vector3(0, 50, 0);
        this.snowSystem.minEmitBox = new BABYLON.Vector3(-100, 0, -100);
        this.snowSystem.maxEmitBox = new BABYLON.Vector3(100, 0, 100);
        
        this.snowSystem.color1 = new BABYLON.Color4(1, 1, 1, 1.0);
        this.snowSystem.color2 = new BABYLON.Color4(1, 1, 1, 1.0);
        this.snowSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0.0);
        
        this.snowSystem.minSize = 0.1;
        this.snowSystem.maxSize = 0.3;
        
        this.snowSystem.minLifeTime = 10.0;
        this.snowSystem.maxLifeTime = 20.0;
        
        this.snowSystem.emitRate = 1000;
        
        this.snowSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ONEONE;
        
        this.snowSystem.gravity = new BABYLON.Vector3(0, -2, 0);
        
        this.snowSystem.direction1 = new BABYLON.Vector3(-0.5, -1, -0.5);
        this.snowSystem.direction2 = new BABYLON.Vector3(0.5, -1, 0.5);
        
        this.snowSystem.minEmitPower = 5;
        this.snowSystem.maxEmitPower = 10;
        this.snowSystem.updateSpeed = 0.01;
        
        // Start the particle system
        this.snowSystem.start();
    }

    startStorm() {
        // Start with rain
        this.startRain();
        
        // Add lightning
        if (!this.lightningInterval) {
            this.lightningInterval = setInterval(() => {
                if (Math.random() < 0.3) { // 30% chance for lightning
                    this.createLightning();
                }
            }, 5000); // Check every 5 seconds
        }
        
        // Increase wind
        if (this.rainSystem) {
            this.rainSystem.direction1 = new BABYLON.Vector3(-2, -1, -2);
            this.rainSystem.direction2 = new BABYLON.Vector3(2, -1, 2);
            this.rainSystem.emitRate = 10000;
        }
    }

    createLightning() {
        // Create a bright flash
        const flash = new BABYLON.HemisphericLight('lightningFlash', new BABYLON.Vector3(0, 1, 0), this.scene);
        flash.intensity = 5;
        flash.diffuse = new BABYLON.Color3(0.9, 0.95, 1.0);
        
        // Play thunder sound
        if (this.scene.audio) {
            this.scene.audio.playSound('thunder', { volume: 1.0 });
        }
        
        // Fade out the flash
        let alpha = 1;
        const fadeOut = () => {
            alpha -= 0.1;
            flash.intensity = 5 * alpha;
            
            if (alpha > 0) {
                requestAnimationFrame(fadeOut);
            } else {
                flash.dispose();
            }
        };
        
        // Start fade out after a short delay
        setTimeout(() => {
            fadeOut();
        }, 100);
    }

    clearWeather() {
        // Stop all weather effects
        if (this.rainSystem) {
            this.rainSystem.stop();
            this.rainSystem.dispose();
            this.rainSystem = null;
        }
        
        if (this.snowSystem) {
            this.snowSystem.stop();
            this.snowSystem.dispose();
            this.snowSystem = null;
        }
        
        if (this.lightningInterval) {
            clearInterval(this.lightningInterval);
            this.lightningInterval = null;
        }
    }

    update() {
        // Update all entities
        const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
        
        // Update NPCs
        for (const npc of this.npcs) {
            if (npc.update) npc.update(deltaTime);
        }
        
        // Update enemies
        for (const enemy of this.enemies) {
            if (enemy.update) enemy.update(deltaTime);
        }
        
        // Update items
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            if (item.update) item.update(deltaTime);
            
            // Remove collected items
            if (item.collected) {
                this.items.splice(i, 1);
            }
        }
    }

    dispose() {
        // Dispose of all resources
        if (this.terrain) {
            this.terrain.dispose();
            this.terrain = null;
        }
        
        if (this.water) {
            this.water.dispose();
            this.water = null;
        }
        
        if (this.skybox) {
            this.skybox.dispose();
            this.skybox = null;
        }
        
        if (this.sunLight) {
            this.sunLight.dispose();
            this.sunLight = null;
        }
        
        if (this.ambientLight) {
            this.ambientLight.dispose();
            this.ambientLight = null;
        }
        
        if (this.shadowGenerator) {
            this.shadowGenerator.dispose();
            this.shadowGenerator = null;
        }
        
        // Dispose of all entities
        this.trees.forEach(tree => tree.dispose());
        this.rocks.forEach(rock => rock.dispose());
        this.grass.forEach(grass => grass.dispose());
        this.buildings.forEach(building => building.dispose());
        this.npcs.forEach(npc => npc.dispose());
        this.enemies.forEach(enemy => enemy.dispose());
        this.items.forEach(item => item.dispose());
        
        // Clear arrays
        this.trees = [];
        this.rocks = [];
        this.grass = [];
        this.buildings = [];
        this.npcs = [];
        this.enemies = [];
        this.items = [];
        
        // Clear weather
        this.clearWeather();
    }
}

// NPC Class
class NPC extends Entity {
    constructor(scene, options = {}) {
        super(scene, options.position);
        
        this.type = 'npc';
        this.name = options.name || 'NPC';
        this.health = options.health || 100;
        this.maxHealth = options.maxHealth || this.health;
        this.speed = options.speed || 0.05;
        this.dialogue = options.dialogue || [`Hello, I'm ${this.name}!`];
        this.quests = options.quests || [];
        
        // AI
        this.state = 'idle'; // idle, walking, talking
        this.targetPosition = null;
        this.walkRadius = options.walkRadius || 10;
        this.idleTime = 0;
        this.maxIdleTime = 3; // seconds
        
        // Initialize
        this.init();
    }

    init() {
        this.createMesh();
        this.setupAnimations();
    }

    createMesh() {
        // Create a simple character model
        this.mesh = BABYLON.MeshBuilder.CreateCylinder(`npc_${this.name}`, {
            height: 1.8,
            diameter: 0.6
        }, this.scene);
        
        // Create head
        const head = BABYLON.MeshBuilder.CreateSphere('head', {
            diameter: 0.6
        }, this.scene);
        head.parent = this.mesh;
        head.position.y = 0.9;
        
        // Set material
        const material = new BABYLON.StandardMaterial('npcMaterial', this.scene);
        material.diffuseColor = new BABYLON.Color3(0.8, 0.6, 0.4); // Skin color
        this.mesh.material = material;
        
        // Enable shadows
        this.mesh.receiveShadows = true;
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(this.mesh);
        }
        
        // Set initial position
        this.mesh.position = this.position;
    }

    setupAnimations() {
        // Setup animation groups
        this.animations = {
            idle: this.createAnimation('idle', 0, 30, true),
            walk: this.createAnimation('walk', 30, 60, true),
            wave: this.createAnimation('wave', 60, 90, false)
        };
        
        // Start with idle animation
        this.animations.idle.start(true, 1.0, this.animations.idle.from, this.animations.idle.to, false);
    }

    createAnimation(name, from, to, loop) {
        const animation = new BABYLON.Animation(
            `${this.name}_${name}`,
            'rotation.y',
            30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        const keyFrames = [];
        keyFrames.push({ frame: from, value: 0 });
        keyFrames.push({ frame: to, value: Math.PI * 2 });
        
        animation.setKeys(keyFrames);
        
        // For a real game, you would create more complex animations
        // using animation groups and skeletons
        
        return {
            from: from,
            to: to,
            loop: loop,
            start: (restart, speed, from, to, pingPong) => {
                // Animation start (silent)
            }
        };
    }

    update(deltaTime) {
        if (!this.mesh) return;
        
        // Update position to match physics
        this.mesh.position.copyFrom(this.position);
        
        // Update AI
        this.updateAI(deltaTime);
        
        // Update animations
        this.updateAnimations(deltaTime);
    }

    updateAI(deltaTime) {
        switch (this.state) {
            case 'idle':
                this.idleTime += deltaTime;
                
                // After some idle time, maybe start walking
                if (this.idleTime > this.maxIdleTime && Math.random() < 0.01) {
                    this.startWandering();
                }
                break;
                
            case 'walking':
                if (this.targetPosition) {
                    // Move towards target
                    const direction = this.targetPosition.subtract(this.position);
                    const distance = direction.length();
                    
                    if (distance < 0.1) {
                        // Reached target
                        this.position.copyFrom(this.targetPosition);
                        this.targetPosition = null;
                        this.state = 'idle';
                        this.idleTime = 0;
                    } else {
                        // Move towards target
                        direction.normalize();
                        this.position.addInPlace(direction.scale(this.speed));
                        
                        // Rotate to face movement direction
                        const targetRotation = Math.atan2(direction.x, direction.z);
                        this.mesh.rotation.y = BABYLON.Scalar.Lerp(
                            this.mesh.rotation.y,
                            targetRotation,
                            0.1
                        );
                    }
                } else {
                    this.state = 'idle';
                }
                break;
                
            case 'talking':
                // Face the player when talking
                if (this.talkingTo) {
                    const direction = this.talkingTo.position.subtract(this.position);
                    const targetRotation = Math.atan2(direction.x, direction.z);
                    this.mesh.rotation.y = targetRotation;
                }
                break;
        }
    }

    updateAnimations(deltaTime) {
        // Update animations based on state
        switch (this.state) {
            case 'idle':
                if (this.currentAnimation !== 'idle') {
                    this.playAnimation('idle');
                }
                break;
                
            case 'walking':
                if (this.currentAnimation !== 'walk') {
                    this.playAnimation('walk');
                }
                break;
                
            case 'talking':
                if (this.currentAnimation !== 'wave') {
                    this.playAnimation('wave');
                }
                break;
        }
    }

    startWandering() {
        // Find a random position within walk radius
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * this.walkRadius;
        
        this.targetPosition = new BABYLON.Vector3(
            this.position.x + Math.sin(angle) * distance,
            this.position.y,
            this.position.z + Math.cos(angle) * distance
        );
        
        // Make sure the target position is on the terrain
        if (this.scene.getHeightAt) {
            this.targetPosition.y = this.scene.getHeightAt(
                this.targetPosition.x,
                this.targetPosition.z
            );
        }
        
        this.state = 'walking';
    }

    talkTo(player) {
        this.state = 'talking';
        this.talkingTo = player;
        
        // Stop after a few seconds
        setTimeout(() => {
            if (this.state === 'talking') {
                this.state = 'idle';
                this.talkingTo = null;
            }
        }, 5000);
        
        // Return dialogue
        return this.dialogue[Math.floor(Math.random() * this.dialogue.length)];
    }

    playAnimation(name) {
        if (this.animations[name]) {
            this.animations[name].start(
                this.currentAnimation === name,
                1.0,
                this.animations[name].from,
                this.animations[name].to,
                false
            );
            this.currentAnimation = name;
        }
    }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
    }
}

// Enemy Class
class Enemy extends Entity {
    constructor(scene, options = {}) {
        super(scene, options.position);

        this.type = 'enemy';
        this.name = options.name || 'Enemy';
        this.health = options.health || 50;
        this.maxHealth = options.maxHealth || this.health;
        this.damage = options.damage || 10;
        this.speed = options.speed || 0.05;
        this.attackRange = options.attackRange || 1.5;
        this.detectionRange = options.detectionRange || 10;
        this.experience = options.experience || 20;
        this.assetKey = options.assetKey || options.asset || 'wolf';
        this.footOffset = 0.05; // distance from mesh origin to ground contact point

        // AI
        this.state = 'idle'; // idle, chasing, attacking, dead
        this.target = null;
        this.attackCooldown = 0;
        this.attackRate = options.attackRate || 1.0; // attacks per second
        
        // Initialize
        this.init();
    }

    init() {
        this.createMesh();
        this.setupAnimations();
    }

    createMesh() {
        // Placeholder simple enemy mesh
        this.mesh = BABYLON.MeshBuilder.CreateCylinder(`enemy_${this.name}`, {
            height: 1.8,
            diameter: 0.8
        }, this.scene);

        const head = BABYLON.MeshBuilder.CreateSphere('head', { diameter: 0.7 }, this.scene);
        head.parent = this.mesh;
        head.position.y = 0.9;

        const material = new BABYLON.StandardMaterial('enemyMaterial', this.scene);
        material.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2);
        this.mesh.material = material;

        this.mesh.receiveShadows = true;
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(this.mesh);
        }

        this.mesh.position = this.position;

        this.footOffset = this.computeFootOffset(this.mesh);
        this.snapToGround();

        // Attempt to load a real model (wolf.glb, etc.) using the asset manifest
        const manifestEnemy = (ASSET_MANIFEST.CHARACTERS && ASSET_MANIFEST.CHARACTERS.ENEMIES && ASSET_MANIFEST.CHARACTERS.ENEMIES[this.assetKey])
            || (ASSET_MANIFEST.ENEMIES && ASSET_MANIFEST.ENEMIES[this.assetKey]);

        if (manifestEnemy && window.AssetLoader) {
            const loader = this.scene.assetLoader || (this.scene.game && this.scene.game.assetLoader) || new AssetLoader(this.scene);
            const requestedScale = manifestEnemy.scale || 1;
            loader.loadModel(manifestEnemy.model, {
                position: this.position.clone(),
                scaling: new BABYLON.Vector3(requestedScale, requestedScale, requestedScale)
            }).then(model => {
                if (!model || !model.root) {
                    console.warn(`[Enemy] Failed to load model for ${this.assetKey}`);
                    return;
                }

                // Replace placeholder with loaded model
                this.mesh.dispose();
                this.mesh = model.root;
                this.mesh.position = this.position.clone();

                // Normalize the model to a usable on-screen size (target ~1.2m tall)
                const bounds = this.mesh.getHierarchyBoundingVectors(true);
                const currentHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
                const targetHeight = 1.2;
                const scaleFactor = Math.max(0.2, targetHeight / currentHeight);
                this.mesh.scaling.scaleInPlace(scaleFactor);

                this.footOffset = this.computeFootOffset(this.mesh);
                this.snapToGround();

                // Attach children
                model.instances.slice(1).forEach(m => {
                    m.parent = this.mesh;
                });

                // Shadows
                if (this.scene.shadowGenerator) {
                    this.scene.shadowGenerator.addShadowCaster(this.mesh);
                }

                console.log(`[Enemy] ✓ Loaded asset model '${this.assetKey}' from manifest (scale ${scaleFactor.toFixed(2)})`);
            }).catch(err => {
                console.warn(`[Enemy] Error loading model '${this.assetKey}':`, err);
            });
        }
    }

    computeFootOffset(mesh) {
        if (!mesh || typeof mesh.getHierarchyBoundingVectors !== 'function') {
            return this.footOffset || 0.05;
        }

        const bounds = mesh.getHierarchyBoundingVectors(true);
        return Math.max(0.02, -bounds.min.y + 0.02);
    }

    snapToGround() {
        const world = this.scene.world || (this.scene.game && this.scene.game.world);
        if (!world || typeof world.getHeightAt !== 'function') return;

        const groundY = world.getHeightAt(this.position.x, this.position.z);
        const targetY = groundY + (this.footOffset || 0);

        this.position.y = targetY;
        if (this.mesh && this.mesh.position) {
            this.mesh.position.y = targetY;
        }
    }

    setupAnimations() {
        // Setup animation groups
        this.animations = {
            idle: this.createAnimation('idle', 0, 30, true),
            walk: this.createAnimation('walk', 30, 60, true),
            attack: this.createAnimation('attack', 60, 90, false),
            die: this.createAnimation('die', 90, 120, false)
        };
        
        // Start with idle animation
        this.animations.idle.start(true, 1.0, this.animations.idle.from, this.animations.idle.to, false);
    }

    createAnimation(name, from, to, loop) {
        const animation = new BABYLON.Animation(
            `${this.name}_${name}`,
            'rotation.y',
            30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        const keyFrames = [];
        keyFrames.push({ frame: from, value: 0 });
        keyFrames.push({ frame: to, value: Math.PI * 2 });
        
        animation.setKeys(keyFrames);
        
        // For a real game, you would create more complex animations
        // using animation groups and skeletons
        
        return {
            from: from,
            to: to,
            loop: loop,
            start: (restart, speed, from, to, pingPong) => {
                // Animation start (silent)
            }
        };
    }

    update(deltaTime) {
        if (!this.mesh || this.state === 'dead') return;

        this.snapToGround();

        // Update position to match physics
        this.mesh.position.copyFrom(this.position);
        
        // Update attack cooldown
        if (this.attackCooldown > 0) {
            this.attackCooldown -= deltaTime;
        }
        
        // Update AI
        this.updateAI(deltaTime);
        
        // Update animations
        this.updateAnimations(deltaTime);
    }

    updateAI(deltaTime) {
        // Find the player if we don't have a target
        if (!this.target) {
            this.findTarget();
        }
        
        if (this.target) {
            const distance = BABYLON.Vector3.Distance(this.position, this.target.position);
            
            if (distance <= this.attackRange) {
                // Attack if in range
                this.state = 'attacking';
                this.attack();
            } else if (distance <= this.detectionRange) {
                // Chase if player is detected
                this.state = 'chasing';
                this.chaseTarget(deltaTime);
            } else {
                // Lost sight of player
                this.state = 'idle';
                this.target = null;
            }
        } else {
            // No target, wander or idle
            this.state = 'idle';
        }
    }

    findTarget() {
        // In a real game, you would use a spatial partitioning system
        // to efficiently find nearby players
        if (this.scene.player && 
            this.scene.player.mesh &&
            this.scene.player.mesh.position) {
            const playerPos = this.scene.player.mesh.position;
            if (BABYLON.Vector3.Distance(this.position, playerPos) <= this.detectionRange) {
                this.target = this.scene.player;
            }
        }
    }

    chaseTarget(deltaTime) {
        if (!this.target || !this.target.mesh || !this.target.mesh.position) return;
        
        const targetPos = this.target.mesh.position;
        const direction = targetPos.subtract(this.position);
        const distance = direction.length();
        
        if (distance > 0) {
            // Normalize and scale by speed
            direction.normalize().scaleInPlace(this.speed * deltaTime * 60);
            
            // Move towards target
            this.position.addInPlace(direction);

            this.snapToGround();

            // Rotate to face movement direction
            const targetRotation = Math.atan2(direction.x, direction.z);
            this.mesh.rotation.y = BABYLON.Scalar.Lerp(
                this.mesh.rotation.y,
                targetRotation,
                0.1
            );
        }
    }

    attack() {
        if (this.attackCooldown > 0 || !this.target) return;
        
        // Play attack animation
        this.playAnimation('attack');
        
        // Check if target is in range
        const distance = BABYLON.Vector3.Distance(this.position, this.target.position);
        if (distance <= this.attackRange) {
            // Apply damage to target
            if (this.target.takeDamage) {
                this.target.takeDamage(this.damage, this);
            }
        }
        
        // Set attack cooldown
        this.attackCooldown = 1.0 / this.attackRate;
        
        // Play attack sound
        if (this.scene.audio) {
            this.scene.audio.playSound('enemy_attack');
        }
    }

    takeDamage(amount, source) {
        this.health -= amount;
        
        // Show damage number
        if (this.scene.ui) {
            this.scene.ui.showDamageNumber(amount, this.position, false);
        }
        
        // Play hurt sound
        if (this.scene.audio) {
            this.scene.audio.playSound('enemy_hurt');
        }
        
        // Check for death
        if (this.health <= 0) {
            this.die(source);
            return true; // Enemy was killed
        }
        
        // Aggro on attacker
        if (source) {
            this.target = source;
        }
        
        return false; // Enemy is still alive
    }

    die(killer) {
        this.state = 'dead';
        this.playAnimation('die');
        
        // Drop loot
        this.dropLoot(killer);
        
        // Grant experience to killer
        if (killer && killer.gainExperience) {
            killer.gainExperience(this.experience);
        }
        
        // Remove from scene after a delay
        setTimeout(() => {
            this.dispose();
            
            // Remove from enemies array if it exists
            if (this.scene.world && this.scene.world.enemies) {
                const index = this.scene.world.enemies.indexOf(this);
                if (index !== -1) {
                    this.scene.world.enemies.splice(index, 1);
                }
            }
        }, 2000);
        
        // Play death sound
        if (this.scene.audio) {
            this.scene.audio.playSound('enemy_death');
        }
    }

    dropLoot(killer) {
        // Determine what loot to drop
        const loot = [];
        
        // Always drop some gold
        const goldAmount = 5 + Math.floor(Math.random() * 10);
        loot.push({ type: 'gold', amount: goldAmount });
        
        // Chance to drop an item
        if (Math.random() < 0.3) { // 30% chance
            const items = ['health_potion', 'mana_potion', 'sword', 'shield'];
            const randomItem = items[Math.floor(Math.random() * items.length)];
            loot.push({ type: 'item', id: randomItem, quantity: 1 });
        }
        
        // Create loot in the world
        for (const item of loot) {
            if (item.type === 'gold') {
                const gold = new Item(this.scene, {
                    type: 'currency',
                    name: 'Gold Coin',
                    value: item.amount,
                    position: this.position.clone()
                });
                
                if (this.scene.world && this.scene.world.items) {
                    this.scene.world.items.push(gold);
                }
            } else if (item.type === 'item') {
                const worldItem = new Item(this.scene, {
                    type: 'item',
                    id: item.id,
                    name: item.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                    position: this.position.clone()
                });
                
                if (this.scene.world && this.scene.world.items) {
                    this.scene.world.items.push(worldItem);
                }
            }
        }
    }

    updateAnimations(deltaTime) {
        // Update animations based on state
        switch (this.state) {
            case 'idle':
                if (this.currentAnimation !== 'idle') {
                    this.playAnimation('idle');
                }
                break;
                
            case 'chasing':
                if (this.currentAnimation !== 'walk') {
                    this.playAnimation('walk');
                }
                break;
                
            case 'attacking':
                if (this.currentAnimation !== 'attack') {
                    this.playAnimation('attack');
                }
                break;
                
            case 'dead':
                if (this.currentAnimation !== 'die') {
                    this.playAnimation('die');
                }
                break;
        }
    }

    playAnimation(name) {
        if (this.animations[name]) {
            this.animations[name].start(
                this.currentAnimation === name,
                1.0,
                this.animations[name].from,
                this.animations[name].to,
                false
            );
            this.currentAnimation = name;
        }
    }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
    }
}

// Item Class
class Item extends Entity {
    constructor(scene, options = {}) {
        super(scene, options.position || BABYLON.Vector3.Zero());
        
        this.type = options.type || 'item'; // item, weapon, armor, consumable, currency
        this.id = options.id || 'item';
        this.name = options.name || 'Item';
        this.description = options.description || '';
        this.icon = options.icon || '';
        this.value = options.value || 0;
        this.quantity = options.quantity || 1;
        this.stackable = options.stackable !== undefined ? options.stackable : true;
        this.collected = false;
        
        // Item-specific properties
        this.equipSlot = options.equipSlot || null; // For equippable items
        this.stats = options.stats || {}; // For items that modify stats
        
        // For weapons
        this.damage = options.damage || 0;
        this.attackSpeed = options.attackSpeed || 1.0;
        
        // For armor
        this.defense = options.defense || 0;
        
        // For consumables
        this.effect = options.effect || null;
        this.cooldown = options.cooldown || 0;
        
        // Initialize
        this.init();
    }

    init() {
        this.createMesh();
        this.setupPhysics();
    }

    createMesh() {
        // Create a simple item mesh based on type
        switch (this.type) {
            case 'weapon':
                this.mesh = BABYLON.MeshBuilder.CreateBox(`item_${this.id}`, {
                    width: 0.3,
                    height: 1.0,
                    depth: 0.1
                }, this.scene);
                break;
                
            case 'armor':
                this.mesh = BABYLON.MeshBuilder.CreateBox(`item_${this.id}`, {
                    size: 0.5
                }, this.scene);
                break;
                
            case 'consumable':
                this.mesh = BABYLON.MeshBuilder.CreateSphere(`item_${this.id}`, {
                    diameter: 0.3
                }, this.scene);
                break;
                
            case 'currency':
                this.mesh = BABYLON.MeshBuilder.CreateCylinder(`item_${this.id}`, {
                    height: 0.1,
                    diameter: 0.5
                }, this.scene);
                break;
                
            default:
                this.mesh = BABYLON.MeshBuilder.CreateBox(`item_${this.id}`, {
                    size: 0.5
                }, this.scene);
        }
        
        // Set material based on item type
        const material = new BABYLON.StandardMaterial(`item_${this.id}_material`, this.scene);
        
        switch (this.type) {
            case 'weapon':
                material.diffuseColor = new BABYLON.Color3(0.7, 0.7, 0.7); // Silver
                break;
            case 'armor':
                material.diffuseColor = new BABYLON.Color3(0.8, 0.8, 0.9); // Light blue
                break;
            case 'consumable':
                material.diffuseColor = new BABYLON.Color3(0.9, 0.2, 0.2); // Red
                break;
            case 'currency':
                material.diffuseColor = new BABYLON.Color3(1.0, 0.84, 0.0); // Gold
                break;
            default:
                material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5); // Gray
        }
        
        this.mesh.material = material;
        
        // Add a slight hover animation
        this.originalY = this.position.y;
        this.hoverAmplitude = 0.2;
        this.hoverSpeed = 2.0;
        
        // Enable picking
        this.mesh.isPickable = true;
        this.mesh.item = this;
        
        // Set initial position
        this.mesh.position = this.position;
    }

    setupPhysics() {
        // Add physics to make the item fall and interact with the world
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { 
                mass: 1, 
                friction: 0.5, 
                restitution: 0.3 
            },
            this.scene
        );
    }

    update(deltaTime) {
        if (!this.mesh || this.collected) return;
        
        // Update position from physics
        this.position.copyFrom(this.mesh.position);
        
        // Hover animation
        if (this.originalY !== undefined) {
            this.mesh.position.y = this.originalY + Math.sin(Date.now() * 0.001 * this.hoverSpeed) * this.hoverAmplitude;
        }
        
        // Rotate slowly
        this.mesh.rotation.y += deltaTime * 0.5;
    }

    collect(collector) {
        if (this.collected) return false;
        
        this.collected = true;
        
        // Add to collector's inventory
        if (collector && collector.inventory) {
            // For currency, add to gold
            if (this.type === 'currency') {
                collector.inventory.addGold(this.value * this.quantity);
                
                // Show gold gain message
                if (this.scene.ui) {
                    this.scene.ui.showFloatingText(
                        `+${this.value * this.quantity} Gold`,
                        this.position,
                        'gold'
                    );
                }
            } 
            // For other items, add to inventory
            else if (collector.inventory.addItem(this)) {
                // Show item collected message
                if (this.scene.ui) {
                    this.scene.ui.showFloatingText(
                        `Collected: ${this.name}${this.quantity > 1 ? ` x${this.quantity}` : ''}`,
                        this.position,
                        'white'
                    );
                }
            } else {
                // Inventory full
                this.collected = false;
                return false;
            }
        }
        
        // Play collect sound
        if (this.scene.audio) {
            this.scene.audio.playSound('item_pickup');
        }
        
        // Remove from scene
        this.dispose();
        
        return true;
    }

    use(user) {
        // Apply item effects based on type
        switch (this.type) {
            case 'consumable':
                return this.useConsumable(user);
                
            case 'weapon':
            case 'armor':
                return this.equip(user);
                
            default:
                console.log(`Used ${this.name}`);
                return true;
        }
    }

    useConsumable(user) {
        if (!this.effect) return false;
        
        // Apply health effect
        if (this.effect.health) {
            const healAmount = this.effect.health * (this.effect.isPercentage ? user.maxHealth : 1);
            user.health = Math.min(user.maxHealth, user.health + healAmount);
            
            // Show heal effect
            if (this.scene.ui) {
                this.scene.ui.showFloatingText(
                    `+${Math.ceil(healAmount)} HP`,
                    user.position.add(new BABYLON.Vector3(0, 2, 0)),
                    'green'
                );
            }
        }
        
        // Apply mana effect
        if (this.effect.mana && user.mana !== undefined) {
            const manaAmount = this.effect.mana * (this.effect.isPercentage ? user.maxMana : 1);
            user.mana = Math.min(user.maxMana, user.mana + manaAmount);
            
            // Show mana effect
            if (this.scene.ui) {
                this.scene.ui.showFloatingText(
                    `+${Math.ceil(manaAmount)} MP`,
                    user.position.add(new BABYLON.Vector3(0, 1.8, 0)),
                    'blue'
                );
            }
        }
        
        // Play use sound
        if (this.scene.audio) {
            this.scene.audio.playSound('potion_use');
        }
        
        // Reduce quantity or remove if stack is empty
        if (this.stackable && this.quantity > 1) {
            this.quantity--;
            return false; // Don't remove from inventory
        }
        
        return true; // Remove from inventory
    }

    equip(user) {
        if (!user.equipment || !this.equipSlot) return false;
        
        // Equip the item
        const oldItem = user.equipment.equip(this);
        
        // If there was an old item, add it back to inventory
        if (oldItem) {
            user.inventory.addItem(oldItem);
        }
        
        // Play equip sound
        if (this.scene.audio) {
            this.scene.audio.playSound('equip_armor');
        }
        
        return true;
    }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
    }

    serialize() {
        return {
            type: this.type,
            id: this.id,
            name: this.name,
            description: this.description,
            icon: this.icon,
            value: this.value,
            quantity: this.quantity,
            stackable: this.stackable,
            position: {
                x: this.position.x,
                y: this.position.y,
                z: this.position.z
            },
            // Item-specific properties
            equipSlot: this.equipSlot,
            stats: this.stats,
            damage: this.damage,
            attackSpeed: this.attackSpeed,
            defense: this.defense,
            effect: this.effect,
            cooldown: this.cooldown
        };
    }

    static deserialize(data, scene) {
        if (!data) return null;
        
        return new Item(scene, {
            type: data.type,
            id: data.id,
            name: data.name,
            description: data.description,
            icon: data.icon,
            value: data.value,
            quantity: data.quantity,
            stackable: data.stackable,
            position: new BABYLON.Vector3(
                data.position.x,
                data.position.y,
                data.position.z
            ),
            // Item-specific properties
            equipSlot: data.equipSlot,
            stats: data.stats,
            damage: data.damage,
            attackSpeed: data.attackSpeed,
            defense: data.defense,
            effect: data.effect,
            cooldown: data.cooldown
        });
    }
}

// Simplex Noise for terrain generation
class SimplexNoise {
    constructor(seed = Math.random()) {
        this.grad3 = [
            [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
            [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
            [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
        ];
        
        this.p = [];
        for (let i = 0; i < 256; i++) {
            this.p[i] = Math.floor(this.lerp(seed, 0, 1) * 256);
        }
        
        // To remove the need for index wrapping, double the permutation table length
        this.perm = new Array(512);
        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
        }
    }

    lerp(t, a, b) {
        return a + t * (b - a);
    }

    dot(g, x, y) {
        return g[0] * x + g[1] * y;
    }

    noise2D(xin, yin) {
        // Skew the input space to determine which simplex cell we're in
        const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
        let s = (xin + yin) * F2; // Hairy factor for 2D
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        
        const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
        const t = (i + j) * G2;
        const X0 = i - t; // Unskew the cell origin back to (x,y) space
        const Y0 = j - t;
        const x0 = xin - X0; // The x,y distances from the cell origin
        const y0 = yin - Y0;
        
        // For the 2D case, the simplex shape is an equilateral triangle.
        // Determine which simplex we are in.
        let i1, j1; // Offsets for second (middle) corner of simplex in (i,j) coords
        if (x0 > y0) {
            i1 = 1;
            j1 = 0;
        } else {
            i1 = 0;
            j1 = 1;
        }
        
        // A step of (1,0) in (i,j) means a step of (1-c,-c) in (x,y), and
        // a step of (0,1) in (i,j) means a step of (-c,1-c) in (x,y), where
        // c = (3-sqrt(3))/6
        const x1 = x0 - i1 + G2; // Offsets for middle corner in (x,y) unskewed coords
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + 2.0 * G2; // Offsets for last corner in (x,y) unskewed coords
        const y2 = y0 - 1.0 + 2.0 * G2;
        
        // Work out the hashed gradient indices of the three simplex corners
        const ii = i & 255;
        const jj = j & 255;
        const gi0 = this.perm[ii + this.perm[jj]] % 12;
        const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
        const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;
        
        // Calculate the contribution from the three corners
        let n0, n1, n2; // Noise contributions from the three corners
        
        // Calculate the contribution from the first corner
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 < 0) {
            n0 = 0.0;
        } else {
            t0 *= t0;
            n0 = t0 * t0 * this.dot(this.grad3[gi0], x0, y0); // (x,y) of grad3 used for 2D gradient
        }
        
        // Calculate the contribution from the second corner
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 < 0) {
            n1 = 0.0;
        } else {
            t1 *= t1;
            n1 = t1 * t1 * this.dot(this.grad3[gi1], x1, y1);
        }
        
        // Calculate the contribution from the third corner
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 < 0) {
            n2 = 0.0;
        } else {
            t2 *= t2;
            n2 = t2 * t2 * this.dot(this.grad3[gi2], x2, y2);
        }
        
        // Add contributions from each corner to get the final noise value.
        // The result is scaled to return values in the interval [-1,1].
        return 70.0 * (n0 + n1 + n2);
    }
}

// Export for Node.js/CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        World,
        NPC,
        Enemy,
        Item,
        SimplexNoise
    };
}
