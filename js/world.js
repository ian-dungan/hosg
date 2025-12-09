// Simplex Noise for terrain generation - MOVED TO TOP TO FIX INITIALIZATION ERROR
class SimplexNoise {
    constructor(seed = Math.random()) {
        this.grad3 = [
            [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
            [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
            [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
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
        const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
        let s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);

        const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
        const t = (i + j) * G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = xin - X0;
        const y0 = yin - Y0;

        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

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
        else { t0 *= t0; n0 = t0 * t0 * this.dot(this.grad3[gi0], x0, y0); }

        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 < 0) n1 = 0.0;
        else { t1 *= t1; n1 = t1 * t1 * this.dot(this.grad3[gi1], x1, y1); }

        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 < 0) n2 = 0.0;
        else { t2 *= t2; n2 = t2 * t2 * this.dot(this.grad3[gi2], x2, y2); }

        return 70.0 * (n0 + n1 + n2);
    }
}

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
        this.options = {
            size: options.size || 1000,
            segments: options.segments || 100,
            maxHeight: options.maxHeight || 20,
            seed: options.seed || Math.random(),
            waterLevel: options.waterLevel || 0.2,
            ...options
        };

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
            const player = this.scene.player || this.scene.game?.player;
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
        this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.terrain,
            BABYLON.PhysicsImpostor.MeshImpostor, // Changed to MeshImpostor for accuracy with generated height
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
        // ============================================================
        this.collisionBarrier = this.terrain.clone('terrainCollisionBarrier');
        this.collisionBarrier.material = null;
        this.collisionBarrier.isVisible = false;
        this.collisionBarrier.visibility = 0;
        this.collisionBarrier.renderingGroupId = -1;

        const BARRIER_OFFSET = -0.02;
        this.collisionBarrier.position.y = this.terrain.position.y + BARRIER_OFFSET;

        // Enable collisions and physics so both kinematic and physics actors collide
        this.collisionBarrier.checkCollisions = true;
        this.collisionBarrier.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.collisionBarrier,
            BABYLON.PhysicsImpostor.MeshImpostor,
            {
                mass: 0,
                friction: 1.0,
                restitution: 0.0
            },
            this.scene
        );

        console.log(`[World] ✓ Collision barrier cloned from terrain and offset ${BARRIER_OFFSET}y`);
    }

    generateHeightmap() {
        const positions = this.terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const normals = [];

        // Create noise generator - NOW SAFE BECAUSE CLASS IS HOISTED
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
    // PATCHED: Using direct mesh lookup for 100% accuracy with visual ground
    getTerrainHeight(x, z) {
        if (!this.terrain) return 0;
        // Use Babylon's built-in function to find exact height on the mesh surface
        // This prevents the player feet from clipping or floating
        return this.terrain.getHeightAtCoordinates(x, z);
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
            console.log('[World] Error loading terrain assets:', error);
        }
    }

    createWater() {
        if (this.water) return;

        // Note: The original water creation logic appears to be missing or referencing an external asset helper (`this.game.assets.createProceduralWater`).
        
        // Fallback: Create a simple water plane if the asset helper is not available/visible
        if (!this.game.assets || typeof this.game.assets.createProceduralWater !== 'function') {
             this.water = BABYLON.MeshBuilder.CreateGround("waterPlane", {
                width: this.options.terrainSize * 1.5,
                height: this.options.terrainSize * 1.5,
                subdivisions: 10
            }, this.scene);
            
            this.waterMaterial = new BABYLON.StandardMaterial("waterMat", this.scene);
            this.waterMaterial.diffuseColor = new BABYLON.Color3(0, 0.4, 0.8);
            this.waterMaterial.alpha = 0.8;
            this.water.material = this.waterMaterial;
        } else {
            this.water = this.game.assets.createProceduralWater(
                this.options.terrainSize * 1.5,
                this.scene
            );
        }

        this.water.position.y = this.options.waterLevel;
        this.water.checkCollisions = true; // Enable collisions for the water plane
        
        console.log(`[World] Water created at Y=${this.options.waterLevel}`);
        
        // Load water assets for realism
        this.loadWaterAssets();
    }
    
    // NEW METHOD: Get the water level for the player (Fix #3 Helper)
    getWaterLevel() {
        // Return the Y position of the water plane.
        if (this.water) {
            return this.water.position.y;
        }
        // Fallback to configured level
        return this.options.waterLevel;
    }

    async loadWaterAssets() {
        try {
            const loader = this.assetLoader || new AssetLoader(this.scene);
            const waterData = ASSET_MANIFEST.TERRAIN.WATER;

            if (waterData && this.water && this.water.material && this.water.material.isWaterMaterial) {
                // If using BABYLON's WaterMaterial, apply textures
                
                // Try to load bump map
                if (waterData.bump) {
                    try {
                        const bumpTexture = await loader.loadTexture(waterData.bump);
                        if (bumpTexture) {
                            this.water.material.bumpTexture = bumpTexture;
                            this.water.material.bumpTexture.level = 0.1;
                            console.log('[World] ✓ Water bump texture loaded');
                        }
                    } catch (e) {
                        console.log('[World] Water bump texture not found, using smooth water');
                    }
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
            // Other landmarks
            { type: 'rock', name: 'Eagle Rock', x: 50, z: -50, scale: 1.0 },
            { type: 'tree', name: 'Elderwood', x: -80, z: 20, scale: 2.0 }
        ];

        // Create initial objects
        this.createBuildings(5);
        this.createRocks(10);
        this.createTrees(25);
        this.createGrass(50);
        this.createNPCs(3);
        this.createEnemies(5);
        
        console.log('[World] ✓ World populated');
    }

    // Helper to get actual height at a location, compensating for water
    getHeightAt(x, z) {
        let y = this.getTerrainHeight(x, z);
        const waterY = this.water ? this.water.position.y : -Infinity;
        // If the terrain is below the water, return the water level
        return Math.max(y, waterY); 
    }

    // Helper to place a mesh on the ground/water
    placeOnTerrain(mesh) {
        const x = mesh.position.x || 0;
        const z = mesh.position.z || 0;
        mesh.position.y = this.getHeightAt(x, z);
        mesh.checkCollisions = true; // Ensure new meshes collide
        // Add to shadows
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(mesh);
        }
    }
    
    // Create models for population
    
    createBuildings(count) {
        const buildingMaterial = new BABYLON.StandardMaterial('buildingMaterial', this.scene);
        buildingMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.4, 0.3);

        const spawnRadius = this.options.size * 0.15;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const buildingX = Math.sin(angle) * distance;
            const buildingZ = Math.cos(angle) * distance;
            
            const drySpot = this.findDrySpot(buildingX, buildingZ, 8, 8, 0.4);

            const building = BABYLON.MeshBuilder.CreateBox(`building${i}`, { 
                width: 5 + Math.random() * 5, 
                height: 5 + Math.random() * 10, 
                depth: 5 + Math.random() * 5 
            }, this.scene);

            building.position.x = drySpot.x;
            building.position.z = drySpot.z;
            building.position.y = drySpot.y + building.getBoundingInfo().boundingBox.extendSize.y;
            building.material = buildingMaterial;
            
            this.buildings.push(building);
        }
    }

    createRocks(count) {
        const rockMaterial = new BABYLON.StandardMaterial('rockMaterial', this.scene);
        rockMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.35);

        for (let i = 0; i < count; i++) {
            const rockX = (Math.random() - 0.5) * this.options.size * 0.5;
            const rockZ = (Math.random() - 0.5) * this.options.size * 0.5;
            
            const rock = BABYLON.MeshBuilder.CreateBox(`rock${i}`, { size: 1 }, this.scene);

            // Vary scale to look more natural
            rock.scaling.y *= 0.5 + Math.random() * 0.5;
            rock.scaling.x *= 0.7 + Math.random() * 0.6;
            rock.scaling.z *= 0.7 + Math.random() * 0.6;
            
            rock.material = rockMaterial;
            
            const drySpot = this.findDrySpot(rockX, rockZ, 8, 8, 0.4);
            
            rock.position = new BABYLON.Vector3(drySpot.x, drySpot.y + rock.getBoundingInfo().boundingBox.extendSize.y, drySpot.z);
            rock.rotation.y = Math.random() * Math.PI * 2;

            this.rocks.push(rock);
        }
    }

    createTrees(count) {
        const treeMaterial = new BABYLON.StandardMaterial('treeMaterial', this.scene);
        treeMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.1);

        const trunkMaterial = new BABYLON.StandardMaterial('trunkMaterial', this.scene);
        trunkMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.3, 0.1);

        for (let i = 0; i < count; i++) {
            const treeX = (Math.random() - 0.5) * this.options.size * 0.4;
            const treeZ = (Math.random() - 0.5) * this.options.size * 0.4;
            
            const drySpot = this.findDrySpot(treeX, treeZ, 8, 8, 0.4);

            // Trunk
            const trunk = BABYLON.MeshBuilder.CreateCylinder(`trunk${i}`, { 
                height: 5 + Math.random() * 3, 
                diameter: 0.5 
            }, this.scene);
            trunk.material = trunkMaterial;
            
            // Leaves (simplified sphere)
            const leaves = BABYLON.MeshBuilder.CreateSphere(`leaves${i}`, { 
                diameter: 3 + Math.random() * 3 
            }, this.scene);
            leaves.material = treeMaterial;
            
            // Combine
            const treeRoot = new BABYLON.Mesh('treeRoot', this.scene);
            trunk.parent = treeRoot;
            leaves.parent = treeRoot;
            
            trunk.position.y = trunk.getBoundingInfo().boundingBox.extendSize.y;
            leaves.position.y = trunk.position.y + trunk.getBoundingInfo().boundingBox.extendSize.y + leaves.getBoundingInfo().boundingBox.extendSize.y * 0.5;
            
            treeRoot.position = new BABYLON.Vector3(drySpot.x, drySpot.y, drySpot.z);
            
            this.trees.push(treeRoot);
        }
    }

    createGrass(count) {
        const grassMaterial = new BABYLON.StandardMaterial('grassMaterial', this.scene);
        grassMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.6, 0.2);
        grassMaterial.alpha = 0.8;
        grassMaterial.backFaceCulling = false;

        for (let i = 0; i < count; i++) {
            const grass = BABYLON.MeshBuilder.CreateGround(`grass${i}`, { width: 1 + Math.random() * 2, height: 0.1, subdivisions: 1 }, this.scene);
            
            grass.rotation.x = Math.PI / 2; // Lay it flat
            grass.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; // Always face camera
            
            grass.material = grassMaterial;
            
            // Position the grass
            const grassX = (Math.random() - 0.5) * this.options.size * 0.5;
            const grassZ = (Math.random() - 0.5) * this.options.size * 0.5;
            
            const drySpot = this.findDrySpot(grassX, grassZ, 8, 8, 0.1);
            
            grass.position = new BABYLON.Vector3(drySpot.x, drySpot.y, drySpot.z);

            // Random rotation
            grass.rotation.y = Math.random() * Math.PI * 2; 

            this.grass.push(grass);
        }
    }

    createNPCs(count) {
        // Assume NPC class is defined elsewhere (e.g., world.js snippet shows an NPC class)
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * 50;
            const position = new BABYLON.Vector3(
                Math.sin(angle) * distance,
                0,
                Math.cos(angle) * distance
            );
            position.y = this.getHeightAt(position.x, position.z);
            
            // Assume NPC is a global class or imported
            if (typeof NPC !== 'undefined') {
                const npc = new NPC(this.scene, { name: `NPC ${i + 1}`, position });
                this.npcs.push(npc);
            }
        }
    }
    
    createEnemies(count) {
        // Assume Enemy class is defined elsewhere
        const spawnRadius = Math.min(80, this.options.size * 0.2); 
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const position = new BABYLON.Vector3(
                Math.sin(angle) * distance,
                0,
                Math.cos(angle) * distance
            );
            position.y = this.getHeightAt(position.x, position.z);
            
            if (typeof Enemy !== 'undefined') {
                const enemy = new Enemy(this.scene, { name: `Enemy ${i + 1}`, position, health: 50 });
                this.enemies.push(enemy);
            }
        }
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
            
            // Track the highest spot even if it's underwater
            if (candY > best.y) {
                best = { x: candX, z: candZ, y: candY };
            }
        }
        
        // Return best available spot (might still be wet)
        return best;
    }
    
    setupEventListeners() {
        // Example: Handle global events like network updates, etc.
        if (this.scene.game?.network) {
            this.scene.game.network.on('playerJoined', this.handlePlayerJoined.bind(this));
        }
    }
    
    handlePlayerJoined(data) {
        console.log(`[World] Player ${data.id} joined!`);
        // Logic to spawn a remote player mesh
    }

    update(deltaTime) {
        // Update time of day (24-hour cycle)
        this.time += deltaTime * 0.01; // Speed up time for demo
        if (this.time >= 24) {
            this.time = 0;
            this.day++;
        }

        // Update lighting based on time of day
        this.updateLighting();

        // Update weather (if implemented)
        // this.updateWeather(deltaTime);

        // Update all entities
        // Update NPCs
        for (const npc of this.npcs) {
            if (npc.update) npc.update(deltaTime);
        }
        // Update enemies
        for (const enemy of this.enemies) {
            if (enemy.update) enemy.update(deltaTime);
        }
        // Update items
        for (const item of this.items) {
            if (item.update) item.update(deltaTime);
        }
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
            this.sunLight.intensity = BABYLON.Scalar.Lerp(0.5, 1.0, (Math.cos(sunAngle * 2) + 1) / 2);
            this.ambientLight.intensity = BABYLON.Scalar.Lerp(0.4, 0.6, (Math.cos(sunAngle * 2) + 1) / 2);
        } else {
            // Night time (ambient moon light)
            this.sunLight.intensity = BABYLON.Scalar.Lerp(0.05, 0.5, (1 - (Math.cos(sunAngle * 2) + 1) / 2));
            this.ambientLight.intensity = 0.2;
        }

        // Skybox/Fog changes based on time could go here
    }

    dispose() {
        console.log('[World] Disposing resources');
        // Dispose of all meshes/materials
        if (this.terrain) this.terrain.dispose();
        if (this.water) this.water.dispose();
        if (this.skybox) this.skybox.dispose();
        if (this.sunLight) this.sunLight.dispose();
        if (this.ambientLight) this.ambientLight.dispose();
        if (this.terrainMaterial) this.terrainMaterial.dispose();
        if (this.waterMaterial) this.waterMaterial.dispose();

        // Dispose entities
        this.npcs.forEach(e => e.dispose());
        this.enemies.forEach(e => e.dispose());
        this.items.forEach(e => e.dispose());
        this.trees.forEach(e => e.dispose());
        this.rocks.forEach(e => e.dispose());
        this.grass.forEach(e => e.dispose());
    }
}

// Export for Node.js/CommonJS
if (typeof module !== 'undefined' && module.exports) {
    // Assuming NPC, Enemy, Item are defined elsewhere and exported
    // module.exports = {
    //     World,
    //     NPC,
    //     Enemy,
    //     Item,
    //     SimplexNoise
    // };
}
