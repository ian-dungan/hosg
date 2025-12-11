// Simplex Noise for terrain generation - MOVED TO TOP TO FIX INITIALIZATION ERROR
class SimplexNoise {
    constructor(seed = Math.random()) {
        this.grad3 = [
            [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
            [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
            [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
        ];

        // Proper seeded permutation table generation
        this.p = [];
        for (let i = 0; i < 256; i++) {
            this.p[i] = i;
        }
        
        // Seed-based shuffle (Fisher-Yates)
        const random = this.seededRandom(seed);
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [this.p[i], this.p[j]] = [this.p[j], this.p[i]];
        }

        // To remove the need for index wrapping, double the permutation table length
        this.perm = new Array(512);
        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
        }
    }
    
    // Seeded random number generator (LCG - Linear Congruential Generator)
    seededRandom(seed) {
        let state = seed;
        return function() {
            state = (state * 1664525 + 1013904223) % 4294967296;
            return state / 4294967296;
        };
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

// ============================================================================
// WorldItem Class - Items that can be picked up from the ground
// ============================================================================
class WorldItem {
    constructor(scene, position, itemData) {
        this.scene = scene;
        this.position = position;
        this.itemData = itemData;
        this.mesh = null;
        
        this.createMesh();
        this.createSparkle();
    }
    
    createMesh() {
        // Create floating item mesh
        this.mesh = BABYLON.MeshBuilder.CreateBox('worldItem', {
            size: 0.5
        }, this.scene);
        
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.5; // Float above ground
        
        // Material based on rarity
        const mat = new BABYLON.StandardMaterial('itemMat', this.scene);
        mat.emissiveColor = this.getRarityColor(this.itemData.rarity);
        mat.alpha = 0.8;
        this.mesh.material = mat;
        
        // Metadata
        this.mesh.metadata = { isWorldItem: true, itemData: this.itemData };
        
        // Animate rotation and bob
        this.startTime = Date.now();
        this.scene.registerBeforeRender(() => {
            if (!this.mesh || this.mesh.isDisposed()) return;
            
            const time = (Date.now() - this.startTime) / 1000;
            this.mesh.rotation.y = time * 2;
            this.mesh.position.y = this.position.y + 0.5 + Math.sin(time * 3) * 0.1;
        });
    }
    
    createSparkle() {
        // Create particle sparkle effect
        const particleSystem = new BABYLON.ParticleSystem('itemSparkle', 50, this.scene);
        particleSystem.particleTexture = new BABYLON.Texture(
            'https://www.babylonjs-playground.com/textures/flare.png',
            this.scene
        );
        
        particleSystem.emitter = this.mesh;
        particleSystem.minEmitBox = new BABYLON.Vector3(-0.3, 0, -0.3);
        particleSystem.maxEmitBox = new BABYLON.Vector3(0.3, 0.5, 0.3);
        
        const color = this.getRarityColor(this.itemData.rarity);
        particleSystem.color1 = new BABYLON.Color4(color.r, color.g, color.b, 1);
        particleSystem.color2 = new BABYLON.Color4(color.r * 0.5, color.g * 0.5, color.b * 0.5, 1);
        particleSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0);
        
        particleSystem.minSize = 0.05;
        particleSystem.maxSize = 0.15;
        particleSystem.minLifeTime = 0.5;
        particleSystem.maxLifeTime = 1.5;
        particleSystem.emitRate = 10;
        
        particleSystem.gravity = new BABYLON.Vector3(0, 2, 0);
        particleSystem.direction1 = new BABYLON.Vector3(-0.5, 0.5, -0.5);
        particleSystem.direction2 = new BABYLON.Vector3(0.5, 1, 0.5);
        
        particleSystem.minEmitPower = 0.5;
        particleSystem.maxEmitPower = 1.5;
        particleSystem.updateSpeed = 0.01;
        
        particleSystem.start();
        this.particleSystem = particleSystem;
    }
    
    getRarityColor(rarity) {
        const colors = {
            common: new BABYLON.Color3(0.6, 0.6, 0.6),
            uncommon: new BABYLON.Color3(0, 1, 0),
            rare: new BABYLON.Color3(0, 0.4, 1),
            epic: new BABYLON.Color3(0.6, 0.2, 1),
            legendary: new BABYLON.Color3(1, 0.5, 0)
        };
        return colors[rarity] || colors.common;
    }
    
    dispose() {
        if (this.particleSystem) {
            this.particleSystem.dispose();
        }
        if (this.mesh) {
            this.mesh.dispose();
        }
    }
}

// World Class
class World {
    // ... World implementation (omitted for brevity)
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
        this.worldItems = []; // Items on ground that can be picked up

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
        if (options.onProgress) {
            this.onProgress = options.onProgress;
        }
    }

    async init() {
        this.reportProgress('Creating lights...', 10);
        this.createLights();
        
        this.reportProgress('Creating skybox...', 20);
        this.createSkybox();
        
        this.reportProgress('Generating terrain...', 30);
        this.createTerrain();
        await this.delay(10); // Let rendering catch up
        
        this.reportProgress('Creating water...', 50);
        this.createWater();
        await this.delay(10);
        
        this.reportProgress('Populating world...', 60);
        await this.populateWorld();
        
        this.reportProgress('Setting up physics...', 90);
        this.setupEventListeners();

        // Create terrain physics after short delay if needed
        // This ensures Babylon has processed vertex modifications
        if (this.needsPhysics && this.terrain) {
            setTimeout(() => {
                if (this.scene.getPhysicsEngine()) {
                    this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
                        this.terrain,
                        BABYLON.PhysicsImpostor.MeshImpostor,
                        { mass: 0, friction: 1.0, restitution: 0.0 },
                        this.scene
                    );
                    console.log('[World] ✓ Terrain physics created and enabled');
                }
            }, 100);
        }

        // CRITICAL: Signal player that world is ready
        // Wait a bit to ensure physics is fully stabilized
        setTimeout(() => {
            console.log('[World] ✅ World fully initialized, signaling player...');
            this.reportProgress('Ready!', 100);
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
        this.sunLight.intensity = 0.7;  // REDUCED from 1.0 - less harsh sunlight
        this.sunLight.diffuse = new BABYLON.Color3(1, 0.95, 0.9);
        this.sunLight.specular = new BABYLON.Color3(0.3, 0.3, 0.3);  // REDUCED from bright - less shiny highlights

        // Enable shadows
        this.sunLight.shadowEnabled = true;
        this.shadowGenerator = new BABYLON.ShadowGenerator(1024, this.sunLight);
        this.shadowGenerator.useBlurExponentialShadowMap = true;
        this.shadowGenerator.blurKernel = 32;

        // Ambient light
        this.ambientLight = new BABYLON.HemisphericLight('ambientLight', new BABYLON.Vector3(0, 1, 0), this.scene);
        this.ambientLight.intensity = 0.4;  // REDUCED from 0.5 - softer ambient fill
        this.ambientLight.diffuse = new BABYLON.Color3(0.5, 0.5, 0.6);
        this.ambientLight.specular = new BABYLON.Color3(0.1, 0.1, 0.1);
    }

    createSkybox() {
        // Try to load custom HDRI skybox from ASSET_PATHS
        let skyPath = 'assets/environment/DaySkyHDRI023B_4K_TONEMAPPED.jpg'; // Default fallback
        
        // Check if ASSET_PATHS exists and has skybox config
        if (window.ASSET_PATHS && window.ASSET_PATHS.getTexturePath) {
            skyPath = ASSET_PATHS.getTexturePath('sky_hdri');
            console.log('[World] Using skybox from ASSET_PATHS:', skyPath);
        }

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
                    skyTexture = BABYLON.Texture.CreateGradientTexture("skyGradient", 
                        new BABYLON.Color3(0.1, 0.2, 0.4), 
                        new BABYLON.Color3(0.45, 0.65, 0.9), 
                        300, 
                        this.scene
                    );
                    skyboxMaterial.emissiveTexture = skyTexture;
                } else {
                    skyboxMaterial.diffuseColor = new BABYLON.Color3(0.45, 0.65, 0.9);
                    skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
                    skyboxMaterial.emissiveColor = new BABYLON.Color3(0.45, 0.65, 0.9);
                }
            } catch (error) {
                console.warn('[World] Failed to create gradient texture, using flat color:', error);
                // Fallback to flat color
                skyboxMaterial.diffuseColor = new BABYLON.Color3(0.45, 0.65, 0.9);
                skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
                skyboxMaterial.emissiveColor = new BABYLON.Color3(0.45, 0.65, 0.9);
            }
            this.skybox.material = skyboxMaterial;
        }
    }

    createTerrain() {
        // Check if heightmap is available in ASSET_MANIFEST
        let heightmapPath = null;
        if (window.ASSET_MANIFEST && window.ASSET_MANIFEST.TERRAIN && window.ASSET_MANIFEST.TERRAIN.HEIGHTMAP) {
            heightmapPath = window.ASSET_MANIFEST.TERRAIN.HEIGHTMAP;
        }
        
        if (heightmapPath) {
            // Create terrain from heightmap if available
            this.terrain = BABYLON.MeshBuilder.CreateGroundFromHeightMap(
                "terrain",
                heightmapPath,
                {
                    width: this.options.size,
                    height: this.options.size,
                    subdivisions: this.options.segments,
                    maxHeight: this.options.maxHeight,
                    onReady: () => {
                        // Heightmap loaded successfully - use it as-is
                        this.terrain.checkCollisions = true;

                        // Apply physics impostor
                    if (this.scene.getPhysicsEngine()) {
                        this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
                            this.terrain,
                            BABYLON.PhysicsImpostor.MeshImpostor,
                            { mass: 0, friction: 1.0, restitution: 0.0 },
                            this.scene
                        );
                        console.log('[World] ✓ Terrain physics created and enabled');
                    }
                    
                    // Create collision barrier
                    this.createCollisionBarrier();

                    // Apply terrain material asynchronously (FIX: Called from the sync callback)
                    this.createTerrainMaterial(); 
                }
            },
            this.scene
        );
        } else {
            // No heightmap - create ground with FIXED SEED procedural generation
            console.log('[World] No heightmap, using fixed-seed procedural terrain');
            
            // Create flat ground first (synchronous)
            this.terrain = BABYLON.MeshBuilder.CreateGround(
                "terrain",
                {
                    width: this.options.size,
                    height: this.options.size,
                    subdivisions: this.options.segments
                },
                this.scene
            );
            
            // Apply procedural heightmap immediately
            this.generateHeightmap();
            
            // Set properties
            this.terrain.checkCollisions = true;
            this.terrain.isPickable = true;
            this.terrain.receiveShadows = true;
            this.terrain.metadata = { isTerrain: true, type: 'ground' };
            
            // Apply material
            this.createTerrainMaterial();
            
            // Physics will be created in init() after a delay
            // This ensures Babylon has processed the vertex modifications
            this.needsPhysics = true;
        }

        // Common setup for both terrain types
        this.terrain.receiveShadows = true;
        this.terrain.metadata = { isTerrain: true, type: 'ground' };
    }

    createCollisionBarrier() {
        // DISABLED: Collision barrier was causing players to teleport back on hills
        // The main terrain physics impostor is sufficient for collision
        console.log('[World] Collision barrier disabled - using main terrain physics only');
        return;
        
        /* ORIGINAL CODE - DISABLED
        const BARRIER_OFFSET = -0.1; // Offset below the terrain surface
        
        // Clone terrain mesh
        this.collisionBarrier = this.terrain.clone("collisionBarrier");
        this.collisionBarrier.position.y += BARRIER_OFFSET;
        
        // Make it invisible and non-pickable
        this.collisionBarrier.isVisible = false;
        this.collisionBarrier.isPickable = false;
        
        // Ensure kinematic and physics actors collide
        this.collisionBarrier.checkCollisions = true;
        this.collisionBarrier.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.collisionBarrier,
            BABYLON.PhysicsImpostor.MeshImpostor,
            { mass: 0, friction: 1.0, restitution: 0.0 },
            this.scene
        );
        console.log(`[World] ✓ Collision barrier cloned from terrain and offset ${BARRIER_OFFSET}y`);
        */
    }

    generateHeightmap() {
        const positions = this.terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const normals = [];
        // Create noise generator - NOW SAFE BECAUSE CLASS IS DEFINED
        const noiseGenerator = new SimplexNoise(this.options.seed);

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];

            // Apply noise (multiple octaves for detail)
            let y = 0;
            y += noiseGenerator.noise2D(x * 0.005, z * 0.005) * 1;
            y += noiseGenerator.noise2D(x * 0.01, z * 0.01) * 0.5;
            y += noiseGenerator.noise2D(x * 0.02, z * 0.02) * 0.25;
            y += noiseGenerator.noise2D(x * 0.04, z * 0.04) * 0.125;
            
            // Scale and clamp
            positions[i + 1] = y * this.options.maxHeight;
        }

        BABYLON.VertexData.ComputeNormals(positions, this.terrain.getIndices(), normals);
        this.terrain.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        this.terrain.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
        // Note: refreshBoundingInfo() called in createTerrain() after this function
    }
    
    // Helper function to get the actual height at a given X/Z coordinate
    getHeightAt(x, z) {
        if (!this.terrain) return 0;
        
        // Use a raycast from high up to hit the ground
        const ray = new BABYLON.Ray(new BABYLON.Vector3(x, this.options.maxHeight * 2, z), BABYLON.Vector3.Down());
        const pickInfo = this.scene.pickWithRay(ray, (mesh) => mesh === this.terrain);
        
        return pickInfo.hit ? pickInfo.pickedPoint.y : 0;
    }
    
    // Alias for player.js compatibility
    getTerrainHeight(x, z) {
        return this.getHeightAt(x, z);
    }

    // FIX: Removed 'async' keyword and replaced 'await' with '.then()' to fix SyntaxError
    createTerrainMaterial() {
        if (!this.assetLoader) {
            console.warn('[World] AssetLoader not available, using simple green material');
            this.terrain.material = new BABYLON.StandardMaterial('basicTerrain', this.scene);
            this.terrain.material.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.4);
            return;
        }

        this.terrainMaterial = new BABYLON.StandardMaterial('terrainMat', this.scene);
        this.terrainMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.4); // Base color
        this.terrainMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); // LOW specular - less shiny, reduces bright spots
        this.terrain.material = this.terrainMaterial;

        // Load grass texture from ASSET_PATHS
        if (!window.ASSET_PATHS || !this.assetLoader) return;
        
        const grassTexturePath = ASSET_PATHS.getTexturePath('grass');
        if (!grassTexturePath) return;
        
        const loader = this.assetLoader;

        // Load grass diffuse texture
        loader.loadTexture(grassTexturePath, { uScale: 50, vScale: 50 })
            .then(diffuseTexture => {
                if (diffuseTexture) {
                    this.terrainMaterial.diffuseTexture = diffuseTexture;
                    console.log('[World] ✓ Grass texture loaded');
                }
            })
            .catch(e => {
                console.error('[World] Failed to load grass texture:', e);
            });
    }

    // FIX: Removed 'async' keyword and replaced 'await' with '.then()' to fix SyntaxError
    createWater() {
        // Create water plane
        this.water = BABYLON.MeshBuilder.CreateGround(
            "water",
            { width: this.options.size * 1.5, height: this.options.size * 1.5, subdivisions: 1 },
            this.scene
        );
        this.water.position.y = this.options.waterLevel;
        this.water.isPickable = false;
        this.water.checkCollisions = false; // CRITICAL: No collision with water
        // No physics impostor on water!

        // Check for WaterMaterial and AssetLoader
        if (typeof BABYLON.WaterMaterial === 'undefined' || !this.assetLoader) {
            console.log('[World] WaterMaterial not found, using basic material');
            this.waterMaterial = new BABYLON.StandardMaterial('basicWater', this.scene);
            this.waterMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.9);
            this.waterMaterial.alpha = 0.7;
            this.water.material = this.waterMaterial;
            return;
        }

        // Use WaterMaterial if available
        try {
            this.waterMaterial = new BABYLON.WaterMaterial("waterMat", this.scene, new BABYLON.Vector2(512, 512));
            this.waterMaterial.backFaceCulling = true; // Water should only be visible from above
            this.waterMaterial.waterColor = new BABYLON.Color3(0.1, 0.5, 0.9);
            this.waterMaterial.waterColorLevel = 0.1;
            this.waterMaterial.fresnelLevel = 1.0;
            this.waterMaterial.waveHeight = 0.3;
            this.waterMaterial.waveLength = 0.1;

            // Reflect terrain
            this.waterMaterial.reflectionTexture = new BABYLON.MirrorTexture("reflection", 1024, this.scene, true);
            this.waterMaterial.reflectionTexture.mirrorPlane = new BABYLON.Plane(0, -1, 0, this.options.waterLevel);
            this.waterMaterial.reflectionTexture.renderList.push(this.skybox);
            this.waterMaterial.reflectionTexture.renderList.push(this.terrain);
            
            // Refraction (if transparent)
            this.waterMaterial.refractionTexture = new BABYLON.RenderTargetTexture("refraction", 1024, this.scene, true);
            this.waterMaterial.refractionTexture.renderList.push(this.terrain);
            
            this.water.material = this.waterMaterial;

            // Load water bump texture from ASSET_PATHS if available
            if (window.ASSET_PATHS && window.ASSET_PATHS.getTexturePath) {
                const waterBumpPath = ASSET_PATHS.getTexturePath('water_bump');
                if (waterBumpPath) {
                    this.assetLoader.loadTexture(waterBumpPath, { uScale: 5, vScale: 5 })
                        .then(bumpTexture => {
                            if (bumpTexture) {
                                this.waterMaterial.bumpTexture = bumpTexture;
                                this.waterMaterial.bumpTexture.level = 0.1;
                                console.log('[World] ✓ Water bump texture loaded');
                            }
                        })
                        .catch(e => {
                            console.log('[World] Water bump texture not found, using smooth water:', e);
                        });
                }
            }

        } catch (error) {
            console.error('[World] Error creating WaterMaterial:', error);
            // Fallback to basic material again if WaterMaterial throws an internal error
            this.waterMaterial = new BABYLON.StandardMaterial('basicWater', this.scene);
            this.waterMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.9);
            this.waterMaterial.alpha = 0.7;
            this.water.material = this.waterMaterial;
        }
    }

    async populateWorld() {
        // Reduced initial spawns for faster loading
        this.reportProgress('Spawning trees...', 65);
        await this.createTrees(20); // Now async to support GLTF loading
        await this.delay(10);
        
        this.reportProgress('Spawning rocks...', 70);
        this.createRocks(15); // Reduced from 30
        await this.delay(10);
        
        this.reportProgress('Spawning grass...', 75);
        this.createGrass(100); // Reduced from 200
        await this.delay(10);
        
        this.reportProgress('Spawning NPCs...', 80);
        this.createNPCs(5); // Reduced from 10
        await this.delay(10);
        
        this.reportProgress('Spawning enemies...', 85);
        this.createEnemies(10); // Reduced from 20
        await this.delay(10);
    }
    
    reportProgress(message, percent) {
        console.log(`[World] ${message} (${percent}%)`);
        if (this.onProgress) {
            this.onProgress(message, percent);
        }
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async createTrees(count) { 
        const spawnRadius = Math.min(200, this.options.size * 0.4);
        let spawned = 0;
        let attempts = 0;
        const maxAttempts = count * 5;
        
        // Check if we have tree models available
        const hasTreeModels = window.ASSET_PATHS && 
                             window.ASSET_PATHS.GENERIC_MODELS && 
                             (window.ASSET_PATHS.GENERIC_MODELS.tree_pine ||
                              window.ASSET_PATHS.GENERIC_MODELS.tree_oak ||
                              window.ASSET_PATHS.GENERIC_MODELS.tree_birch);
        
        const treeTypes = [];
        if (hasTreeModels) {
            if (window.ASSET_PATHS.GENERIC_MODELS.tree_pine) treeTypes.push('tree_pine');
            if (window.ASSET_PATHS.GENERIC_MODELS.tree_oak) treeTypes.push('tree_oak');
            if (window.ASSET_PATHS.GENERIC_MODELS.tree_birch) treeTypes.push('tree_birch');
        }
        
        while (spawned < count && attempts < maxAttempts) {
            attempts++;
            
            // Random position
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const x = Math.sin(angle) * distance;
            const z = Math.cos(angle) * distance;
            
            // Get terrain height
            const groundY = this.getHeightAt(x, z);
            
            // Skip if underwater (with margin)
            const waterY = this.options.waterLevel || 0;
            if (groundY <= waterY + 1.0) continue;
            
            // Check slope (don't spawn on steep hills)
            const slopeCheck = 2.0;
            const y1 = this.getHeightAt(x + slopeCheck, z);
            const y2 = this.getHeightAt(x - slopeCheck, z);
            const y3 = this.getHeightAt(x, z + slopeCheck);
            const y4 = this.getHeightAt(x, z - slopeCheck);
            const maxSlope = Math.max(
                Math.abs(y1 - groundY),
                Math.abs(y2 - groundY),
                Math.abs(y3 - groundY),
                Math.abs(y4 - groundY)
            );
            if (maxSlope > 3.0) continue; // Too steep
            
            // Create tree (either GLTF model or simple mesh)
            if (hasTreeModels && treeTypes.length > 0) {
                // Load GLTF tree model
                const treeType = treeTypes[Math.floor(Math.random() * treeTypes.length)];
                await this.createTreeModel(treeType, x, groundY, z);
            } else {
                // Fallback to simple tree mesh
                this.createSimpleTree(x, groundY, z);
            }
            
            spawned++;
        }
        
        console.log(`[World] Spawned ${spawned}/${count} trees (${attempts} attempts)`);
    }
    
    async createTreeModel(treeType, x, groundY, z) {
        try {
            const modelPath = ASSET_PATHS.getModelPath(treeType);
            if (!modelPath) {
                this.createSimpleTree(x, groundY, z);
                return;
            }
            
            const result = await this.scene.assetLoader.loadModel(modelPath, {
                scaling: new BABYLON.Vector3(1.0, 1.0, 1.0)
            });
            
            if (!result || !result.meshes || result.meshes.length === 0) {
                this.createSimpleTree(x, groundY, z);
                return;
            }
            
            const tree = result.meshes[0];
            tree.position = new BABYLON.Vector3(x, groundY, z);
            
            // Random rotation for variety
            tree.rotation.y = Math.random() * Math.PI * 2;
            
            // Random scale variation (90% - 110%)
            const scaleVariation = 0.9 + Math.random() * 0.2;
            tree.scaling.scaleInPlace(scaleVariation);
            
            // Enable collisions
            tree.checkCollisions = true;
            tree.metadata = { isTree: true };
            
            // Hide any debug meshes
            result.meshes.forEach(mesh => {
                if (!mesh) return;
                const name = (mesh.name || '').toLowerCase();
                if (name.includes('collision') || name.includes('collider')) {
                    mesh.isVisible = false;
                }
                mesh.showBoundingBox = false;
            });
            
            // Enable shadows if shadow generator exists
            if (this.scene.shadowGenerator) {
                this.scene.shadowGenerator.addShadowCaster(tree);
            }
            tree.receiveShadows = true;
            
        } catch (error) {
            console.warn('[World] Failed to load tree model, using simple tree:', error);
            this.createSimpleTree(x, groundY, z);
        }
    }
    
    createSimpleTree(x, groundY, z) {
        // Create simple cylinder tree (fallback)
        const tree = BABYLON.MeshBuilder.CreateCylinder("tree", {
            diameterTop: 0.5,
            diameterBottom: 0.8,
            height: 6,
            tessellation: 8
        }, this.scene);
        
        tree.position = new BABYLON.Vector3(x, groundY + 3, z);
        
        const treeMaterial = new BABYLON.StandardMaterial("treeMat", this.scene);
        treeMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.3, 0.2);
        tree.material = treeMaterial;
        
        // Add foliage
        const foliage = BABYLON.MeshBuilder.CreateSphere("foliage", {
            diameter: 4,
            segments: 8
        }, this.scene);
        foliage.parent = tree;
        foliage.position.y = 2;
        
        const foliageMat = new BABYLON.StandardMaterial("foliageMat", this.scene);
        foliageMat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.2);
        foliage.material = foliageMat;
        
        tree.checkCollisions = true;
        tree.metadata = { isTree: true };
        
        // Enable shadows if available
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(tree);
        }
        tree.receiveShadows = true;
    }
    
    createRocks(count) { 
        const spawnRadius = Math.min(200, this.options.size * 0.4);
        let spawned = 0;
        let attempts = 0;
        const maxAttempts = count * 5;
        
        while (spawned < count && attempts < maxAttempts) {
            attempts++;
            
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const x = Math.sin(angle) * distance;
            const z = Math.cos(angle) * distance;
            
            const groundY = this.getHeightAt(x, z);
            
            // Skip if underwater
            const waterY = this.options.waterLevel || 0;
            if (groundY <= waterY + 0.5) continue;
            
            // Create rock
            const rockSize = 1 + Math.random() * 2;
            const rock = BABYLON.MeshBuilder.CreateSphere("rock", {
                diameter: rockSize,
                segments: 6
            }, this.scene);
            
            rock.position = new BABYLON.Vector3(x, groundY + rockSize / 2, z);
            rock.scaling.y = 0.6; // Flatten slightly
            
            const rockMat = new BABYLON.StandardMaterial("rockMat", this.scene);
            rockMat.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
            rock.material = rockMat;
            
            rock.checkCollisions = true;
            rock.metadata = { isRock: true };
            
            spawned++;
        }
        
        console.log(`[World] Spawned ${spawned}/${count} rocks (${attempts} attempts)`);
    }
    
    createGrass(count) { 
        const spawnRadius = Math.min(150, this.options.size * 0.3);
        let spawned = 0;
        
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const x = Math.sin(angle) * distance;
            const z = Math.cos(angle) * distance;
            
            const groundY = this.getHeightAt(x, z);
            
            // Skip if underwater
            const waterY = this.options.waterLevel || 0;
            if (groundY <= waterY + 0.2) continue;
            
            // Create small grass tuft
            const grass = BABYLON.MeshBuilder.CreatePlane("grass", {
                width: 0.5,
                height: 0.8
            }, this.scene);
            
            grass.position = new BABYLON.Vector3(x, groundY + 0.4, z);
            grass.rotation.y = Math.random() * Math.PI * 2;
            grass.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
            
            const grassMat = new BABYLON.StandardMaterial("grassMat", this.scene);
            grassMat.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.3);
            grassMat.backFaceCulling = false;
            grass.material = grassMat;
            
            spawned++;
        }
        
        console.log(`[World] Spawned ${spawned}/${count} grass tufts`);
    }
    createNPCs(count) { 
        const spawnRadius = Math.min(80, this.options.size * 0.2);
        for (let i = 1; i <= count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const npcX = Math.sin(angle) * distance;
            const npcZ = Math.cos(angle) * distance;

            const drySpot = this.findDrySpot(npcX, npcZ, 8, 8, 0.4);

            const position = new BABYLON.Vector3(drySpot.x, drySpot.y, drySpot.z);
            
            // Cycle through available NPC types
            const npcTypes = ['merchant', 'guard'];
            const type = npcTypes[(i - 1) % npcTypes.length]; 

            const npc = new NPC(this.scene, position, i, type);
            this.npcs.push(npc);
        }
    }

    createEnemies(count) { 
        // Keep enemies close to the playable spawn so they are easy to find 
        const spawnRadius = Math.min(80, this.options.size * 0.2); 
        for (let i = 1; i <= count; i++) { 
            // Bias positions toward the center of the map 
            const angle = Math.random() * Math.PI * 2; 
            const distance = Math.random() * spawnRadius; 
            const enemyX = Math.sin(angle) * distance; 
            const enemyZ = Math.cos(angle) * distance; 
            
            const drySpot = this.findDrySpot(enemyX, enemyZ, 30, 20, 2.0);
            
            // CRITICAL: Add large height buffer to ensure enemies spawn ABOVE terrain
            // Start at +5.0 units above ground, then adjust down after model loads
            const position = new BABYLON.Vector3(drySpot.x, drySpot.y + 5.0, drySpot.z);

            // Cycle through available ENEMY types (wolf, goblin)
            const enemyTypes = ['wolf', 'goblin'];
            const type = enemyTypes[(i - 1) % enemyTypes.length];

            // Use the determined type
            const enemy = new Enemy(this.scene, position, i, type);
            this.enemies.push(enemy);
        }
    }

    findDrySpot(x, z, attempts = 20, radius = 15, margin = 1.0) {
        const waterY = this.options.waterLevel || 0;
        
        // Check current position first
        const currentY = this.getHeightAt(x, z);
        if (currentY > waterY + margin) {
            return { x, z, y: currentY };
        }

        // Try to find dry spot nearby
        for (let i = 0; i < attempts; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * radius;
            const newX = x + Math.sin(angle) * distance;
            const newZ = z + Math.cos(angle) * distance;
            const newY = this.getHeightAt(newX, newZ);

            // Found dry land!
            if (newY > waterY + margin) {
                return { x: newX, z: newZ, y: newY };
            }
        }
        
        // Last resort: expand search much wider
        for (let i = 0; i < attempts; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = radius + Math.random() * radius * 2;
            const newX = x + Math.sin(angle) * distance;
            const newZ = z + Math.cos(angle) * distance;
            const newY = this.getHeightAt(newX, newZ);

            if (newY > waterY + margin) {
                return { x: newX, z: newZ, y: newY };
            }
        }
        
        // CRITICAL: If still no dry spot, spawn at origin which should be dry
        console.warn(`[World] Could not find dry spot near (${x.toFixed(1)}, ${z.toFixed(1)}), using origin`);
        const originY = this.getHeightAt(0, 0);
        return { x: 0, z: 0, y: Math.max(originY, waterY + margin + 1) };
    }

    setupEventListeners() { /* ... implementation omitted ... */ }
    update(deltaTime) { /* ... implementation omitted ... */ }
    dispose() { /* ... implementation omitted ... */ }
}

// ============================================================================
// Entity Base Class - Base for NPCs, Enemies, Items
// Preserves all original functionality from function-style Entity
// ============================================================================
class Entity {
    constructor(scene, position) {
        this.scene = scene;

        // Better position handling (from original Entity)
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

    // Update method - syncs mesh position with entity position
    update(deltaTime) {
        if (this.mesh && this.mesh.position && this.position &&
            typeof this.mesh.position.copyFrom === "function") {
            this.mesh.position.copyFrom(this.position);
        }
    }

    // Dispose method - cleans up entity
    dispose() {
        this._isDisposed = true;
        if (this.mesh && typeof this.mesh.dispose === "function") {
            this.mesh.dispose();
            this.mesh = null;
        }
    }
}

// NPC Class (inherits from Entity)
class NPC extends Entity {
    // ... NPC implementation (omitted for brevity)
    constructor(scene, position, id, type = 'default') {
        super(scene, position);
        this.id = id;
        this.type = type;
        this.assetKey = type;
        this.name = `NPC ${id}`;
        this.state = 'idle'; // idle, wandering, interacting
        this.walkRadius = 20;
        this.moveSpeed = 1.0;
        this.targetPosition = null;

        this.init();
        console.log(`${this.name} is idling`);
    }

    async init() {
        await this.loadModel();
        this.setupPhysics();
        // Start wandering after a short delay
        setTimeout(() => {
            this.startWandering();
        }, 5000 + Math.random() * 5000);
    }
    
    // Fallback mesh creator - FIXED to not use assetLoader
    createPlaceholderMesh() {
        if (!this.scene) {
            console.error('[NPC] Scene is null, cannot create placeholder mesh');
            return;
        }
        
        this.mesh = BABYLON.MeshBuilder.CreateCylinder(`npc_placeholder_${this.id}`, { height: 1.8, diameter: 0.8 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.metadata = { isNPC: true, id: this.id };
        
        // Create simple material - FIXED
        const material = new BABYLON.StandardMaterial(`npc_mat_${this.id}`, this.scene);
        material.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.8); // Blue color for NPCs
        this.mesh.material = material;
        
        // Enable shadows
        this.mesh.receiveShadows = true;
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(this.mesh);
        }
        this.mesh.checkCollisions = true;
        this.mesh.ellipsoid = new BABYLON.Vector3(0.4, 0.9, 0.4);
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0.9, 0);
    }

    async loadModel() {
        // NPCs not configured in ASSET_PATHS yet, use placeholder
        if (!window.ASSET_PATHS || !window.ASSET_PATHS.NPC_MODELS || !window.ASSET_PATHS.NPC_MODELS[this.assetKey]) {
            console.warn(`[NPC] No model configured for ${this.assetKey}, using simple mesh`);
            this.createPlaceholderMesh();
            return;
        }

        const modelPath = ASSET_PATHS.getNPCPath(this.assetKey);
        if (!modelPath) {
            console.warn(`[NPC] Model path not found for ${this.assetKey}, using simple mesh`);
            this.createPlaceholderMesh();
            return;
        }
        
        try {
            const result = await this.scene.assetLoader.loadModel(modelPath, { 
                name: this.name, 
                scaling: new BABYLON.Vector3(1.0, 1.0, 1.0) 
            });
            
            if (!result || !result.meshes || result.meshes.length === 0) {
                console.warn(`[NPC] No meshes in model for ${this.assetKey}, using simple mesh`);
                this.createPlaceholderMesh();
                return;
            }
            
            this.mesh = result.meshes[0]; // Use first mesh (root)
            
            // CRITICAL: Hide collision/debug meshes
            result.meshes.forEach((mesh, index) => {
                if (!mesh) return;
                
                // Hide debug meshes
                const name = (mesh.name || '').toLowerCase();
                if (name.includes('collision') || 
                    name.includes('collider') || 
                    name.includes('hitbox') ||
                    name.includes('debug') ||
                    name.includes('physics')) {
                    mesh.isVisible = false;
                    mesh.isPickable = false;
                    console.log(`[NPC] Hiding debug mesh: ${mesh.name}`);
                }
                
                // Turn off bounding box display
                mesh.showBoundingBox = false;
                
                // Disable ellipsoid rendering
                if (mesh.ellipsoid) {
                    mesh.showEllipsoid = false;
                }
            });
            
            this.mesh.position.copyFrom(this.position);
            
            // Adjust scale if needed based on model bounds
            const bounds = this.mesh.getHierarchyBoundingVectors(true);
            const currentHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
            const targetHeight = 1.8;
            const finalScale = targetHeight / currentHeight;
            this.mesh.scaling.scaleInPlace(finalScale);

            // Position feet on ground
            const offset = bounds.min.y * finalScale;
            this.mesh.position.y = this.position.y - offset;
            
            // CRITICAL: Update entity position to match mesh
            this.position.copyFrom(this.mesh.position);
            
            this.mesh.metadata = { isNPC: true, id: this.id };
            this.mesh.checkCollisions = true;
            this.mesh.ellipsoid = new BABYLON.Vector3(0.4, 0.9, 0.4);
            this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0.9, 0);
            
            // Store animations
            this.animations = result.animationGroups;
            
        } catch (e) {
            console.warn(`[NPC] Failed to load model for ${this.assetKey}, using simple mesh:`, e);
            this.createPlaceholderMesh();
        }
    }
    
    setupPhysics() { /* ... implementation omitted ... */ }
    startWandering() { /* ... implementation omitted ... */ }
    update(deltaTime) { /* ... implementation omitted ... */ }
}

// Enemy Class (inherits from Entity, extends NPC for simple AI)
class Enemy extends NPC {
    // ... Enemy implementation (omitted for brevity)
    constructor(scene, position, id, type = 'wolf') {
        super(scene, position, id, type); // Call NPC constructor
        this.name = `Enemy ${id}`;
        this.isEnemy = true; // CRITICAL: Mark as enemy immediately for combat system
        this.health = 50;
        this.maxHealth = 50;
        this.damage = 10;
        this.detectionRange = 25;
        this.attackRange = 2;
        this.state = 'idle'; // idle, chasing, attacking
        this.target = null; // The player or another enemy
    }

    // FIX: Add a defensive check to handle assets that fail to load
    async loadModel() {
        // FIX: Ensure assetKey is a valid string, defaulting to a known fallback if undefined/empty
        this.assetKey = this.assetKey || 'wolf'; 
        
        if (!window.ASSET_PATHS || !window.ASSET_PATHS.ENEMY_MODELS) {
            console.warn(`[Enemy] ASSET_PATHS not loaded, skipping model for ${this.assetKey}`);
            this.createPlaceholderMesh();
            return;
        }

        const modelPath = ASSET_PATHS.getEnemyPath(this.assetKey);
        
        if (!modelPath) {
            console.warn(`[Enemy] Model not found for ${this.assetKey}, using simple mesh`);
            this.createPlaceholderMesh();
            return;
        }
        
        try {
            const result = await this.scene.assetLoader.loadModel(modelPath, { 
                name: this.name, 
                scaling: new BABYLON.Vector3(1.0, 1.0, 1.0) 
            });
            
            if (!result || !result.meshes || result.meshes.length === 0) {
                console.warn(`[Enemy] No meshes in model for ${this.assetKey}, using simple mesh`);
                this.createPlaceholderMesh();
                return;
            }
            
            this.mesh = result.meshes[0]; // Use first mesh (root)
            
            // CRITICAL: Hide collision/debug meshes that come with models
            result.meshes.forEach((mesh, index) => {
                if (!mesh) return;
                
                // Hide meshes with collision/debug names
                const name = (mesh.name || '').toLowerCase();
                if (name.includes('collision') || 
                    name.includes('collider') || 
                    name.includes('hitbox') ||
                    name.includes('debug') ||
                    name.includes('physics')) {
                    mesh.isVisible = false;
                    mesh.isPickable = false;
                    console.log(`[Enemy] Hiding debug mesh: ${mesh.name}`);
                }
                
                // Turn off bounding box display
                mesh.showBoundingBox = false;
                
                // Disable rendering of collision ellipsoids
                if (mesh.ellipsoid) {
                    mesh.showEllipsoid = false;
                }
            });
            
            // Position at spawn point (from findDrySpot)
            this.mesh.position.copyFrom(this.position);
            
            // Adjust scale if needed based on model bounds
            const bounds = this.mesh.getHierarchyBoundingVectors(true);
            const currentHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
            const targetHeight = 1.2; // Enemies are shorter
            const finalScale = targetHeight / currentHeight;
            this.mesh.scaling.scaleInPlace(finalScale);
            
            // CRITICAL: Position feet on ground
            // The position Y should already be correct from findDrySpot
            // Just adjust for model's origin point
            const offset = bounds.min.y * finalScale;
            this.mesh.position.y = this.position.y - offset;
            
            // CRITICAL SAFETY CHECK: Ensure we're NEVER below ground
            // Get actual terrain height at this position
            const world = this.scene.world || this.scene.game?.world;
            if (world && world.getHeightAt) {
                const terrainY = world.getHeightAt(this.mesh.position.x, this.mesh.position.z);
                const minY = terrainY + 1.0; // At least 1 unit above terrain
                if (this.mesh.position.y < minY) {
                    console.warn(`[Enemy] ${this.name} was at y=${this.mesh.position.y.toFixed(2)}, moving to y=${minY.toFixed(2)}`);
                    this.mesh.position.y = minY;
                }
            }
            
            // CRITICAL: Update entity position to match mesh
            // Otherwise Entity.update() will overwrite our positioning!
            this.position.copyFrom(this.mesh.position);

            this.mesh.metadata = { isEnemy: true, id: this.id };
            this.mesh.checkCollisions = true;
            this.mesh.ellipsoid = new BABYLON.Vector3(0.3, 0.6, 0.3);
            this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0.6, 0);

            // Store animations
            this.animations = result.animationGroups;
            
        } catch (e) {
            console.warn(`[Enemy] Failed to load model for ${this.assetKey}, using simple mesh:`, e);
            this.createPlaceholderMesh();
        }
    }
    
    // Fallback mesh creator for enemy - FIXED to not use assetLoader
    createPlaceholderMesh() {
        if (!this.scene) {
            console.error('[Enemy] Scene is null, cannot create placeholder mesh');
            return;
        }
        
        this.mesh = BABYLON.MeshBuilder.CreateBox(`enemy_placeholder_${this.id}`, { width: 0.5, height: 1.2, depth: 0.5 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.metadata = { isEnemy: true, id: this.id };
        
        // Create simple material - FIXED
        const material = new BABYLON.StandardMaterial(`enemy_mat_${this.id}`, this.scene);
        material.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2); // Red color for enemies
        this.mesh.material = material;
        
        // Enable shadows
        this.mesh.receiveShadows = true;
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(this.mesh);
        }
        this.mesh.checkCollisions = true;
        this.mesh.ellipsoid = new BABYLON.Vector3(0.3, 0.6, 0.3);
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0.6, 0);
    }
    
    // Enemy update - checks for player, attacks
    update(deltaTime) {
        if (!this.mesh || this.isDead) return;
        
        // Get combat system
        const combat = this.scene.combat;
        if (!combat) return;
        
        // Initialize stats if needed
        if (!this.stats) {
            this.stats = combat.getDefaultStats(this);
            this.isEnemy = true; // Mark as enemy for combat system
        }
        
        // Find player
        const player = this.scene.player;
        if (!player || !player.mesh) return;
        
        const distanceToPlayer = BABYLON.Vector3.Distance(
            this.mesh.position,
            player.mesh.position
        );
        
        // State machine
        switch (this.state) {
            case 'idle':
                // Check for player in detection range
                if (distanceToPlayer < this.detectionRange) {
                    this.enterCombat(player);
                }
                break;
                
            case 'chasing':
                // Chase player
                if (distanceToPlayer > combat.config.LEASH_RANGE) {
                    // Too far, return home
                    this.exitCombat();
                } else if (distanceToPlayer <= this.attackRange) {
                    // In range, attack!
                    this.state = 'attacking';
                } else {
                    // Move toward player
                    this.moveToward(player.mesh.position, deltaTime);
                }
                break;
                
            case 'attacking':
                // Face player
                this.faceTarget(player.mesh.position);
                
                // Check if still in range
                if (distanceToPlayer > this.attackRange) {
                    this.state = 'chasing';
                } else {
                    // Attack if cooldown ready
                    const now = Date.now();
                    if (!this.lastAttackTime || (now - this.lastAttackTime) > 2000) {
                        this.performAttack(player);
                        this.lastAttackTime = now;
                    }
                }
                break;
        }
        
        // Update position
        this.position.copyFrom(this.mesh.position);
    }
    
    enterCombat(target) {
        this.state = 'chasing';
        this.target = target;
        this.inCombat = true;
        console.log(`[Enemy] ${this.name} detected player!`);
    }
    
    exitCombat() {
        this.state = 'idle';
        this.target = null;
        this.inCombat = false;
        
        // Heal to full
        if (this.stats) {
            this.stats.currentHP = this.stats.maxHP;
        }
    }
    
    moveToward(targetPos, deltaTime) {
        if (!this.mesh) return;
        
        const direction = targetPos.subtract(this.mesh.position);
        direction.y = 0; // Don't move vertically
        direction.normalize();
        
        const speed = 3.0;
        const movement = direction.scale(speed * deltaTime);
        
        this.mesh.position.addInPlace(movement);
        
        // Face movement direction
        if (direction.length() > 0) {
            const angle = Math.atan2(direction.x, direction.z);
            this.mesh.rotation.y = angle;
        }
    }
    
    faceTarget(targetPos) {
        if (!this.mesh) return;
        
        const direction = targetPos.subtract(this.mesh.position);
        const angle = Math.atan2(direction.x, direction.z);
        this.mesh.rotation.y = angle;
    }
    
    performAttack(target) {
        const combat = this.scene.combat;
        if (!combat) return;
        
        const damage = combat.calculateDamage(this, target);
        combat.applyDamage(target, damage, this);
        
        console.log(`[Enemy] ${this.name} attacks for ${damage.amount}!`);
    }
    
    dispose() {
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
        }
        super.dispose();
    }
}

// Item Class (inherits from Entity)
class Item extends Entity {
    // ... Item implementation (omitted for brevity)
    constructor(scene, options) {
        super(scene, options.position);
        this.type = options.type; // weapon, armor, consumable, material
        this.id = options.id || BABYLON.Tools.RandomId();
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
        this.attackSpeed = options.attackSpeed || 0;
        this.defense = options.defense || 0;
        this.effect = options.effect || null;
        this.cooldown = options.cooldown || 0;

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
            case 'gold':
                this.mesh = BABYLON.MeshBuilder.CreateDisc(`item_${this.id}`, { radius: 0.2, tessellation: 32 }, this.scene);
                this.mesh.rotation.x = Math.PI / 2; // Lie flat
                break;
            default:
                this.mesh = BABYLON.MeshBuilder.CreateBox(`item_${this.id}`, { size: 0.2 }, this.scene);
                break;
        }

        this.mesh.position.copyFrom(this.position);
        this.mesh.metadata = { isItem: true, type: this.type, id: this.id, data: this };
        this.mesh.isPickable = true;
        this.mesh.checkCollisions = false; // No collision for ground items

        // Simple material based on type - FIXED
        const material = new BABYLON.StandardMaterial(`item_mat_${this.id}`, this.scene);
        // Color based on item type
        switch(this.type) {
            case 'weapon':
                material.diffuseColor = new BABYLON.Color3(0.8, 0.8, 0.2); // Yellow
                break;
            case 'armor':
                material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.8); // Blue
                break;
            case 'consumable':
                material.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.2); // Green
                break;
            case 'gold':
                material.diffuseColor = new BABYLON.Color3(1.0, 0.84, 0.0); // Gold
                break;
            default:
                material.diffuseColor = new BABYLON.Color3(0.7, 0.7, 0.7); // Gray
        }
        material.emissiveColor = material.diffuseColor.scale(0.2); // Slight glow
        this.mesh.material = material;
    }

    setupPhysics() {
        if (!this.scene.getPhysicsEngine()) return;
        
        // Use a simple sphere impostor for easy pickup/interaction
        const impostorType = this.type === 'gold' ? BABYLON.PhysicsImpostor.BoxImpostor : BABYLON.PhysicsImpostor.SphereImpostor;
        
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            impostorType,
            { mass: this.type === 'gold' ? 0.1 : 1, friction: 0.5, restitution: 0.1 },
            this.scene
        );
    }
    
    // Called when player touches the item
    collect(collector) {
        // In a real game, this would add to the collector's inventory
        console.log(`[Item] ${collector.name} collected ${this.name} (x${this.quantity})`);
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
                // Example: restore health
                // user.health = Math.min(user.maxHealth, user.health + 20);
                // this.quantity--;
                return true;
            case 'weapon':
            case 'armor':
                // user.equip(this);
                return true;
            default:
                return false;
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

// Make classes globally available in browser
if (typeof window !== 'undefined') {
    window.World = World;
    window.Entity = Entity;
    window.NPC = NPC;
    window.Enemy = Enemy;
    window.Item = Item;
    window.SimplexNoise = SimplexNoise;
}
