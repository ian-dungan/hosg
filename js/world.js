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

    async init() {
        this.createLights();
        this.createSkybox();
        this.createTerrain();
        this.createWater();

        await this.loadAssets(); // PATCH: Wait for assets to load before populating

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

    async loadAssets() { // PATCH: New function to manage async loading
        console.log('[World] 📦 Starting asset loading...');
        await Promise.all([
            this.loadTerrainAssets(),
            this.loadWaterAssets()
        ]);
        console.log('[World] ✅ All world assets loaded');
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

    async loadWaterAssets() { // PATCH: Added missing function
        if (!this.assetLoader) {
            console.log('[World] Water asset loading skipped: AssetLoader not available');
            return;
        }

        try {
            const loader = this.assetLoader;
            const waterData = ASSET_MANIFEST.WATER;

            if (!waterData) return;

            // Load bump/normal map
            const bumpPath = waterData.bump || waterData.normal;
            if (bumpPath) {
                try {
                    const bumpTexture = await loader.loadTexture(bumpPath, {
                        uScale: 5, // Default scale for water
                        vScale: 5
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
            console.log('[World] Water asset loading skipped or failed');
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
        this.waterMaterial.specularPower = 64; // PATCH: Completed property assignment

        // CRITICAL: Assign material to water mesh
        this.water.material = this.waterMaterial; // PATCH: Added missing material assignment
        
        // Disable collisions on water surface for now
        this.water.checkCollisions = false;

        console.log('[World] ✓ Water plane created');
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
            { type: 'tree_grove', name: 'Dark Forest', x: -50, z: 50, count: 50 },
            { type: 'tree_grove', name: 'Whispering Woods', x: 60, z: -40, count: 40 },
            { type: 'tree_grove', name: 'The Great Redwood', x: 100, z: 100, count: 1 },

            // Rock Formations
            { type: 'rock_formation', name: 'Ancient Stones', x: -80, z: 20, count: 10 },
            { type: 'rock_formation', name: 'Giant\'s Tooth', x: 50, z: 80, count: 5 }
        ];

        // Place landmarks
        for (const landmark of this.landmarks) {
            this.placeLandmark(landmark);
        }

        // Spawn smaller entities randomly
        const entityCount = 20;
        this.createTrees(entityCount * 2);
        this.createRocks(entityCount);
        this.createGrass(entityCount * 5);
        this.createNPCs(entityCount / 2);
        this.createEnemies(entityCount / 2);

        console.log(`[World] ✓ Populated world with ${this.landmarks.length} landmarks and various entities`);
    }

    placeLandmark(landmark) {
        const { type, x, z } = landmark;
        switch (type) {
            case 'building':
                this.createBuilding(landmark);
                break;
            case 'tree_grove':
                this.createTreeGrove(landmark);
                break;
            case 'rock_formation':
                this.createRockFormation(landmark);
                break;
            default:
                console.warn(`[World] Unknown landmark type: ${type}`);
        }
    }

    createBuilding(landmark) {
        const { name, x, z, scale = 1.0 } = landmark;

        const drySpot = this.findDrySpot(x, z, 10, 10, 0.5);

        // Create main building body
        const building = BABYLON.MeshBuilder.CreateBox(name, {
            width: 8 * scale,
            height: 4 * scale,
            depth: 6 * scale
        }, this.scene);
        building.position = new BABYLON.Vector3(drySpot.x, drySpot.y + 2 * scale, drySpot.z);

        const buildingMaterial = new BABYLON.StandardMaterial('buildingMaterial', this.scene);
        buildingMaterial.diffuseColor = new BABYLON.Color3(0.7, 0.6, 0.5);
        building.material = buildingMaterial;

        // Create a simple roof
        const roof = BABYLON.MeshBuilder.CreateCylinder('roof', {
            height: 1 * scale,
            diameter: 10 * scale,
            tessellation: 4,
            faceUV: [new BABYLON.Vector4(0, 0, 1, 1), new BABYLON.Vector4(0, 0, 1, 1), new BABYLON.Vector4(0, 0, 1, 1)]
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
            const dist = Math.random() * (i * 0.2); // Spread them out
            const treeX = x + Math.cos(angle) * dist;
            const treeZ = z + Math.sin(angle) * dist;

            const drySpot = this.findDrySpot(treeX, treeZ, 5, 5, 0.4);

            const scale = 0.5 + Math.random() * 1.5;

            // Trunk
            const trunk = BABYLON.MeshBuilder.CreateCylinder('trunk', {
                height: 5 * scale,
                diameter: 0.5 * scale
            }, this.scene);
            trunk.position = new BABYLON.Vector3(drySpot.x, drySpot.y + 2.5 * scale, drySpot.z);
            trunk.material = new BABYLON.StandardMaterial('trunkMat', this.scene);
            trunk.material.diffuseColor = new BABYLON.Color3(0.5, 0.4, 0.3);

            // Leaves/Crown
            const leaves = BABYLON.MeshBuilder.CreateSphere('leaves', {
                diameter: 4 * scale,
                segments: 8
            }, this.scene);
            leaves.position = trunk.position.add(new BABYLON.Vector3(0, 2.5 * scale, 0));
            leaves.material = treeMaterial;

            this.shadowGenerator.addShadowCaster(trunk);
            this.shadowGenerator.addShadowCaster(leaves);

            // Store landmark info on first tree
            if (i === 0) {
                trunk.landmarkData = { name, type: 'tree_grove', position: { x, z } };
            }

            this.trees.push(trunk);
            this.trees.push(leaves);
        }
    }

    createRockFormation(landmark) {
        const { name, x, z, count } = landmark;
        const rockMaterial = new BABYLON.StandardMaterial('rockMaterial', this.scene);
        rockMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 8;
            const rockX = x + Math.cos(angle) * dist;
            const rockZ = z + Math.sin(angle) * dist;

            // Create a randomized box/sphere for the rock shape
            const shapeType = Math.random() > 0.5 ? 'box' : 'sphere';
            let rock;
            if (shapeType === 'box') {
                rock = BABYLON.MeshBuilder.CreateBox(`rock${i}`, { size: 1 }, this.scene);
            } else {
                rock = BABYLON.MeshBuilder.CreateSphere(`rock${i}`, { diameter: 1 }, this.scene);
            }

            // Random scaling
            rock.scaling.y *= 0.5 + Math.random() * 0.5;
            rock.scaling.x *= 0.7 + Math.random() * 0.6;
            rock.scaling.z *= 0.7 + Math.random() * 0.6;
            rock.material = rockMaterial;

            const drySpot = this.findDrySpot(rockX, rockZ, 8, 8, 0.4);

            rock.position = new BABYLON.Vector3(drySpot.x, drySpot.y + rock.scaling.y * 0.5, drySpot.z);
            rock.rotation.y = Math.random() * Math.PI * 2;

            // Enable shadows
            this.shadowGenerator.addShadowCaster(rock);

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
            const trunk = BABYLON.MeshBuilder.CreateCylinder('trunk', {
                height: 5,
                diameter: 0.5
            }, this.scene);
            trunk.material = new BABYLON.StandardMaterial('trunkMat', this.scene);
            trunk.material.diffuseColor = new BABYLON.Color3(0.5, 0.4, 0.3);

            // Leaves/Crown
            const leaves = BABYLON.MeshBuilder.CreateSphere('leaves', {
                diameter: 4,
                segments: 8
            }, this.scene);
            leaves.material = treeMaterial;

            // Position and scale
            const scale = 0.5 + Math.random() * 1.5;
            trunk.scaling.setAll(scale);
            leaves.scaling.setAll(scale);

            this.placeOnTerrain(trunk);
            leaves.position = trunk.position.add(new BABYLON.Vector3(0, 2.5 * scale, 0));

            this.shadowGenerator.addShadowCaster(trunk);
            this.shadowGenerator.addShadowCaster(leaves);

            this.trees.push(trunk);
            this.trees.push(leaves);
        }
    }

    createRocks(count) {
        const rockMaterial = new BABYLON.StandardMaterial('rockMaterial', this.scene);
        rockMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);

        for (let i = 0; i < count; i++) {
            // Create a randomized box/sphere for the rock shape
            const shapeType = Math.random() > 0.5 ? 'box' : 'sphere';
            let rock;
            if (shapeType === 'box') {
                rock = BABYLON.MeshBuilder.CreateBox(`rock${i}`, { size: 1 }, this.scene);
            } else {
                rock = BABYLON.MeshBuilder.CreateSphere(`rock${i}`, { diameter: 1 }, this.scene);
            }

            // Random scaling
            rock.scaling.y *= 0.5 + Math.random() * 0.5;
            rock.scaling.x *= 0.7 + Math.random() * 0.6;
            rock.scaling.z *= 0.7 + Math.random() * 0.6;
            rock.material = rockMaterial;

            this.placeOnTerrain(rock);
            rock.position.y += rock.scaling.y * 0.5; // Lift halfway up

            this.shadowGenerator.addShadowCaster(rock);

            this.rocks.push(rock);
        }
    }

    createGrass(count) {
        const grassMaterial = new BABYLON.StandardMaterial('grassMaterial', this.scene);
        grassMaterial.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.2);
        grassMaterial.alpha = 0.8;
        grassMaterial.backFaceCulling = false;

        for (let i = 0; i < count; i++) {
            // Create a simple grass patch
            const grass = BABYLON.MeshBuilder.CreateGround(`grass${i}`, { width: 1 + Math.random() * 2, height: 0.1, subdivisions: 1 }, this.scene);
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

    createNPCs(count) {
        for (let i = 0; i < count; i++) {
            // Generate a random position in the center area
            const maxDist = this.options.size * 0.15;
            const x = (Math.random() - 0.5) * maxDist * 2;
            const z = (Math.random() - 0.5) * maxDist * 2;
            const y = this.getHeightAt(x, z);

            const position = new BABYLON.Vector3(x, y, z);

            // Create a simple NPC instance
            const npc = new NPC(this.scene, {
                name: `NPC ${i + 1}`,
                assetKey: i % 2 === 0 ? 'merchant' : 'guard',
                position,
                dialogue: [
                    'Hello there, traveler.',
                    'The weather is fine today.',
                    'Be careful when you venture out!',
                    'Have you seen the King?',
                    'Welcome to Shady Grove!'
                ],
                walkRadius: 20
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
                assetKey: i % 2 === 0 ? 'wolf' : 'goblin',
                position,
                health: 50 + Math.floor(Math.random() * 50),
                damage: 5 + Math.floor(Math.random() * 10),
                speed: 0.05 + Math.random() * 0.05
            });

            // Add to enemies array
            this.enemies.push(enemy);
        }
    }

    // Helper to get ground height at a position
    getHeightAt(x, z) {
        return this.getTerrainHeight(x, z) || this.options.waterLevel * this.options.maxHeight + 0.1;
    }

    // Helper to place a mesh on the terrain and lift it slightly
    placeOnTerrain(mesh) {
        const x = (Math.random() - 0.5) * this.options.size;
        const z = (Math.random() - 0.5) * this.options.size;
        const y = this.getHeightAt(x, z);
        // Find a dry spot near the initial random position
        const drySpot = this.findDrySpot(x, z, 10, 20, 0.5);
        mesh.position.x = drySpot.x;
        mesh.position.z = drySpot.z;
        mesh.position.y = drySpot.y;
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

            // Keep track of the highest spot found even if it's wet
            if (candY > best.y) {
                best = { x: candX, z: candZ, y: candY };
            }
        }
        // If no dry spot found, return the highest spot near the initial position
        return best;
    }


    setupEventListeners() {
        // Register update loop
        this.scene.onBeforeRenderObservable.add(() => {
            this.update();
        });
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
        const isDay = hour >= 6 && hour < 18;

        // Calculate sun position in the sky (rotation)
        // 12:00 is high noon (Y-axis), 0:00/24:00 is midnight (dark side of world)
        const dayProgress = (hour - 6) / 12; // 0 at 6am, 1 at 6pm
        const angle = dayProgress * Math.PI - Math.PI / 2; // -PI/2 (6am) to PI/2 (6pm)

        // Directional light direction vector
        const sunDirectionX = Math.cos(angle);
        const sunDirectionY = Math.sin(angle);
        const sunDirectionZ = Math.cos(angle * 0.5) * 0.2; // Slight Z variation

        this.sunLight.direction.set(sunDirectionX, sunDirectionY, sunDirectionZ).normalize();

        // Calculate light intensity and color
        let intensity = 0;
        let ambientIntensity = 0;
        let diffColor = new BABYLON.Color3(1, 0.95, 0.9);
        let ambColor = new BABYLON.Color3(0.5, 0.5, 0.6);

        if (hour >= 6 && hour < 18) {
            // Day
            intensity = Math.sin(dayProgress * Math.PI) * 0.8 + 0.2;
            ambientIntensity = 0.5 + Math.sin(dayProgress * Math.PI) * 0.4;
            // Dawn/Dusk tint
            if (hour < 7 || hour >= 17) {
                const mix = (hour < 7) ? (7 - hour) : (hour - 17);
                diffColor = BABYLON.Color3.Lerp(
                    new BABYLON.Color3(1, 0.95, 0.9), // Day color
                    new BABYLON.Color3(0.9, 0.6, 0.4), // Sunset color
                    mix
                );
            }
        } else {
            // Night
            intensity = 0.01;
            ambientIntensity = 0.1;
            diffColor = new BABYLON.Color3(0.1, 0.1, 0.2);
            ambColor = new BABYLON.Color3(0.1, 0.1, 0.2);
        }

        // Apply
        this.sunLight.intensity = intensity;
        this.sunLight.diffuse = diffColor;
        this.ambientLight.intensity = ambientIntensity;
        this.ambientLight.diffuse = ambColor;

        // Update clear color for sky (basic)
        this.scene.clearColor = new BABYLON.Color4(ambColor.r * 0.9, ambColor.g * 0.9, ambColor.b * 0.9, 1.0);
    }

    startWeather(type, intensity = 1) {
        this.weather = type;
        this.weatherTargetIntensity = intensity;
        console.log(`[World] Starting weather: ${type} at intensity ${intensity}`);

        // Immediate application for demo
        this.weatherIntensity = intensity;

        if (type === 'rain') {
            this.createRain(intensity);
        } else if (type === 'snow') {
            this.createSnow(intensity);
        } else if (type === 'storm') {
            this.createStorm(intensity);
        } else {
            this.clearWeather();
        }
    }

    createRain(intensity) {
        this.clearWeather();

        // Simple rain particle system
        this.rainSystem = new BABYLON.ParticleSystem("rainParticles", 2000 * intensity, this.scene);
        this.rainSystem.particleTexture = new BABYLON.Texture("assets/textures/effects/rain.png", this.scene);

        // Where the particles come from
        this.rainSystem.emitter = new BABYLON.Vector3(0, 50, 0); // Emitter is at center top
        this.rainSystem.minEmitBox = new BABYLON.Vector3(-this.options.size / 2, 0, -this.options.size / 2);
        this.rainSystem.maxEmitBox = new BABYLON.Vector3(this.options.size / 2, 0, this.options.size / 2);

        // Color and life
        this.rainSystem.color1 = new BABYLON.Color4(0.7, 0.7, 1.0, 1.0);
        this.rainSystem.color2 = new BABYLON.Color4(0.3, 0.3, 0.7, 1.0);
        this.rainSystem.minLifeTime = 0.5;
        this.rainSystem.maxLifeTime = 2.0;

        // Size
        this.rainSystem.minSize = 0.05;
        this.rainSystem.maxSize = 0.15;

        // Emission rate
        this.rainSystem.emitRate = 2000 * intensity;

        // Direction and speed (vertical)
        this.rainSystem.direction1 = new BABYLON.Vector3(0, -10, 0);
        this.rainSystem.direction2 = new BABYLON.Vector3(0, -10, 0);
        this.rainSystem.minEmitPower = 5;
        this.rainSystem.maxEmitPower = 10;
        this.rainSystem.updateSpeed = 0.01;

        this.rainSystem.start();
    }

    createSnow(intensity) {
        this.clearWeather();

        // Simple snow particle system
        this.snowSystem = new BABYLON.ParticleSystem("snowParticles", 5000 * intensity, this.scene);
        this.snowSystem.particleTexture = new BABYLON.Texture("assets/textures/effects/snow.png", this.scene);

        // Where the particles come from
        this.snowSystem.emitter = new BABYLON.Vector3(0, 50, 0); // Emitter is at center top
        this.snowSystem.minEmitBox = new BABYLON.Vector3(-this.options.size / 2, 0, -this.options.size / 2);
        this.snowSystem.maxEmitBox = new BABYLON.Vector3(this.options.size / 2, 0, this.options.size / 2);

        // Color and life
        this.snowSystem.color1 = new BABYLON.Color4(1.0, 1.0, 1.0, 1.0);
        this.snowSystem.color2 = new BABYLON.Color4(0.8, 0.8, 0.9, 1.0);
        this.snowSystem.minLifeTime = 5.0;
        this.snowSystem.maxLifeTime = 10.0;

        // Size
        this.snowSystem.minSize = 0.1;
        this.snowSystem.maxSize = 0.3;

        // Emission rate
        this.snowSystem.emitRate = 5000 * intensity;

        // Direction and speed (slow drift)
        this.snowSystem.direction1 = new BABYLON.Vector3(-0.5, -2, -0.5);
        this.snowSystem.direction2 = new BABYLON.Vector3(0.5, -3, 0.5);
        this.snowSystem.minEmitPower = 0.5;
        this.snowSystem.maxEmitPower = 1.5;
        this.snowSystem.updateSpeed = 0.01;

        this.snowSystem.start();
    }

    createStorm(intensity) {
        this.createRain(intensity * 1.5); // Heavier rain

        // Lightning effect
        this.lightningInterval = setInterval(() => {
            if (Math.random() < 0.2 * intensity) { // 20% chance every 1-3 seconds
                this.lightningStrike();
            }
        }, 1000 + Math.random() * 2000); // Between 1 and 3 seconds
    }

    lightningStrike() {
        console.log('[World] ⚡ Lightning Strike!');

        // Quick flash of light
        const flash = new BABYLON.PointLight('lightningFlash', BABYLON.Vector3.Zero(), this.scene);
        flash.intensity = 5;
        flash.diffuse = new BABYLON.Color3(1, 1, 1);
        flash.specular = new BABYLON.Color3(1, 1, 1);

        // Position the flash high up
        flash.position.y = 100;

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
        // Update time and weather
        this.updateTime();

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
                item.dispose();
                this.items.splice(i, 1);
            }
        }
    }

    dispose() {
        this.clearWeather();
        // Dispose of all meshes and materials
        [this.terrain, this.collisionBarrier, this.water, this.skybox].forEach(mesh => {
            if (mesh && typeof mesh.dispose === 'function') mesh.dispose();
        });
        [this.terrainMaterial, this.waterMaterial].forEach(mat => {
            if (mat && typeof mat.dispose === 'function') mat.dispose();
        });

        // Dispose of all entities
        [...this.trees, ...this.rocks, ...this.grass, ...this.buildings, ...this.npcs, ...this.enemies, ...this.items].forEach(entity => {
            if (entity && typeof entity.dispose === 'function') entity.dispose();
            else if (entity && entity.mesh && typeof entity.mesh.dispose === 'function') entity.mesh.dispose();
        });

        this.trees = this.rocks = this.grass = this.buildings = this.npcs = this.enemies = this.items = [];

        console.log('[World] Disposed');
    }
}

// ============================================================
// NPC Class
// A basic non-player character for dialogue and simple movement
// ============================================================
class NPC extends Entity {
    constructor(scene, options) {
        super(scene, options.position);
        this.name = options.name || 'NPC';
        this.assetKey = options.assetKey || 'default';
        this.dialogue = options.dialogue || ['...'];
        this.walkRadius = options.walkRadius || 10;
        this.speed = 0.5;

        this.state = 'idle'; // idle, walking, talking
        this.targetPosition = this.position.clone();
        this.talkingTo = null;

        this.animations = {};
        this.currentAnimation = 'idle';

        this.init();
    }

    init() {
        this.createMesh();
        this.setupAnimations();

        // Start wandering after a delay
        setTimeout(() => {
            this.startWandering();
            setInterval(() => {
                if (this.state === 'idle') {
                    this.startWandering();
                }
            }, 5000 + Math.random() * 5000); // Wander every 5-10 seconds
        }, 1000 + Math.random() * 5000); // Initial delay
    }

    async createMesh() {
        const loader = this.scene.assetLoader;
        const asset = ASSET_MANIFEST.CHARACTERS.NPCS[this.assetKey];

        // 1. Load model if assetLoader and manifest are available
        if (loader && asset && asset.model) {
            try {
                const requestedScale = asset.scale || 1.0;
                const model = await loader.loadModel(asset.model, {
                    scene: this.scene,
                    scaling: new BABYLON.Vector3(requestedScale, requestedScale, requestedScale)
                });

                if (model && model.root) {
                    this.mesh = model.root;
                    this.mesh.position = this.position.clone();

                    // Normalize the model to a usable on-screen size (target ~1.8m tall)
                    const bounds = this.mesh.getHierarchyBoundingVectors(true);
                    const currentHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
                    const targetHeight = 1.8;
                    const scaleFactor = Math.max(0.5, targetHeight / currentHeight);
                    this.mesh.scaling.scaleInPlace(scaleFactor);
                    this.mesh.position.y += asset.offset ? asset.offset.y * scaleFactor : 0;

                    // Shadows
                    this.mesh.receiveShadows = true;
                    if (this.scene.shadowGenerator) {
                        this.scene.shadowGenerator.addShadowCaster(this.mesh);
                    }

                    console.log(`[NPC] ✓ Loaded asset model '${this.assetKey}' from manifest (scale ${scaleFactor.toFixed(2)})`);
                    return; // Exit if model loaded
                }
            } catch (err) {
                console.warn(`[NPC] Failed to load model for ${this.assetKey}, using procedural:`, err);
            }
        }

        // 2. Fallback: Procedural mesh
        this.mesh = BABYLON.MeshBuilder.CreateCylinder('npcMesh', { height: 1.8, diameter: 0.8 }, this.scene);
        // Create head
        const head = BABYLON.MeshBuilder.CreateSphere('head', { diameter: 0.6 }, this.scene);
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
        // Setup animation groups (stub for procedural mesh)
        this.animations = {
            idle: { from: 0, to: 30, loop: true },
            walk: { from: 30, to: 60, loop: true },
            wave: { from: 60, to: 90, loop: false }
        };

        // If a loaded model has real animations, they would be set here.
    }

    createAnimation(name, from, to, loop) {
        const animation = new BABYLON.Animation(
            `${this.name}_${name}`,
            'rotation.y',
            30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        animation.from = from;
        animation.to = to;
        animation.loop = loop;
        return animation;
    }

    update(deltaTime) {
        super.update(deltaTime); // Update base entity position

        if (this.state === 'walking') {
            const distanceVector = this.targetPosition.subtract(this.position);
            const distance = distanceVector.length();

            if (distance < 0.1) {
                this.state = 'idle';
                this.playAnimation('idle');
                return;
            }

            // Move towards target
            const moveSpeed = this.speed * deltaTime;
            const direction = distanceVector.normalize();
            this.position.addInPlace(direction.scale(moveSpeed));

            // Face direction of movement (simple rotation)
            const angle = Math.atan2(direction.x, direction.z);
            this.mesh.rotation.y = BABYLON.Scalar.Lerp(this.mesh.rotation.y, angle, 0.1);

            this.playAnimation('walk');
        } else if (this.state === 'idle') {
            this.playAnimation('idle');
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
        if (this.scene.world && this.scene.world.getTerrainHeight) {
            this.targetPosition.y = this.scene.world.getTerrainHeight(
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
        if (this.animations[name] && this.currentAnimation !== name) {
            // Placeholder: In a real implementation with a loaded model, you'd play the animation clip
            // this.scene.beginAnimation(this.mesh, this.animations[name].from, this.animations[name].to, this.animations[name].loop, 1.0);
            this.currentAnimation = name;
        }
    }

    dispose() {
        super.dispose();
        if (this.lightningInterval) clearInterval(this.lightningInterval);
    }
}

// ============================================================
// Enemy Class
// A basic hostile entity with health, combat, and AI
// ============================================================
class Enemy extends Entity {
    constructor(scene, options) {
        super(scene, options.position);
        this.name = options.name || 'Enemy';
        this.assetKey = options.assetKey || 'goblin';

        // Stats
        this.health = options.health || 100;
        this.maxHealth = this.health;
        this.damage = options.damage || 10;
        this.speed = options.speed || 0.1;

        // AI
        this.state = 'idle'; // idle, chasing, attacking, dead
        this.target = null; // The player or other entity being targeted
        this.detectionRange = 25;
        this.attackRange = 2;
        this.attackCooldown = 2.0;
        this._lastAttackTime = 0;

        // Visuals
        this.healthBar = null;
        this.footOffset = 0; // Vertical offset to place the mesh on the ground

        this.init();
    }

    init() {
        this.createMesh();
    }

    async createMesh() {
        const loader = this.scene.assetLoader;
        const asset = ASSET_MANIFEST.CHARACTERS.ENEMIES[this.assetKey];

        // 1. Load model if assetLoader and manifest are available
        if (loader && asset && asset.model) {
            try {
                const requestedScale = asset.scale || 1.0;
                await loader.loadModel(asset.model, {
                    scene: this.scene,
                    scaling: new BABYLON.Vector3(requestedScale, requestedScale, requestedScale)
                }).then(model => {
                    if (!model || !model.root) {
                        console.warn(`[Enemy] Failed to load model for ${this.assetKey}`);
                        return;
                    }
                    // Replace placeholder with loaded model
                    if (this.mesh) this.mesh.dispose(); // Dispose procedural fallback if it exists
                    this.mesh = model.root;
                    this.mesh.position = this.position.clone();

                    // Normalize the model to a usable on-screen size (target ~1.2m tall)
                    const bounds = this.mesh.getHierarchyBoundingVectors(true);
                    const currentHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
                    const targetHeight = 1.2;
                    const scaleFactor = Math.max(0.2, targetHeight / currentHeight);
                    this.mesh.scaling.scaleInPlace(scaleFactor);

                    // Compute and apply foot offset
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
                    this.mesh.receiveShadows = true;

                    console.log(`[Enemy] ✓ Loaded asset model '${this.assetKey}' from manifest (scale ${scaleFactor.toFixed(2)})`);
                }).catch(err => {
                    console.warn(`[Enemy] Failed to load model for ${this.assetKey}, falling back:`, err);
                    this.createProceduralMesh(); // Fallback in catch block
                });
                return;
            } catch (err) {
                console.warn(`[Enemy] Failed to initiate model load for ${this.assetKey}, using procedural:`, err);
            }
        }

        // 2. Fallback: Procedural mesh
        this.createProceduralMesh();
    }

    createProceduralMesh() {
        // Create main body
        this.mesh = BABYLON.MeshBuilder.CreateCylinder('enemyMesh', { height: 1.2, diameter: 0.6 }, this.scene);

        // Set material
        const material = new BABYLON.StandardMaterial('enemyMaterial', this.scene);
        material.diffuseColor = new BABYLON.Color3(0.6, 0.2, 0.2); // Reddish color
        this.mesh.material = material;

        // Set metadata for targeting
        this.mesh.metadata = { isEnemy: true, entity: this };

        // Compute foot offset for simple meshes
        this.footOffset = -this.mesh.getBoundingInfo().boundingBox.extendSize.y;
        this.snapToGround();

        // Shadows
        this.mesh.receiveShadows = true;
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(this.mesh);
        }
    }

    computeFootOffset(mesh) {
        // Calculate the lowest point of the mesh in local space
        const bounds = mesh.getHierarchyBoundingVectors(true);
        // Offset is from the mesh's pivot (center) to its lowest point
        return bounds.min.y;
    }

    snapToGround() {
        if (!this.mesh || !this.scene.world) return;
        const groundY = this.scene.world.getTerrainHeight(this.position.x, this.position.z);
        // Set position to groundY, then apply the offset to put feet on the ground
        this.position.y = groundY - this.footOffset;
        this.mesh.position.copyFrom(this.position);
    }

    createHealthBar() {
        // Simple health bar UI (3D, always facing camera)
        if (this.healthBar) this.healthBar.mesh.dispose();

        const plane = BABYLON.MeshBuilder.CreatePlane("healthBarPlane", { width: 1.0, height: 0.1 }, this.scene);
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        plane.parent = this.mesh;
        plane.position.y = 2.0; // Above the enemy's head

        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(plane);

        const bar = new BABYLON.GUI.Rectangle("healthBar");
        bar.width = 1;
        bar.height = 1;
        bar.color = "white";
        bar.thickness = 2;
        advancedTexture.addControl(bar);

        const health = new BABYLON.GUI.Rectangle("healthFill");
        health.width = this.health / this.maxHealth;
        health.height = 1;
        health.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        health.background = "red";
        bar.addControl(health);

        this.healthBar = { mesh: plane, fill: health };
    }

    updateHealthBar() {
        if (this.healthBar) {
            this.healthBar.fill.width = this.health / this.maxHealth;
        }
    }

    takeDamage(amount, source) {
        if (this.state === 'dead') return;

        this.health -= amount;
        console.log(`[Enemy] ${this.name} took ${amount} damage. Health: ${this.health}`);

        if (this.scene.ui) {
            this.scene.ui.showFloatingText(amount.toFixed(0), this.mesh.position.clone().add(new BABYLON.Vector3(0, 1.5, 0)), 'enemyDamage');
        }

        this.updateHealthBar();
        this.target = source; // Retaliate!

        if (this.health <= 0) {
            this.die(source);
        }
    }

    attack() {
        const now = performance.now() / 1000;
        if (now - this._lastAttackTime < this.attackCooldown) return;

        if (this.target && this.target.takeDamage) {
            console.log(`[Enemy] ${this.name} attacks ${this.target.name}!`);
            this.target.takeDamage(this.damage, this);
            this._lastAttackTime = now;
        }
    }

    die(killer) {
        this.state = 'dead';
        this.mesh.setEnabled(false); // Hide the mesh instantly
        if (this.healthBar) this.healthBar.mesh.dispose();

        this.dropLoot(killer);

        // Remove from world entities after a delay
        setTimeout(() => {
            this.dispose();
            // In a real game, this would involve removing from the world's enemies array
        }, 1000);

        console.log(`[Enemy] ${this.name} is defeated!`);
    }

    update(deltaTime) {
        if (this.state === 'dead') return;

        super.update(deltaTime);
        this.snapToGround();

        // AI logic
        this.findTarget();

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

        // Update health bar position
        if (this.healthBar) {
            this.healthBar.mesh.position.y = (this.mesh.getBoundingInfo().boundingBox.extendSize.y * 2) + 0.5;
        }
    }

    findTarget() {
        // In a real game, you would use a spatial partitioning system
        // to efficiently find nearby players
        if (this.scene.player && this.scene.player.mesh && this.scene.player.mesh.position) {
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
            direction.normalize().scaleInPlace(this.speed * deltaTime);
            this.position.addInPlace(direction);
            this.position.y = this.scene.world.getTerrainHeight(this.position.x, this.position.z) - this.footOffset;

            // Face target
            const angle = Math.atan2(direction.x, direction.z);
            this.mesh.rotation.y = BABYLON.Scalar.Lerp(this.mesh.rotation.y, angle, 0.1);
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

    dispose() {
        super.dispose();
        if (this.healthBar) {
            this.healthBar.mesh.dispose();
            this.healthBar = null;
        }
    }
}


// ============================================================
// Item Class
// An item that can be picked up, used, or equipped
// ============================================================
class Item extends Entity {
    constructor(scene, options) {
        super(scene, options.position);
        this.type = options.type || 'item'; // weapon, armor, consumable, currency, item
        this.id = options.id || 'unknown_item';
        this.name = options.name || 'Unknown Item';
        this.description = options.description || '';
        this.icon = options.icon || 'default';
        this.value = options.value || 1;
        this.quantity = options.quantity || 1;
        this.stackable = options.stackable || false;

        // Item-specific properties
        this.equipSlot = options.equipSlot || null;
        this.stats = options.stats || {};
        this.damage = options.damage || 0;
        this.attackSpeed = options.attackSpeed || 1.0;
        this.defense = options.defense || 0;
        this.effect = options.effect || null; // e.g., { health: 20 } for a potion
        this.cooldown = options.cooldown || 0;

        this.collected = false; // Flag to be picked up by world update

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
                this.mesh = BABYLON.MeshBuilder.CreateBox(`item_${this.id}`, { width: 0.3, height: 1.0, depth: 0.1 }, this.scene);
                break;
            case 'armor':
                this.mesh = BABYLON.MeshBuilder.CreateBox(`item_${this.id}`, { size: 0.5 }, this.scene);
                break;
            case 'consumable':
                this.mesh = BABYLON.MeshBuilder.CreateSphere(`item_${this.id}`, { diameter: 0.3 }, this.scene);
                break;
            case 'currency':
                this.mesh = BABYLON.MeshBuilder.CreateCylinder(`item_${this.id}`, { height: 0.1, diameter: 0.5 }, this.scene);
                break;
            default:
                this.mesh = BABYLON.MeshBuilder.CreateBox(`item_${this.id}`, { size: 0.5 }, this.scene);
        }

        // Set material based on item type
        const material = new BABYLON.StandardMaterial(`item_${this.id}_material`, this.scene);
        switch (this.type) {
            case 'weapon':
                material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
                material.specularColor = new BABYLON.Color3(1, 1, 1);
                break;
            case 'armor':
                material.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
                break;
            case 'consumable':
                material.diffuseColor = new BABYLON.Color3(1, 0, 0); // Red potion
                break;
            case 'currency':
                material.diffuseColor = new BABYLON.Color3(1, 0.8, 0); // Gold
                break;
            default:
                material.diffuseColor = new BABYLON.Color3(0.7, 0.7, 0.7);
        }
        this.mesh.material = material;

        // Set initial position
        this.mesh.position.copyFrom(this.position);

        // Make it slightly float above ground
        this.mesh.position.y += 0.2;
    }

    setupPhysics() {
        if (!this.mesh) return;

        // Make it a small dynamic physics object (to settle on ground)
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.BoxImpostor, // Use Box or Sphere
            {
                mass: 0.5,
                friction: 0.5,
                restitution: 0.1
            },
            this.scene
        );

        // Make it a trigger/sensor so the player can pass through it but physics still works
        // Note: For simple non-colliding pickup, this is sufficient.
    }

    update(deltaTime) {
        // Spin the item for visual effect
        if (this.mesh) {
            this.mesh.rotation.y += deltaTime * 0.5;
        }

        // Super updates position if needed (though physics will handle it here)
        // super.update(deltaTime);
    }

    /**
     * Attempts to pick up the item.
     * @param {Player} player - The player attempting to pick up.
     * @returns {boolean} True if collected.
     */
    collect(player) {
        if (this.collected) return false;

        // Transfer item to player's inventory (simple implementation)
        if (player && player.inventory && player.inventory.addItem) {
            const itemData = this.serialize();
            if (player.inventory.addItem(itemData)) {
                this.collected = true;
                console.log(`[Item] ${this.name} collected by ${player.name}`);

                if (this.scene.audio) {
                    this.scene.audio.playSound('item_pickup');
                }

                // Remove from scene
                this.dispose();
                return true;
            }
        }
        return false;
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
            const healAmount = this.effect.health;
            if (user.heal) {
                user.heal(healAmount);
                return true;
            }
        }

        // Apply mana effect
        if (this.effect.mana) {
            const manaAmount = this.effect.mana;
            if (user.restoreMana) {
                user.restoreMana(manaAmount);
                return true;
            }
        }

        return false;
    }

    equip(user) {
        if (!this.equipSlot) return false;

        if (user.equipItem) {
            user.equipItem(this.serialize(), this.equipSlot);
            return true;
        }

        return false;
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
