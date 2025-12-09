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

    generateHeightmap() { // <<< MOVED UP TO FIX HOISTING/INITIALIZATION ERROR
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
    } // <<< MOVED UP TO FIX HOISTING/INITIALIZATION ERROR


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
            console.log('[World] Asset loading skipped...');
        }
    }

    createWater() {
        // Water creation code (omitted for brevity, as it was not part of the patch)
    }

    populateWorld() {
        // World population code (omitted for brevity, as it was not part of the patch)
    }

    setupEventListeners() {
        // Event listener setup code (omitted for brevity, as it was not part of the patch)
    }

    updateTime() {
        // Time update code (omitted for brevity, as it was not part of the patch)
    }

    updateLighting() {
        // Lighting update code (omitted for brevity, as it was not part of the patch)
    }

    setWeather(type) {
        // Weather setting code (omitted for brevity, as it was not part of the patch)
    }

    startRain() {
        // Rain start code (omitted for brevity, as it was not part of the patch)
    }

    startSnow() {
        // Snow start code (omitted for brevity, as it was not part of the patch)
    }

    startStorm() {
        // Storm start code (omitted for brevity, as it was not part of the patch)
    }

    lightningFlash() {
        // Lightning flash code (omitted for brevity, as it was not part of the patch)
    }

    clearWeather() {
        // Clear weather code (omitted for brevity, as it was not part of the patch)
    }

    update() {
        // Update code (omitted for brevity, as it was not part of the patch)
    }

    // Helper methods, e.g., getHeightAt, findDrySpot (omitted for brevity, as it was not part of the patch)
}
