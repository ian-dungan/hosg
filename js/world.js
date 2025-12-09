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
        this.landmarks = []; // Initialize landmarks array

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
    
    // PATCH START: Add missing accessor function for UIManager
    /**
     * Retrieves the list of static world landmarks.
     * This method is required by UIManager for the minimap display.
     * @returns {Array<Object>}
     */
    getLandmarks() {
        return this.landmarks;
    }
    // PATCH END

    async loadTerrainAssets() {
        try {
            const loader = this.assetLoader || new AssetLoader(this.scene);

            // Try to load grass textures
            const grassData = ASSET_MANIFEST.TERRAIN.GROUND.grass;

            if (grassData && grassData.diffuse) {
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
        } catch (error) {
            console.log('[World] Terrain asset loading skipped due to missing AssetLoader or manifest');
        }
    }

    createWater() {
        // Water
        if (this.water) return;

        const size = this.options.size * 2; // Water bigger than terrain
        const level = this.options.waterLevel;

        this.water = BABYLON.MeshBuilder.CreateGround('water', {
            width: size,
            height: size,
            subdivisions: 32
        }, this.scene);
        this.water.position.y = level;

        // Create water material (Requires BABYLON.WaterMaterial)
        if (typeof BABYLON.WaterMaterial !== 'undefined') {
            this.waterMaterial = new BABYLON.WaterMaterial('waterMaterial', this.scene, new BABYLON.Vector2(1024, 1024));
            this.waterMaterial.backFaceCulling = true;
            this.waterMaterial.windForce = -5;
            this.waterMaterial.waveHeight = 0.5;
            this.waterMaterial.waterColor = new BABYLON.Color3(0.1, 0.4, 0.5);
            this.waterMaterial.waterColorLevel = 0.3;
            this.waterMaterial.fresnelLevel = 0.8;
            this.waterMaterial.waveLength = 0.1;

            // Add mesh to render list
            if (this.skybox) {
                this.waterMaterial.addToRenderList(this.skybox);
            }
            if (this.terrain) {
                this.waterMaterial.addToRenderList(this.terrain);
            }

            this.water.material = this.waterMaterial;
            console.log('[World] ✓ Water created');

            // Load bump texture
            this.loadWaterAssets();

        } else {
            // Fallback to simple solid blue material
            const simpleMat = new BABYLON.StandardMaterial('simpleWaterMat', this.scene);
            simpleMat.diffuseColor = new BABYLON.Color3(0.1, 0.4, 0.5);
            simpleMat.specularColor = new BABYLON.Color3(0, 0, 0);
            simpleMat.alpha = 0.8;
            this.water.material = simpleMat;
            console.warn('[World] WaterMaterial not found, using basic material');
        }

        this.water.isPickable = false;
        this.water.freezeWorldMatrix(); // Static mesh
    }

    async loadWaterAssets() {
        try {
            const loader = this.assetLoader || new AssetLoader(this.scene);
            const waterData = ASSET_MANIFEST.TERRAIN.WATER;

            if (waterData.bump) {
                try {
                    const bumpTexture = await loader.loadTexture(waterData.bump);
                    if (bumpTexture && this.waterMaterial) {
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
            { type: 'building', name: 'Town Hall', x: 0, z: 0, icon: 'house' },
            { type: 'building', name: 'Marketplace', x: 50, z: 50, icon: 'cart' },
            // Wilderness Points of Interest
            { type: 'poi', name: 'Ancient Ruins', x: 200, z: -150, icon: 'castle' },
            { type: 'poi', name: 'The Lonely Tower', x: -350, z: 250, icon: 'tower' },
            { type: 'cave', name: 'Spider Cave Entrance', x: -100, z: -100, icon: 'skull' }
        ];

        // Create initial environment entities
        this.createTrees(500);
        this.createRocks(50);
        this.createGrass(1000);
        this.createBuildings(5);
        this.createNPCs(10);
        this.createEnemies(20);
    }

    // Helper to place mesh on the terrain surface
    placeOnTerrain(mesh, offsetY = 0) {
        const x = mesh.position.x || (Math.random() - 0.5) * this.options.size;
        const z = mesh.position.z || (Math.random() - 0.5) * this.options.size;
        const y = this.getTerrainHeight(x, z) + offsetY;

        mesh.position.x = x;
        mesh.position.y = y;
        mesh.position.z = z;
    }

    // Helper to get exact height (used by Entities)
    getHeightAt(x, z) {
        return this.getTerrainHeight(x, z);
    }

    createTrees(count) {
        const treeMaterial = new BABYLON.StandardMaterial('treeMaterial', this.scene);
        treeMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.6, 0.3);

        for (let i = 0; i < count; i++) {
            // Create a simple cylinder for the trunk
            const trunk = BABYLON.MeshBuilder.CreateCylinder(`trunk${i}`, {
                height: 5 + Math.random() * 3,
                diameter: 0.5
            }, this.scene);
            trunk.material = new BABYLON.StandardMaterial('trunkMat', this.scene);
            trunk.material.diffuseColor = new BABYLON.Color3(0.5, 0.4, 0.3);

            // Create a simple sphere for the leaves
            const leaves = BABYLON.MeshBuilder.CreateSphere(`leaves${i}`, {
                diameter: 5 + Math.random() * 2
            }, this.scene);
            leaves.material = treeMaterial;
            leaves.parent = trunk;
            leaves.position.y = trunk.getBoundingInfo().boundingBox.maximumWorld.y - 0.5;

            // Combine into a single tree root (using TransformNode for complex models)
            const treeRoot = new BABYLON.TransformNode(`treeRoot${i}`, this.scene);
            trunk.parent = treeRoot;
            leaves.parent = treeRoot;

            // Position the tree
            this.placeOnTerrain(treeRoot, 0); // Position at Y=0 relative to the center of the base

            // Enable shadows
            trunk.receiveShadows = true;
            leaves.receiveShadows = true;
            if (this.shadowGenerator) {
                this.shadowGenerator.addShadowCaster(trunk);
                this.shadowGenerator.addShadowCaster(leaves);
            }

            this.trees.push(treeRoot);
        }
    }

    createRocks(count) {
        const rockMaterial = new BABYLON.StandardMaterial('rockMaterial', this.scene);
        rockMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
        rockMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

        const spawnRadius = this.options.size * 0.4;
        const chunkSize = this.options.size / this.options.segments;

        for (let i = 0; i < count; i++) {
            // Bias positions toward the center of the map
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const rockX = Math.sin(angle) * distance;
            const rockZ = Math.cos(angle) * distance;

            // Create a low-poly rock shape (IcoSphere)
            const rock = BABYLON.MeshBuilder.CreateIcoSphere(`rock${i}`, {
                radius: 1 + Math.random() * 2,
                subdivisions: 1
            }, this.scene);

            // Random scaling
            rock.scaling.y *= 0.5 + Math.random() * 0.5;
            rock.scaling.x *= 0.7 + Math.random() * 0.6;
            rock.scaling.z *= 0.7 + Math.random() * 0.6;
            rock.material = rockMaterial;

            // Find a dry spot, or fall back to current spot
            const drySpot = this.findDrySpot(rockX, rockZ, 8, 8, 0.4);

            rock.position = new BABYLON.Vector3(drySpot.x, drySpot.y, drySpot.z);
            rock.rotation.y = Math.random() * Math.PI * 2;

            // Store landmark info on first rock if it's a designated landmark
            const landmarkData = this.landmarks.find(l => l.type === 'poi' && l.name === 'Ancient Ruins');
            if (landmarkData && i === 0) { // Simple assignment for demo
                rock.landmarkData = landmarkData;
            }

            this.rocks.push(rock);
            if (this.shadowGenerator) {
                this.shadowGenerator.addShadowCaster(rock);
            }
        }
    }

    createGrass(count) {
        // Simple translucent green material for grass patches
        const grassMaterial = new BABYLON.StandardMaterial('grassMaterial', this.scene);
        grassMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.6, 0.2);
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
            grass.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; // Always face camera

            // Set material
            grass.material = grassMaterial;

            // Position the grass
            this.placeOnTerrain(grass, 0.05); // Slightly lift off the ground

            // Random rotation
            grass.rotation.y = Math.random() * Math.PI * 2;

            // Add to grass array
            this.grass.push(grass);
        }
    }

    createBuildings(count) {
        // Use defined landmarks for building locations
        const buildingLandmarks = this.landmarks.filter(l => l.type === 'building');
        const buildingMaterial = new BABYLON.StandardMaterial('buildingMaterial', this.scene);
        buildingMaterial.diffuseColor = new BABYLON.Color3(0.8, 0.7, 0.6);

        for (let i = 0; i < buildingLandmarks.length; i++) {
            const landmark = buildingLandmarks[i];

            // Create a simple box placeholder
            const building = BABYLON.MeshBuilder.CreateBox(`building${i}`, {
                width: 15,
                height: 10 + Math.random() * 5,
                depth: 15
            }, this.scene);

            building.material = buildingMaterial;

            // Position based on landmark data
            building.position.x = landmark.x;
            building.position.z = landmark.z;

            // Find terrain height at the position and place the base of the building there
            const groundY = this.getTerrainHeight(landmark.x, landmark.z);
            building.position.y = groundY + (building.getBoundingInfo().boundingBox.maximumWorld.y - building.getBoundingInfo().boundingBox.minimumWorld.y) / 2;

            // Add metadata for potential interaction/UI
            building.metadata = { isBuilding: true, name: landmark.name, landmark: true };
            building.checkCollisions = true;

            this.buildings.push(building);
        }
    }

    createNPCs(count) {
        if (typeof NPC === 'undefined') {
            console.warn('[World] NPC class not defined, skipping NPC creation.');
            return;
        }

        const spawnRadius = Math.min(100, this.options.size * 0.2);

        for (let i = 0; i < count; i++) {
            // Random position near the town center (0, 0)
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const x = Math.sin(angle) * distance;
            const z = Math.cos(angle) * distance;
            const position = new BABYLON.Vector3(x, 0, z);

            // Snap to ground
            position.y = this.getHeightAt(position.x, position.z);

            const npc = new NPC(this.scene, {
                name: `NPC ${i + 1}`,
                position: position,
                dialogue: [
                    'Welcome to Shady Grove!',
                    'The world is beautiful today.',
                    'Have you seen the mayor?',
                    'Beware of the wolves in the forest.'
                ],
                walkRadius: 20
            });

            // Add to NPCs array
            this.npcs.push(npc);
        }
    }

    createEnemies(count) {
        if (typeof Enemy === 'undefined') {
            console.warn('[World] Enemy class not defined, skipping Enemy creation.');
            return;
        }

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
                health: 50,
                attackDamage: 5,
                detectionRange: 15
            });

            // Add to enemies array
            this.enemies.push(enemy);
        }
    }

    findDrySpot(x, z, attempts = 10, radius = 8, margin = 0.3) {
        const waterY = this.water ? this.water.position.y : -Infinity;

        // Fast path if we're already above the water line
        const currentY = this.getHeightAt(x, z);
        if (currentY > waterY + margin) {
            return { x, z, y: currentY };
        }

        let best = { x, z, y: currentY }; // Fallback to current spot

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

        return best; // Return the spot with the highest elevation
    }

    setupEventListeners() {
        this.scene.onBeforeRenderObservable.add(() => {
            this.update();
        });
    }

    update() {
        // Update time of day (24-hour cycle)
        const deltaTime = this.scene.getEngine().getDeltaTime() / 1000; // Convert to seconds
        this.time += deltaTime * 0.01; // Speed up time for demo
        if (this.time >= 24) {
            this.time = 0;
            this.day++;
        }

        // Update lighting based on time of day
        this.updateLighting();

        // Update all entities
        // Update NPCs
        for (const npc of this.npcs) {
            if (npc.update) npc.update(deltaTime);
        }

        // Update enemies
        for (const enemy of this.enemies) {
            if (enemy.update) enemy.update(deltaTime);
        }
        
        // Update items (for despawn timers, floating animation, etc.)
        for (const item of this.items) {
            if (item.update) item.update(deltaTime);
        }

        // Update water
        if (this.waterMaterial) {
            this.waterMaterial.bumpTexture.vOffset += this.waterMaterial.windForce * 0.00001;
            this.waterMaterial.bumpTexture.uOffset += this.waterMaterial.windForce * 0.000005;
        }

        // Check weather transition
        this.updateWeather(deltaTime);
    }

    updateLighting() {
        // Calculate sun position based on time of day
        const hour = this.time;
        const isDay = hour > 6 && hour < 20;

        // Update sun position (0-24 hours maps to 0-2π radians)
        const sunAngle = (hour / 24) * Math.PI * 2;

        this.sunLight.direction = new BABYLON.Vector3(
            Math.sin(sunAngle),
            Math.cos(sunAngle) * 2 - 1, // Sun higher at noon
            Math.cos(sunAngle) * 0.5
        );

        // Adjust light intensity and color based on time of day
        let sunIntensity = isDay ? 1.0 : 0.2;
        let ambientIntensity = isDay ? 0.5 : 0.1;
        let clearColor = isDay ? new BABYLON.Color4(0.5, 0.7, 0.9, 1.0) : new BABYLON.Color4(0.1, 0.1, 0.2, 1.0);

        if (hour < 6 || hour > 20) { // Night
            sunIntensity *= 0.1; // Moonlight effect
            ambientIntensity *= 0.5;
            clearColor = new BABYLON.Color4(0.05, 0.05, 0.1, 1.0);
        } else if (hour < 7 || hour > 19) { // Dawn/Dusk
            const t = hour < 7 ? (hour - 6) / 1 : (20 - hour) / 1;
            sunIntensity *= 0.5 + t * 0.5;
            ambientIntensity *= 0.2 + t * 0.8;
            clearColor = new BABYLON.Color4(0.3, 0.5, 0.7, 1.0);
        }

        this.sunLight.intensity = sunIntensity;
        this.ambientLight.intensity = ambientIntensity;
        this.scene.clearColor = clearColor;
    }

    updateWeather(deltaTime) {
        // Simple linear transition for intensity
        if (this.weatherIntensity !== this.weatherTargetIntensity) {
            const diff = this.weatherTargetIntensity - this.weatherIntensity;
            const change = Math.sign(diff) * this.weatherTransitionSpeed * deltaTime;

            if (Math.abs(diff) < Math.abs(change)) {
                this.weatherIntensity = this.weatherTargetIntensity;
            } else {
                this.weatherIntensity += change;
            }
        }

        // Apply visual/sound effects based on current weather
        // (Currently only simple start/stop logic implemented in setWeather)
    }

    setWeather(type) {
        // Clear existing weather effects
        this.clearWeather();

        this.weather = type;
        this.weatherIntensity = 0;

        // Start new weather effects
        switch (type) {
            case 'rain': this.startRain(); break;
            case 'snow': this.startSnow(); break;
            case 'storm': this.startStorm(); break;
            case 'clear':
            default: this.clearWeather(); break;
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
        this.rainSystem.color2 = new BABYLON.Color4(0.5, 0.5, 0.8, 1.0);
        this.rainSystem.direction1 = new BABYLON.Vector3(-0.5, -2, -0.5);
        this.rainSystem.direction2 = new BABYLON.Vector3(0.5, -3, 0.5);
        this.rainSystem.minLifeTime = 0.5;
        this.rainSystem.maxLifeTime = 1.5;
        this.rainSystem.emitRate = 2000;
        this.rainSystem.gravity = new BABYLON.Vector3(0, -9.81, 0);

        this.rainSystem.start();
        this.weatherTargetIntensity = 1.0;
        console.log('[World] Started rain');
    }

    startSnow() {
        // Create snow particle system
        if (this.snowSystem) return;

        this.snowSystem = new BABYLON.ParticleSystem('snow', 5000, this.scene);
        this.snowSystem.particleTexture = new BABYLON.Texture('assets/textures/snow.png', this.scene);

        // Configure snow
        this.snowSystem.emitter = new BABYLON.Vector3(0, 50, 0);
        this.snowSystem.minEmitBox = new BABYLON.Vector3(-100, 0, -100);
        this.snowSystem.maxEmitBox = new BABYLON.Vector3(100, 0, 100);
        this.snowSystem.color1 = new BABYLON.Color4(1.0, 1.0, 1.0, 1.0);
        this.snowSystem.color2 = new BABYLON.Color4(0.8, 0.8, 0.9, 1.0);
        this.snowSystem.direction1 = new BABYLON.Vector3(-0.1, -0.5, -0.1);
        this.snowSystem.direction2 = new BABYLON.Vector3(0.1, -1.0, 0.1);
        this.snowSystem.minLifeTime = 5.0;
        this.snowSystem.maxLifeTime = 10.0;
        this.snowSystem.emitRate = 500;
        this.snowSystem.gravity = new BABYLON.Vector3(0, -0.5, 0);
        this.snowSystem.minSize = 0.1;
        this.snowSystem.maxSize = 0.5;

        this.snowSystem.start();
        this.weatherTargetIntensity = 1.0;
        console.log('[World] Started snow');
    }

    startStorm() {
        this.startRain();
        // Simulate lightning with a momentary light flash
        this.lightningInterval = setInterval(() => {
            if (Math.random() < 0.3) { // 30% chance every few seconds
                this.simulateLightning();
            }
        }, 3000);
        this.weatherTargetIntensity = 1.0;
        console.log('[World] Started storm');
    }

    simulateLightning() {
        // Create a temporary, intense point light
        const flash = new BABYLON.PointLight('lightning', BABYLON.Vector3.Zero(), this.scene);
        flash.intensity = 5;
        flash.diffuse = new BABYLON.Color3(1, 1, 1);
        flash.specular = new BABYLON.Color3(1, 1, 1);

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
        this.weatherTargetIntensity = 0;
        this.weather = 'clear';
        console.log('[World] Weather cleared');
    }

    dispose() {
        console.log('[World] Disposing resources');

        // Stop updates and listeners
        this.scene.onBeforeRenderObservable.clear();

        // Dispose meshes and materials
        if (this.terrain) this.terrain.dispose();
        if (this.terrainMaterial) this.terrainMaterial.dispose();
        if (this.water) this.water.dispose();
        if (this.waterMaterial) this.waterMaterial.dispose();
        if (this.skybox) this.skybox.dispose();

        // Dispose lights
        if (this.sunLight) this.sunLight.dispose();
        if (this.ambientLight) this.ambientLight.dispose();
        if (this.shadowGenerator) this.shadowGenerator.dispose();

        // Dispose entities
        [...this.trees, ...this.rocks, ...this.grass, ...this.buildings, ...this.items].forEach(mesh => mesh.dispose());

        // Dispose complex entities (NPCs, enemies)
        this.npcs.forEach(npc => npc.dispose());
        this.enemies.forEach(enemy => enemy.dispose());

        // Clear weather effects
        this.clearWeather();

        // Remove global references
        if (this.scene && this.scene.world) this.scene.world = null;
        if (this.scene && this.scene.game && this.scene.game.world) this.scene.game.world = null;
        if (window.gameWorld === this) window.gameWorld = null;

        console.log('[World] ✓ Disposal complete');
    }
}


// Base NPC class
function NPC(scene, options) {
    Entity.call(this, scene, options.position);
    this.name = options.name || 'NPC';
    this.dialogue = options.dialogue || ['Hello.'];
    this.walkRadius = options.walkRadius || 10;
    this.state = 'idle'; // idle, walking, talking
    this.walkSpeed = 1.0;
    this.targetPosition = null;
    this.talkingTo = null;
    this.isInteractable = true;
    this.meshType = options.meshType || 'simple'; // or 'model'

    this.init();
}
NPC.prototype = Object.create(Entity.prototype);
NPC.prototype.constructor = NPC;

NPC.prototype.init = function () {
    this.createMesh();
    this.setupAnimations();
};

NPC.prototype.createMesh = function () {
    if (this.meshType === 'simple') {
        // Create simple mesh placeholder
        this.mesh = BABYLON.MeshBuilder.CreateCylinder('npc', {
            height: 1.8,
            diameter: 0.8
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
    // TODO: Add complex model loading logic here if meshType is 'model'
};

NPC.prototype.setupAnimations = function () {
    // Setup animation groups (using dummy animations for simple mesh)
    this.animations = {
        idle: { start: () => { console.log(`${this.name} is idling`); } },
        walk: { start: () => { console.log(`${this.name} is walking`); } },
        wave: { start: () => { console.log(`${this.name} is waving`); } }
    };

    // Start with idle animation
    this.animations.idle.start();
};

NPC.prototype.update = function (deltaTime) {
    Entity.prototype.update.call(this, deltaTime); // Update position

    if (this.state === 'idle') {
        if (Math.random() < 0.005) { // Small chance to start wandering
            this.startWandering();
        }
    } else if (this.state === 'walking') {
        const toTarget = this.targetPosition.subtract(this.position);
        toTarget.y = 0; // Ignore height difference for direction calculation
        const distance = toTarget.length();

        if (distance < 0.5) {
            this.state = 'idle';
            this.animations.idle.start();
            return;
        }

        const direction = toTarget.normalize();
        const velocity = direction.scale(this.walkSpeed * deltaTime);

        this.position.addInPlace(velocity);

        // Simple rotation (look at target)
        const targetAngle = Math.atan2(direction.x, direction.z);
        this.mesh.rotation.y = BABYLON.Scalar.Lerp(this.mesh.rotation.y, targetAngle, 0.1);

        // Snap to ground every frame
        this.snapToGround();
    }
    // Talking state does not require movement updates
};

NPC.prototype.snapToGround = function () {
    if (this.scene.world && this.scene.world.getTerrainHeight) {
        const groundY = this.scene.world.getTerrainHeight(this.position.x, this.position.z);
        if (groundY !== null) {
            this.position.y = groundY + this.mesh.getBoundingInfo().boundingBox.extendSize.y;
        }
    }
};

NPC.prototype.startWandering = function () {
    // Find a random position within walk radius
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * this.walkRadius;
    this.targetPosition = new BABYLON.Vector3(
        this.position.x + Math.sin(angle) * distance,
        this.position.y,
        this.position.z + Math.cos(angle) * distance
    );

    // Make sure the target position is on the terrain
    if (this.scene.world && this.scene.world.getTerrainHeight) {
        this.targetPosition.y = this.scene.world.getTerrainHeight(
            this.targetPosition.x,
            this.targetPosition.z
        );
    }

    this.state = 'walking';
    this.animations.walk.start();
};

NPC.prototype.talkTo = function (player) {
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
};

NPC.prototype.playAnimation = function (name) {
    if (this.animations[name]) {
        this.animations[name].start();
    }
};


// Base Enemy class
function Enemy(scene, options) {
    NPC.call(this, scene, options); // Inherit from NPC (for now, simple)
    this.health = options.health || 100;
    this.maxHealth = options.health || 100;
    this.attackDamage = options.attackDamage || 10;
    this.detectionRange = options.detectionRange || 20;
    this.attackRange = options.attackRange || 2;
    this.state = 'idle'; // idle, chasing, attacking
    this.target = null;
    this.moveSpeed = 2.5; // Enemies are faster
    this.isEnemy = true;
    this.assetKey = options.assetKey || 'wolf';

    this.init();
}
Enemy.prototype = Object.create(NPC.prototype);
Enemy.prototype.constructor = Enemy;

// Overload init to use model loading
Enemy.prototype.init = function () {
    this.createMesh();
    this.loadModel();
    this.setupAnimations();
    this.mesh.metadata = { isEnemy: true, entity: this };
};

Enemy.prototype.loadModel = async function () {
    if (typeof window.ASSET_MANIFEST === 'undefined' || !window.ASSET_MANIFEST.CHARACTERS.ENEMIES[this.assetKey]) {
        console.warn(`[Enemy] Asset manifest not found for ${this.assetKey}, using simple mesh`);
        return;
    }

    const enemyConfig = window.ASSET_MANIFEST.CHARACTERS.ENEMIES[this.assetKey];
    const modelPath = window.ASSET_MANIFEST.BASE_PATH + enemyConfig.model;
    const requestedScale = enemyConfig.scale || 1.0;

    try {
        const loader = this.scene.assetLoader || new AssetLoader(this.scene);
        const model = await loader.loadModel(modelPath, {
            scene: this.scene,
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

            // Set metadata
            this.mesh.metadata = { isEnemy: true, entity: this };

            console.log(`[Enemy] ✓ Model loaded for ${this.name}`);
        });

    } catch (err) {
        console.error(`[Enemy] Error loading model ${this.assetKey}:`, err);
    }
};

Enemy.prototype.update = function (deltaTime) {
    // State machine for enemy behavior
    this.findTarget();

    if (this.target) {
        // Player is nearby
        const playerPos = this.target.mesh.position;
        const distance = BABYLON.Vector3.Distance(this.position, playerPos);

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
        if (this.state !== 'walking') {
            this.state = 'idle';
        }
    }

    // Call base update (for walking logic)
    if (this.state === 'walking') {
        NPC.prototype.update.call(this, deltaTime);
    }
};

Enemy.prototype.findTarget = function () {
    // In a real game, you would use a spatial partitioning system
    // to efficiently find nearby players
    if (this.scene.player && this.scene.player.mesh && this.scene.player.mesh.position) {
        const playerPos = this.scene.player.mesh.position;
        if (BABYLON.Vector3.Distance(this.position, playerPos) <= this.detectionRange) {
            this.target = this.scene.player;
        }
    }
};

Enemy.prototype.chaseTarget = function (deltaTime) {
    if (!this.target || !this.target.mesh || !this.target.mesh.position) return;

    this.targetPosition = this.target.mesh.position.clone();
    this.targetPosition.y = this.getHeightAt(this.targetPosition.x, this.targetPosition.z); // Target on the ground

    // Movement calculation
    const toTarget = this.targetPosition.subtract(this.position);
    toTarget.y = 0;
    const direction = toTarget.normalize();
    const velocity = direction.scale(this.moveSpeed * deltaTime);

    this.position.addInPlace(velocity);

    // Simple rotation (look at target)
    const targetAngle = Math.atan2(direction.x, direction.z);
    this.mesh.rotation.y = BABYLON.Scalar.Lerp(this.mesh.rotation.y, targetAngle, 0.2);

    this.snapToGround();
};

Enemy.prototype.attack = function () {
    if (!this.target) return;
    // Simple attack logic
    console.log(`${this.name} attacked ${this.target.name || 'Player'} for ${this.attackDamage} damage!`);
    // NOTE: In a full game, you'd add a cooldown, animation, and damage calculation
};

Enemy.prototype.takeDamage = function (damage, source) {
    this.health -= damage;
    console.log(`${this.name} took ${damage} damage, health remaining: ${this.health}`);

    if (this.health <= 0) {
        this.die(source);
    }
};

Enemy.prototype.die = function (killer) {
    console.log(`${this.name} died.`);
    this.dropLoot(killer);
    // Remove from world entities list
    const index = this.scene.game.world.enemies.indexOf(this);
    if (index > -1) {
        this.scene.game.world.enemies.splice(index, 1);
    }
    this.dispose();
};

Enemy.prototype.dropLoot = function (killer) {
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
            // Need item config lookup for this to work properly
            const itemInstance = new Item(this.scene, {
                type: 'consumable', // Assuming generic item for now
                id: item.id,
                name: item.id,
                value: 10,
                position: this.position.clone()
            });
            if (this.scene.world && this.scene.world.items) {
                this.scene.world.items.push(itemInstance);
            }
        }
    }
};


// Item Class
function Item(scene, options) {
    Entity.call(this, scene, options.position);
    this.type = options.type || 'generic'; // weapon, armor, consumable, currency
    this.id = options.id || 'item_unknown';
    this.name = options.name || 'Unknown Item';
    this.description = options.description || '';
    this.icon = options.icon || 'placeholder';
    this.value = options.value || 0;
    this.quantity = options.quantity || 1;
    this.stackable = options.stackable === undefined ? true : options.stackable;

    // Item-specific properties (optional)
    this.equipSlot = options.equipSlot; // head, chest, weapon, etc.
    this.stats = options.stats; // stat bonuses
    this.damage = options.damage;
    this.attackSpeed = options.attackSpeed;
    this.defense = options.defense;
    this.effect = options.effect; // e.g., 'Heal(50)'
    this.cooldown = options.cooldown;

    this.isPickable = true;

    this.init();
}
Item.prototype = Object.create(Entity.prototype);
Item.prototype.constructor = Item;

Item.prototype.init = function () {
    this.createMesh();
    this.setupPhysics();
    this.snapToGround();
};

Item.prototype.createMesh = function () {
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
                size: 0.2
            }, this.scene);
            break;
    }

    // Basic material
    this.mesh.material = new BABYLON.StandardMaterial(`itemMat_${this.id}`, this.scene);
    this.mesh.material.diffuseColor = new BABYLON.Color3(Math.random(), Math.random(), Math.random());
    this.mesh.material.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);

    this.mesh.position.copyFrom(this.position);
    this.mesh.isPickable = true;
    this.mesh.metadata = { isItem: true, entity: this };
};

Item.prototype.setupPhysics = function () {
    // Make the item static after a short time to prevent infinite rolling
    setTimeout(() => {
        if (this.mesh && typeof BABYLON.PhysicsImpostor !== 'undefined') {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh,
                BABYLON.PhysicsImpostor.BoxImpostor, // Use Box or Sphere
                {
                    mass: 0, // Set to static
                    friction: 0.5,
                    restitution: 0.2
                },
                this.scene
            );
        }
    }, 500);
};

Item.prototype.snapToGround = function () {
    if (this.scene.world && this.scene.world.getHeightAt) {
        const groundY = this.scene.world.getHeightAt(this.position.x, this.position.z);
        if (groundY !== null) {
            this.position.y = groundY + this.mesh.getBoundingInfo().boundingBox.extendSize.y;
        }
    }
};

Item.prototype.update = function (deltaTime) {
    // Simple floating animation
    const time = performance.now() / 1000;
    this.position.y += Math.sin(time * 5) * 0.005;

    // Call base update
    Entity.prototype.update.call(this, deltaTime);
};

Item.prototype.pickUp = function (player) {
    if (!this.isPickable) return false;

    // Add to player inventory logic here (omitted for brevity)
    console.log(`${player.name || 'Player'} picked up ${this.name}`);

    // Play pickup sound
    if (this.scene.audio) {
        this.scene.audio.playSound('item_pickup');
    }

    // Remove from scene
    this.dispose();
    return true;
};

Item.prototype.use = function (user) {
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
};

Item.prototype.useConsumable = function (user) {
    if (this.effect && user.applyEffect) {
        user.applyEffect(this.effect);
        this.quantity--;
        if (this.quantity <= 0) {
            this.dispose();
        }
        return true;
    }
    return false;
};

Item.prototype.equip = function (user) {
    // Logic for equipping item (omitted for brevity)
    if (user.equipItem) {
        user.equipItem(this, this.equipSlot);
        return true;
    }
    return false;
};

Item.prototype.serialize = function () {
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
};

Item.static.deserialize = function (data, scene) {
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
};

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
