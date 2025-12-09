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
                  // In world.js, inside class World {...}
// Add this method anywhere within the World class definition, 
// for example, after populateWorld():

    /**
     * Returns the array of static world landmarks.
     * This is needed by the UIManager for the minimap.
     */
    getLandmarks() {
        return this.landmarks;
    }

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

            // Roughness/Metallic (PBR smoothness/reflectivity)
            const rmTex = new BABYLON.Texture(
                grassPath + 'Grass004_2K-JPG_Roughness.jpg', // No metallic map, use roughness
                scene
            );
            rmTex.uScale = tileScale;
            rmTex.vScale = tileScale;
            this.terrainMaterial.metallicTexture = rmTex;
            this.terrainMaterial.roughness = 1.0; // Use texture channel for roughness
            console.log('[World] ✓ Grass Roughness/Metallic texture loaded');

        } catch (e) {
            console.warn('[World] Failed to load one or more grass PBR textures:', e);
            // Fallback to simple color
            this.terrainMaterial.albedoColor = new BABYLON.Color3(0.3, 0.6, 0.1);
        }

        // Apply material
        this.terrain.material = this.terrainMaterial;

        // Apply shadow receiver
        this.terrain.receiveShadows = true;

        // Apply physics impostor
        if (this.scene.getPhysicsEngine()) {
            try {
                // Use MeshImpostor for terrain with heightmap data
                this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
                    this.terrain,
                    BABYLON.PhysicsImpostor.MeshImpostor,
                    { mass: 0, friction: 1.0, restitution: 0.0 },
                    this.scene
                );
                console.log('[World] ✓ Terrain physics impostor created');

                // CRITICAL: Create an invisible barrier mesh for static collisions
                const BARRIER_OFFSET = 0.01; // Tiny offset to prevent Z-fighting with terrain
                this.collisionBarrier = this.terrain.clone('collisionBarrier');
                this.collisionBarrier.position.y += BARRIER_OFFSET; // Move slightly up
                this.collisionBarrier.isVisible = false;
                // Important: Ensure the physics impostor is created AFTER the clone/offset
                this.collisionBarrier.physicsImpostor = new BABYLON.PhysicsImpostor(
                    this.collisionBarrier,
                    BABYLON.PhysicsImpostor.MeshImpostor,
                    { mass: 0, friction: 1.0, restitution: 0.0 },
                    this.scene
                );
                console.log(`[World] ✓ Collision barrier cloned from terrain and offset ${BARRIER_OFFSET}y`);

            } catch (err) {
                console.error('[World] Failed to create terrain physics impostor:', err);
            }
        } else {
            console.warn('[World] Physics engine not enabled, skipping terrain impostor');
        }
    }

    generateHeightmap() {
        const positions = this.terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const normals = [];
        // Create noise generator - NOW SAFE BECAUSE CLASS IS HOISTED
        const noise = new SimplexNoise(this.options.seed);

        const width = this.options.size;
        const segments = this.options.segments;
        const halfWidth = width / 2;
        const scale = 0.01; // Controls the "zoom" of the noise
        const persistence = 0.5; // Controls the amplitude falloff
        const octaves = 4; // Controls the level of detail

        // Generate height values
        for (let i = 0; i < positions.length; i += 3) {
            // Positions are relative to the mesh center (0, 0, 0)
            const x = positions[i];
            const z = positions[i + 2];

            let y = 0;
            let totalAmplitude = 0;
            let frequency = scale;
            let amplitude = 1;

            // Multi-octave (Fractal Brownian Motion)
            for (let j = 0; j < octaves; j++) {
                y += noise.noise2D(x * frequency, z * frequency) * amplitude;
                totalAmplitude += amplitude;
                amplitude *= persistence;
                frequency *= 2;
            }

            // Normalize and scale to max height
            y = (y / totalAmplitude) * this.options.maxHeight;

            // Apply slight bias to flatten large areas
            y = y * 0.8 + Math.pow(y, 3) * 0.005;

            positions[i + 1] = y;
        }

        // Update vertices
        this.terrain.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);

        // Recalculate normals for proper lighting
        BABYLON.VertexData.ComputeNormals(positions, this.terrain.getIndices(), normals);
        this.terrain.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);

        this.terrain.refreshBoundingInfo(true);
        console.log(`[World] ✓ Terrain heightmap generated with Max Height: ${this.options.maxHeight}`);
    }

    // Helper to get terrain height at a specific (x, z) world coordinate
    getHeightAt(x, z) {
        if (!this.terrain) return 0;

        const pick = this.scene.pick(
            x, // Pick X (normalized)
            0, // Pick Y (normalized) - not used for raycast
            (mesh) => mesh === this.terrain, // Only check the terrain mesh
            false, // Not using fast check
            new BABYLON.Ray(new BABYLON.Vector3(x, 1000, z), BABYLON.Vector3.Down()) // Raycast from above
        );

        if (pick && pick.hit) {
            return pick.pickedPoint.y;
        }

        // Fallback to a procedural estimate or default value
        const scale = 0.01;
        const persistence = 0.5;
        const octaves = 4;
        const noise = new SimplexNoise(this.options.seed);

        let y = 0;
        let totalAmplitude = 0;
        let frequency = scale;
        let amplitude = 1;

        for (let j = 0; j < octaves; j++) {
            y += noise.noise2D(x * frequency, z * frequency) * amplitude;
            totalAmplitude += amplitude;
            amplitude *= persistence;
            frequency *= 2;
        }

        y = (y / totalAmplitude) * this.options.maxHeight;
        y = y * 0.8 + Math.pow(y, 3) * 0.005; // Apply bias

        return y;
    }

    createWater() {
        const WATER_HEIGHT = this.options.waterLevel;
        if (WATER_HEIGHT <= 0) {
            console.log('[World] Water level is 0 or less, skipping water creation.');
            return;
        }

        // Water Material
        this.waterMaterial = new BABYLON.WaterMaterial("waterMaterial", this.scene, new BABYLON.Vector2(512, 512));
        this.waterMaterial.backFaceCulling = true;
        this.waterMaterial.windForce = 5;
        this.waterMaterial.waveHeight = 0.2;
        this.waterMaterial.bumpHeight = 0.05;
        this.waterMaterial.waveLength = 0.1;
        this.waterMaterial.colorBlendFactor = 0.2;
        this.waterMaterial.causticsEnabled = true;

        // Adjust colors for a fantasy/deep blue look
        this.waterMaterial.waterColor = new BABYLON.Color3(0.0, 0.1, 0.4); // Deep blue
        this.waterMaterial.fogColor = new BABYLON.Color3(0.0, 0.1, 0.4);
        this.waterMaterial.waveColor = new BABYLON.Color3(0.2, 0.7, 0.9); // Light blue crests

        // Water Mesh
        this.water = BABYLON.MeshBuilder.CreateGround("water", {
            width: this.options.size,
            height: this.options.size,
            subdivisions: 1 // Simple plane
        }, this.scene);
        this.water.position.y = WATER_HEIGHT;
        this.water.material = this.waterMaterial;

        // Add skybox and terrain to water reflection/refraction
        this.waterMaterial.addToRenderList(this.skybox);
        this.waterMaterial.addToRenderList(this.terrain);

        // Load bump texture if available
        try {
            const bumpTex = new BABYLON.Texture('assets/textures/water/waterbump.png', this.scene);
            this.waterMaterial.bumpTexture = bumpTex;
            this.waterMaterial.bumpTexture.level = 0.1;
            console.log('[World] ✓ Water bump texture loaded');
        } catch (e) {
            console.log('[World] Water bump texture not found, using smooth water');
        }

        // Physics impostor for a flat plane (optional, but good practice)
        if (this.scene.getPhysicsEngine()) {
            this.water.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.water,
                BABYLON.PhysicsImpostor.PlaneImpostor,
                { mass: 0, friction: 0.5, restitution: 0.1 },
                this.scene
            );
        }

        console.log(`[World] ✓ Water created at height: ${WATER_HEIGHT}`);
    }

    // Finds a point on the terrain that is not submerged, within a radius
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
            const newX = x + Math.cos(angle) * dist;
            const newZ = z + Math.sin(angle) * dist;
            const newY = this.getHeightAt(newX, newZ);

            if (newY > waterY + margin) {
                return { x: newX, z: newZ, y: newY };
            }

            // Keep track of the highest point found so far
            if (newY > best.y) {
                best = { x: newX, z: newZ, y: newY };
            }
        }
        // Fallback to the highest point, even if wet
        return best;
    }

    populateWorld() {
        // Define static objects to create
        this.createTrees(50);
        this.createRocks(30);
        this.createNPCs(5);
        this.createEnemies(10);
    }

    createTrees(count) {
        // Use a simple box placeholder for now
        const treeMaterial = new BABYLON.StandardMaterial('treeMat', this.scene);
        treeMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.4, 0.1); // Green

        const trunkMaterial = new BABYLON.StandardMaterial('trunkMat', this.scene);
        trunkMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.0); // Brown

        const radius = this.options.size / 2 - 50; // Keep trees away from world edge

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * radius;
            const treeX = Math.sin(angle) * distance;
            const treeZ = Math.cos(angle) * distance;

            const drySpot = this.findDrySpot(treeX, treeZ);
            const treeY = drySpot.y;

            // Simple trunk
            const trunk = BABYLON.MeshBuilder.CreateCylinder('trunk', {
                height: 3 + Math.random() * 2,
                diameter: 0.3 + Math.random() * 0.2
            }, this.scene);
            trunk.position = new BABYLON.Vector3(drySpot.x, treeY + trunk.height / 2, drySpot.z);
            trunk.material = trunkMaterial;
            trunk.receiveShadows = true;
            if (this.shadowGenerator) {
                this.shadowGenerator.addShadowCaster(trunk);
            }

            // Simple leaves (sphere for now)
            const leaves = BABYLON.MeshBuilder.CreateSphere('leaves', {
                diameter: 3 + Math.random() * 1
            }, this.scene);
            leaves.position = new BABYLON.Vector3(drySpot.x, treeY + trunk.height * 0.8 + leaves.getBoundingInfo().boundingBox.extendSize.y * 0.5, drySpot.z);
            leaves.material = treeMaterial;
            leaves.receiveShadows = true;
            if (this.shadowGenerator) {
                this.shadowGenerator.addShadowCaster(leaves);
            }

            // Group as a single mesh for easier manipulation/culling
            const tree = BABYLON.Mesh.MergeMeshes([trunk, leaves], true, true, undefined, false, true);
            if (tree) {
                tree.name = `tree${i}`;
                this.trees.push(tree);
            }
        }
        console.log(`[World] Created ${this.trees.length} trees`);
    }

    createRocks(count) {
        const rockMaterial = new BABYLON.StandardMaterial('rockMat', this.scene);
        rockMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4); // Grey

        const radius = this.options.size / 2 - 50; // Keep rocks away from world edge

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * radius;
            const rockX = Math.sin(angle) * distance;
            const rockZ = Math.cos(angle) * distance;

            // Simple rock (box with random scaling)
            const rock = BABYLON.MeshBuilder.CreateBox('rock', { size: 1.5 + Math.random() * 1.5 }, this.scene);
            rock.scaling.y *= 0.5 + Math.random() * 0.5;
            rock.scaling.x *= 0.7 + Math.random() * 0.6;
            rock.scaling.z *= 0.7 + Math.random() * 0.6;
            rock.material = rockMaterial;

            const drySpot = this.findDrySpot(rockX, rockZ, 8, 8, 0.4);
            rock.position = new BABYLON.Vector3(drySpot.x, drySpot.y, drySpot.z);
            rock.rotation.y = Math.random() * Math.PI * 2;

            // Apply physics impostor
            if (this.scene.getPhysicsEngine()) {
                rock.physicsImpostor = new BABYLON.PhysicsImpostor(
                    rock,
                    BABYLON.PhysicsImpostor.BoxImpostor,
                    { mass: 0, friction: 0.8, restitution: 0.01 },
                    this.scene
                );
            }
            this.rocks.push(rock);
            if (this.shadowGenerator) {
                this.shadowGenerator.addShadowCaster(rock);
            }
            rock.receiveShadows = true;
        }
        console.log(`[World] Created ${this.rocks.length} rocks`);
    }

    createNPCs(count) {
        const spawnRadius = Math.min(80, this.options.size * 0.2); // Keep NPCs close to center for now
        for (let i = 0; i < count; i++) {
            // Bias positions toward the center of the map
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const x = Math.sin(angle) * distance;
            const z = Math.cos(angle) * distance;

            // Get spawn height
            const drySpot = this.findDrySpot(x, z, 5, 5, 0.1);
            const position = new BABYLON.Vector3(drySpot.x, drySpot.y + 1, drySpot.z); // Add a small offset

            const npc = new NPC(this.scene, position);
            npc.init(); // Initialize the NPC mesh/physics
            this.npcs.push(npc);
        }
        console.log(`[World] Created ${this.npcs.length} NPCs`);
    }

    createEnemies(count) {
        // Keep enemies close to the playable spawn so they are easy to find
        const spawnRadius = Math.min(80, this.options.size * 0.2);
        for (let i = 0; i < count; i++) {
            // Bias positions toward the center of the map
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const x = Math.sin(angle) * distance;
            const z = Math.cos(angle) * distance;

            // Get spawn height
            const drySpot = this.findDrySpot(x, z, 5, 5, 0.1);
            const position = new BABYLON.Vector3(drySpot.x, drySpot.y + 1, drySpot.z); // Add a small offset

            const enemy = new Enemy(this.scene, position, 'wolf'); // Default to 'wolf'
            enemy.init();
            this.enemies.push(enemy);
        }
        console.log(`[World] Created ${this.enemies.length} enemies`);
    }

    setupEventListeners() {
        // Example: Handle pointer down for targeting enemies/items
        this.scene.onPointerObservable.add((pointerInfo) => {
            switch (pointerInfo.type) {
                case BABYLON.PointerEventTypes.POINTERDOWN:
                    const pickInfo = this.scene.pick(
                        this.scene.pointerX,
                        this.scene.pointerY
                    );
                    if (this.scene.game.player) {
                        this.scene.game.player.handlePointerDown(pickInfo);
                    }
                    break;
            }
        });
    }

    // Weather methods
    setWeather(type) {
        this.weather = type;
        switch (type) {
            case 'rain': this.startRain(); break;
            case 'snow': this.startSnow(); break;
            case 'storm': this.startStorm(); break;
            case 'clear': default: this.clearWeather(); break;
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
        this.rainSystem.direction1 = new BABYLON.Vector3(-1, -10, -1);
        this.rainSystem.direction2 = new BABYLON.Vector3(1, -10, 1);
        this.rainSystem.minLifeTime = 0.5;
        this.rainSystem.maxLifeTime = 1.0;
        this.rainSystem.emitRate = 1000;
        this.rainSystem.start();
        console.log('[World] Rain started');
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
        this.snowSystem.direction1 = new BABYLON.Vector3(-0.5, -3, -0.5);
        this.snowSystem.direction2 = new BABYLON.Vector3(0.5, -3, 0.5);
        this.snowSystem.minLifeTime = 2.0;
        this.snowSystem.maxLifeTime = 5.0;
        this.snowSystem.emitRate = 200;
        this.snowSystem.minSize = 0.05;
        this.snowSystem.maxSize = 0.2;
        this.snowSystem.start();
        console.log('[World] Snow started');
    }

    startStorm() {
        this.startRain();
        this.lightningInterval = setInterval(() => {
            this.lightningFlash();
        }, 5000 + Math.random() * 10000); // 5-15 second interval
        console.log('[World] Storm started');
    }

    lightningFlash() {
        const flash = new BABYLON.PointLight('lightningFlash', new BABYLON.Vector3(0, 50, 0), this.scene);
        flash.diffuse = BABYLON.Color3.White();
        flash.intensity = 5;
        flash.range = 500;
        flash.shadowEnabled = false;

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
        console.log('[World] Weather cleared');
    }

    updateWeather(deltaTime) {
        // Current weather update (e.g., wind for rain/snow)
        if (this.rainSystem) {
            // Move rain emitter with player (simplistic approach)
            const player = this.scene.game?.player;
            if (player && player.mesh) {
                this.rainSystem.emitter = player.mesh.position.clone().add(new BABYLON.Vector3(0, 50, 0));
            }
        }
        if (this.snowSystem) {
            // Move snow emitter with player
            const player = this.scene.game?.player;
            if (player && player.mesh) {
                this.snowSystem.emitter = player.mesh.position.clone().add(new BABYLON.Vector3(0, 50, 0));
            }
        }
    }

    updateLighting() {
        // Calculate sun position based on time of day
        const hour = this.time;
        const isDay = hour > 6 && hour < 20; // Roughly 6am to 8pm

        // Update sun position (0-24 hours maps to 0-2π radians)
        const sunAngle = (hour / 24) * Math.PI * 2 - Math.PI / 2; // Shifted so 12 is up (PI/2)

        const sunX = Math.cos(sunAngle);
        const sunY = Math.sin(sunAngle);
        const sunZ = 0; // Keep direction flat for simplicity, or add a small Z variance

        // Set light direction
        this.sunLight.direction = new BABYLON.Vector3(sunX, sunY, sunZ).normalize();

        // Update intensity and color based on time of day
        let sunIntensity = 0;
        let ambientIntensity = 0;

        if (isDay) {
            // Day: Full brightness
            sunIntensity = 1.0;
            ambientIntensity = 0.5;
            this.sunLight.diffuse = new BABYLON.Color3(1, 0.95, 0.9);
            this.ambientLight.diffuse = new BABYLON.Color3(0.5, 0.5, 0.6);
        } else {
            // Night: Low brightness, blue tint
            sunIntensity = 0.1;
            ambientIntensity = 0.1;
            this.sunLight.diffuse = new BABYLON.Color3(0.1, 0.1, 0.3); // Moon color
            this.ambientLight.diffuse = new BABYLON.Color3(0.05, 0.05, 0.1);
        }

        // Smooth transition for sunrise/sunset (6-8am and 6-8pm)
        const dawnStart = 6;
        const dawnEnd = 8;
        const duskStart = 18;
        const duskEnd = 20;

        let factor = 1.0;
        if (hour >= dawnStart && hour <= dawnEnd) {
            factor = (hour - dawnStart) / (dawnEnd - dawnStart);
        } else if (hour >= duskStart && hour <= duskEnd) {
            factor = 1.0 - ((hour - duskStart) / (duskEnd - duskStart));
        }

        // Apply smooth transition (preventing sudden light pops)
        this.sunLight.intensity = sunIntensity * Math.max(0.1, factor);
        this.ambientLight.intensity = ambientIntensity * Math.max(0.1, factor);
    }

    update(deltaTime) {
        // Update time of day (24-hour cycle)
        const deltaTimeSeconds = this.scene.getEngine().getDeltaTime() / 1000; // Convert to seconds
        this.time += deltaTimeSeconds * 0.01; // Speed up time for demo
        if (this.time >= 24) {
            this.time = 0;
            this.day++;
        }

        // Update lighting based on time of day
        this.updateLighting();

        // Update all entities
        for (const npc of this.npcs) {
            if (typeof npc.update === 'function') {
                npc.update(deltaTimeSeconds);
            }
        }
        for (const enemy of this.enemies) {
            if (typeof enemy.update === 'function') {
                enemy.update(deltaTimeSeconds);
            }
        }
        for (const item of this.items) {
            if (typeof item.update === 'function') {
                item.update(deltaTimeSeconds);
            }
        }

        // Update weather transition
        this.updateWeather(deltaTimeSeconds);
    }

    dispose() {
        this.clearWeather();
        this.trees.forEach(t => t.dispose());
        this.rocks.forEach(r => r.dispose());
        this.npcs.forEach(n => n.dispose());
        this.enemies.forEach(e => e.dispose());
        this.items.forEach(i => i.dispose());
        if (this.terrain) this.terrain.dispose();
        if (this.water) this.water.dispose();
        if (this.skybox) this.skybox.dispose();
        if (this.sunLight) this.sunLight.dispose();
        if (this.ambientLight) this.ambientLight.dispose();
        if (this.shadowGenerator) this.shadowGenerator.dispose();
        console.log('[World] Disposed');
    }
}


// NPC Class (Non-Player Character)
class NPC extends Entity {
    constructor(scene, position, assetKey = 'merchant') {
        super(scene, position);
        this.assetKey = assetKey;
        this.state = 'idle'; // idle, walking, talking, chasing, attacking
        this.walkRadius = 50;
        this.targetPosition = position.clone();
        this.speed = 1.5;
        this.talkingTo = null; // Reference to the player
        this.dialogueOptions = [
            "Hello there, adventurer. The grove is a dangerous place.",
            "Watch out for the wolves near the western forest.",
            "I'm just a humble merchant, looking to make a living.",
            "If you need help, speak to the guard by the town gates."
        ];
        this.init();
    }

    init() {
        this.createMesh();
        this.setupAnimations();
    }

    createMesh() {
        // Create a simple capsule shape for placeholder NPC
        this.mesh = BABYLON.MeshBuilder.CreateCylinder('npcMesh', { height: 1.8, diameter: 0.8 }, this.scene);
        this.mesh.isPickable = true;
        this.mesh.metadata = { isNPC: true, name: this.assetKey };

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
        // Setup animation groups
        this.animations = {
            idle: this.createAnimation('idle', 1.0),
            walk: this.createAnimation('walk', 0.5)
        };
        this.playAnimation('idle');
    }

    createAnimation(name, speed) {
        // Placeholder: Create a simple rotation animation for idle/walking
        const rotationKeys = [];
        rotationKeys.push({ frame: 0, value: 0 });
        rotationKeys.push({ frame: 60, value: Math.PI * 2 });
        const animation = new BABYLON.Animation(
            `${name}Animation`,
            'rotation.y',
            30, // Frames per second
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        animation.setKeys(rotationKeys);
        return animation;
    }

    playAnimation(name, loop = true) {
        if (this.currentAnimation && this.currentAnimation.name === name) return;

        const anim = this.animations[name];
        if (anim && this.mesh) {
            this.scene.stopAllAnimations(this.mesh);
            this.scene.beginAnimation(this.mesh, 0, 60, loop, 1.0);
            this.currentAnimation = anim;
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
        if (this.scene.world && this.scene.world.getHeightAt) {
            // Get height from terrain and set Y
            const groundY = this.scene.world.getHeightAt(
                this.targetPosition.x,
                this.targetPosition.z
            );
            // Center the NPC body on the ground (assuming mesh height is ~2)
            this.targetPosition.y = groundY + 1;
        }

        this.state = 'walking';
        this.playAnimation('walk');
    }

    talkTo(player) {
        this.state = 'talking';
        this.talkingTo = player;
        this.playAnimation('idle');

        // Show a random dialogue bubble
        const dialogue = this.dialogueOptions[Math.floor(Math.random() * this.dialogueOptions.length)];
        this.scene.game.ui.showFloatingText(dialogue, this.mesh.position, 'npcDialogue', 4000);

        // Stop after a few seconds
        setTimeout(() => {
            this.state = 'idle';
            this.talkingTo = null;
        }, 5000);
    }

    update(deltaTime) {
        // Entity base update (sync position)
        super.update(deltaTime);

        switch (this.state) {
            case 'idle':
                // Randomly start wandering
                if (Math.random() < 0.001) { // 0.1% chance per frame
                    this.startWandering();
                }
                break;

            case 'walking':
                const toTarget = this.targetPosition.subtract(this.position);
                const distance = toTarget.length();

                if (distance < 0.5) {
                    // Reached target, stop and idle
                    this.state = 'idle';
                    this.playAnimation('idle');
                    break;
                }

                // Move towards target
                const direction = toTarget.normalize();
                const displacement = direction.scale(this.speed * deltaTime);
                this.mesh.moveWithCollisions(displacement);
                this.position.copyFrom(this.mesh.position); // Update logic position

                // Orient towards direction of movement
                const targetRotation = Math.atan2(direction.x, direction.z);
                this.mesh.rotation.y = BABYLON.Scalar.Lerp(this.mesh.rotation.y, targetRotation, 0.1);

                break;

            case 'talking':
                // Do nothing, just stand and talk
                break;
        }
    }
}


// Enemy Class
class Enemy extends Entity {
    constructor(scene, position, assetKey = 'wolf') {
        super(scene, position);
        this.assetKey = assetKey;
        this.health = 50;
        this.maxHealth = 50;
        this.attackDamage = 5;
        this.speed = 3.0;
        this.state = 'idle'; // idle, wandering, chasing, attacking, stunned, dead
        this.target = null; // Reference to player or another entity
        this.detectionRange = 25;
        this.attackRange = 2;
        this.wanderRadius = 30;
        this.targetPosition = position.clone();
        this.isDead = false;
    }

    async init() {
        console.log(`[Enemy] Initializing ${this.assetKey} at ${this.position.x.toFixed(1)}, ${this.position.z.toFixed(1)}`);
        // Load model (or create placeholder)
        await this.loadModel();
        // Setup physics
        this.setupPhysics();
        // Start AI
        this.startAI();
    }

    async loadModel() {
        // Simple placeholder for now
        this.mesh = BABYLON.MeshBuilder.CreateBox('enemyPlaceholder', { size: 1.0 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isPickable = true;
        this.mesh.metadata = { isEnemy: true, entity: this };

        const mat = new BABYLON.StandardMaterial('enemyMat', this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.8, 0.1, 0.1); // Red
        this.mesh.material = mat;

        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(this.mesh);
        }
    }

    setupPhysics() {
        if (!this.mesh || !this.scene.getPhysicsEngine()) return;

        // Use a CapsuleImpostor or BoxImpostor
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.BoxImpostor, // Simple box for now
            { mass: 10, friction: 0.5, restitution: 0.01 },
            this.scene
        );

        // Prevent rotating on impact (keep upright)
        this.mesh.physicsImpostor.registerBeforePhysicsStep(() => {
            this.mesh.rotation.x = 0;
            this.mesh.rotation.z = 0;
        });
    }

    startAI() {
        this.aiInterval = setInterval(() => {
            if (this.isDead) return;
            this.updateAI(0.2); // AI update every 200ms
        }, 200);
    }

    updateAI(deltaTime) {
        // State Machine logic
        if (!this.target) {
            this.target = this.findTarget(); // Look for player
        }

        if (this.target) {
            const distance = BABYLON.Vector3.Distance(this.mesh.position, this.target.mesh.position);

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
            if (this.state !== 'wandering' && Math.random() < 0.1) {
                this.startWandering();
            } else if (this.state === 'wandering') {
                this.wander(deltaTime);
            } else {
                this.state = 'idle';
            }
        }
    }

    findTarget() {
        // In a real game, you would use a spatial partitioning system
        // to efficiently find nearby players
        if (this.scene.player && this.scene.player.mesh && this.scene.player.mesh.position) {
            const playerPos = this.scene.player.mesh.position;
            if (BABYLON.Vector3.Distance(this.mesh.position, playerPos) <= this.detectionRange) {
                return this.scene.player;
            }
        }
        return null;
    }

    startWandering() {
        // Find a random position within wander radius
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * this.wanderRadius;
        this.targetPosition = new BABYLON.Vector3(
            this.position.x + Math.sin(angle) * distance,
            this.position.y,
            this.position.z + Math.cos(angle) * distance
        );

        // Ensure target is on terrain
        if (this.scene.world && this.scene.world.getHeightAt) {
            const groundY = this.scene.world.getHeightAt(
                this.targetPosition.x,
                this.targetPosition.z
            );
            this.targetPosition.y = groundY + 0.5; // Center point of the placeholder
        }

        this.state = 'wandering';
    }

    wander(deltaTime) {
        const toTarget = this.targetPosition.subtract(this.position);
        const distance = toTarget.length();

        if (distance < 0.5) {
            // Reached target, start new wander path
            this.startWandering();
            return;
        }

        // Move towards target
        const direction = toTarget.normalize();
        this.move(direction, this.speed, deltaTime);
    }

    chaseTarget(deltaTime) {
        const targetPos = this.target.mesh.position;
        const direction = targetPos.subtract(this.mesh.position).normalize();

        // Move towards target
        this.move(direction, this.speed * 1.5, deltaTime); // Run speed

        // Look at target
        this.mesh.lookAt(targetPos);
    }

    move(direction, speed, deltaTime) {
        // Only apply horizontal movement
        const horizontalDirection = new BABYLON.Vector3(direction.x, 0, direction.z).normalize();
        const displacement = horizontalDirection.scale(speed * deltaTime);

        // Preserve current vertical velocity (if any) or assume ground
        let verticalVelocity = this.mesh.physicsImpostor.getLinearVelocity().y;
        if (this.mesh.physicsImpostor.isGrounded) {
            verticalVelocity = 0; // Don't apply physics-based gravity if already grounded
        }

        // Apply movement using physics impostor
        const linearVelocity = new BABYLON.Vector3(
            displacement.x / deltaTime,
            verticalVelocity,
            displacement.z / deltaTime
        );
        this.mesh.physicsImpostor.setLinearVelocity(linearVelocity);

        // Update logic position from mesh position (which is updated by physics)
        this.position.copyFrom(this.mesh.position);
    }

    attack() {
        if (this.target && this.target.takeDamage) {
            // Only attack every 1 second (simple cooldown)
            if (!this._canAttack || (Date.now() - this._lastAttackTime > 1000)) {
                this.target.takeDamage(this.attackDamage, this);
                this._lastAttackTime = Date.now();
                this._canAttack = false;
                setTimeout(() => { this._canAttack = true; }, 1000);

                // Play attack animation/sound
                // this.playAnimation('attack');
            }
        }
    }

    takeDamage(amount, source) {
        if (this.isDead) return;
        this.health -= amount;

        // Show damage text
        if (this.scene.game.ui) {
            this.scene.game.ui.showFloatingText(
                amount.toFixed(0),
                this.mesh.position.add(new BABYLON.Vector3(0, 1.5, 0)),
                'playerDamage' // Enemy taking damage from player
            );
        }

        // Set target to attacker
        if (source.mesh) {
            this.target = source;
            this.state = 'chasing';
        }

        if (this.health <= 0) {
            this.die(source);
        }
    }

    die(killer) {
        if (this.isDead) return;
        this.isDead = true;
        this.state = 'dead';
        clearInterval(this.aiInterval);

        // Drop physics control
        if (this.mesh.physicsImpostor) {
            this.mesh.physicsImpostor.dispose();
            this.mesh.physicsImpostor = null;
        }

        // Play death animation (or just sink)
        this.mesh.isVisible = false;
        this.mesh.setEnabled(false); // Disable updates/rendering

        this.dropLoot(killer);
        console.log(`[Enemy] ${this.assetKey} defeated by ${killer.constructor.name}!`);

        // Remove from world entities after a delay
        setTimeout(() => {
            this.dispose();
        }, 5000);
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
                    id: 'gold',
                    name: 'Gold Coin',
                    icon: 'coin',
                    value: 1,
                    quantity: item.amount,
                    stackable: true,
                    position: this.mesh.position.clone().add(new BABYLON.Vector3(Math.random() - 0.5, 0.5, Math.random() - 0.5))
                });
                gold.init();
                this.scene.game.world.items.push(gold);
            }
        }
    }

    update(deltaTime) {
        if (this.isDead) return;

        // Update logic position from mesh position (physics moves mesh)
        this.position.copyFrom(this.mesh.position);

        // Simple physics check (for gravity/ground)
        if (this.mesh.physicsImpostor) {
            // Apply slight constant downward force if not grounded to ensure proper collision/grounding
            if (!this.mesh.physicsImpostor.isGrounded) {
                const gravityImpulse = new BABYLON.Vector3(0, -this.scene.getPhysicsEngine().gravity.y, 0).scale(this.mesh.physicsImpostor.getMass());
                this.mesh.physicsImpostor.applyForce(gravityImpulse, this.mesh.getAbsolutePosition());
            }
        }
    }
}


// Item Class
class Item extends Entity {
    constructor(scene, options) {
        super(scene, options.position);
        this.type = options.type || 'item'; // weapon, armor, consumable, currency, quest
        this.id = options.id;
        this.name = options.name || 'Unnamed Item';
        this.description = options.description || '';
        this.icon = options.icon || 'default';
        this.value = options.value || 1;
        this.quantity = options.quantity || 1;
        this.stackable = options.stackable || false;

        // Item-specific properties
        this.equipSlot = options.equipSlot || null;
        this.stats = options.stats || {};
        this.damage = options.damage || 0;
        this.attackSpeed = options.attackSpeed || 0;
        this.defense = options.defense || 0;
        this.effect = options.effect || null;
        this.cooldown = options.cooldown || 0;
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
                this.mesh = BABYLON.MeshBuilder.CreateCylinder(`item_${this.id}`, { height: 0.05, diameter: 0.2 }, this.scene);
                break;
            default:
                this.mesh = BABYLON.MeshBuilder.CreateBox(`item_${this.id}`, { size: 0.2 }, this.scene);
                break;
        }

        // Set position and material
        this.mesh.position = this.position;
        const mat = new BABYLON.StandardMaterial('itemMat', this.scene);
        mat.diffuseColor = new BABYLON.Color3(Math.random(), Math.random(), Math.random());
        this.mesh.material = mat;
        this.mesh.isPickable = true;
        this.mesh.metadata = { isItem: true, entity: this };

        // Simple animation (float and rotate)
        const floatAnim = new BABYLON.Animation('itemFloat', 'position.y', 30, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
        const floatKeys = [
            { frame: 0, value: this.position.y },
            { frame: 60, value: this.position.y + 0.5 },
            { frame: 120, value: this.position.y }
        ];
        floatAnim.setKeys(floatKeys);

        const rotateAnim = new BABYLON.Animation('itemRotate', 'rotation.y', 30, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
        const rotateKeys = [
            { frame: 0, value: 0 },
            { frame: 60, value: Math.PI * 2 }
        ];
        rotateAnim.setKeys(rotateKeys);

        this.scene.beginAnimation(this.mesh, 0, 120, true, 1.0, null, true);
        this.mesh.animations.push(floatAnim, rotateAnim);

        // Add to the item list for cleanup
        this.scene.game.world.items.push(this);
    }

    setupPhysics() {
        if (!this.mesh || !this.scene.getPhysicsEngine()) return;

        // Use a SphereImpostor for pickup detection
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.SphereImpostor,
            { mass: 0, friction: 0.5, restitution: 0.0, is : true }, // 'is' should be 'isSensor' or 'isTrigger' in some engines, but here just use is: true for now
            this.scene
        );

        // Set a small velocity to prevent the floating animation from fighting physics
        this.mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0, 0, 0));
        this.mesh.physicsImpostor.setAngularVelocity(new BABYLON.Vector3(0, 0, 0));
    }

    pickUp(player) {
        // Add to player's inventory (simple log for now)
        console.log(`[Item] Picked up: ${this.name} (x${this.quantity})`);

        // Notify UI
        if (this.scene.game.ui) {
            this.scene.game.ui.showMessage(`Picked up ${this.name} x${this.quantity}`, 2000);
        }

        // Play sound
        if (this.scene.audio) {
            this.scene.audio.playSound('item_pickup');
        }

        // Remove from scene
        this.dispose();

        // Return true if pickup was successful
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
                console.log(`[Item] Cannot use item type: ${this.type}`);
                return false;
        }
    }

    useConsumable(user) {
        if (this.id === 'health_potion') {
            user.heal(50);
            return true;
        } else if (this.id === 'mana_potion') {
            user.restoreMana(50);
            return true;
        }
        return false;
    }

    equip(user) {
        // Logic to equip weapon/armor
        console.log(`[Item] Equipped: ${this.name}`);
        user.equip(this);
        return true;
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
