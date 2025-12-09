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
    this.id = Date.now() + Math.random().toString(36).substring(2, 9); // Simple unique ID
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
        this.collisionBarrier = null; 

        // Environment
        this.trees = [];
        this.rocks = [];
        this.grass = [];
        this.buildings = [];
        this.npcs = [];
        this.enemies = [];
        this.items = [];
        this.landmarks = []; 

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
        try {
            this.createLights();
            this.createSkybox();
            this.createTerrain();
            this.createWater();
            this.populateWorld();
            this.setupEventListeners();
        } catch (e) {
            console.error('[Game] World initialization failed:', e);
            throw e; 
        }

        // CRITICAL: Signal player that world is ready
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
        this.terrainMaterial.roughness = 0.8; 

        // Load realistic grass textures (Simplified inline for completeness)
        const grassPath = 'assets/textures/ground/grass/';
        const tileScale = 40; 

        try {
            // Note: In a real environment, this loading logic should be moved to the async loader.
            const colorTex = new BABYLON.Texture(grassPath + 'Grass004_2K-JPG_Color.jpg', scene);
            colorTex.uScale = tileScale; colorTex.vScale = tileScale;
            this.terrainMaterial.albedoTexture = colorTex;
            console.log('[World] ✓ Grass color texture loaded');

            const normalTex = new BABYLON.Texture(grassPath + 'Grass004_2K-JPG_NormalGL.jpg', scene);
            normalTex.uScale = tileScale; normalTex.vScale = tileScale;
            this.terrainMaterial.bumpTexture = normalTex;
            console.log('[World] ✓ Grass normal texture loaded');

            const aoTex = new BABYLON.Texture(grassPath + 'Grass004_2K-JPG_AmbientOcclusion.jpg', scene);
            aoTex.uScale = tileScale; aoTex.vScale = tileScale;
            this.terrainMaterial.ambientTexture = aoTex;
            console.log('[World] ✓ Grass AO texture loaded');

        } catch (error) {
            console.warn('[World] Failed to load grass textures, using procedural green:', error);
            this.terrainMaterial.albedoColor = new BABYLON.Color3(0.3, 0.6, 0.3);
        }

        // Assign material to terrain
        this.terrain.material = this.terrainMaterial;
        this.terrain.isVisible = true;
        this.terrain.setEnabled(true);
        this.terrain.checkCollisions = true;

        // FIX: Add solid terrain physics. Heightmap impostor is the most stable for a generated ground
        this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.terrain,
            BABYLON.PhysicsImpostor.HeightmapImpostor, // PATCHED: Fixes MeshImpostor warning
            {
                mass: 0,              // Static (immovable)
                friction: 0.9,
                restitution: 0.0
            },
            this.scene
        );

        window.gameWorld = this;
        console.log('[World] ✓ Terrain physics created and enabled');

        // COLLISION SAFETY NET - full terrain clone just below surface
        this.collisionBarrier = this.terrain.clone('terrainCollisionBarrier');
        this.collisionBarrier.material = null;
        this.collisionBarrier.isVisible = false;
        this.collisionBarrier.visibility = 0;
        this.collisionBarrier.renderingGroupId = -1;

        const BARRIER_OFFSET = -0.02;
        this.collisionBarrier.position.y = this.terrain.position.y + BARRIER_OFFSET;
        this.collisionBarrier.checkCollisions = true;
        
        // FIX: Changed from MeshImpostor to BoxImpostor for performance and to fix warning
        this.collisionBarrier.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.collisionBarrier,
            BABYLON.PhysicsImpostor.BoxImpostor, // PATCHED: Fixes MeshImpostor warning for simple flat barrier
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

        // Create noise generator
        const noise = new SimplexNoise(this.options.seed);

        // Generate height values
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];

            let height = 0;
            let amplitude = 1;
            let frequency = 0.002;

            // Base terrain (Perlin/Simplex Octaves)
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

    getTerrainHeight(x, z) {
        if (!this.terrain) return 0;
        return this.terrain.getHeightAtCoordinates(x, z);
    }
    
    // FIX: Add missing method for UI Manager
    getLandmarks() {
        // Returns the list of static world landmarks
        return this.landmarks;
    }

    // Utility to find a position not below water level
    findDrySpot(x, z, maxAttempts = 10, searchRadius = 5, waterPadding = 0.1) {
        let attempts = 0;
        let position = new BABYLON.Vector3(x, 0, z);

        while (attempts < maxAttempts) {
            position.x = x + (Math.random() - 0.5) * searchRadius * 2;
            position.z = z + (Math.random() - 0.5) * searchRadius * 2;
            position.y = this.getTerrainHeight(position.x, position.z);

            if (this.water && position.y > this.water.position.y + waterPadding) {
                return position;
            }
            attempts++;
        }
        return null;
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

        // Create water material (Simplified)
        this.waterMaterial = new BABYLON.StandardMaterial('waterMaterial', this.scene);
        this.waterMaterial.alpha = 0.7;
        this.waterMaterial.diffuseColor = new BABYLON.Color3(0.12, 0.28, 0.42);
        this.waterMaterial.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
        
        // Add reflection/refraction (Simplified/Placeholder for brevity)
        // ...

        this.water.material = this.waterMaterial;
        
        console.log(`[World] ✓ Water created at y=${this.water.position.y.toFixed(2)} (non-solid)`);
    }

    createTrees(count = 500) {
        console.log(`[World] Creating ${count} trees...`);
        const TREE_COUNT = count;
        
        if (typeof Entity === 'undefined' || typeof this.findDrySpot !== 'function') {
            console.warn('[World] Skipping tree creation: Missing dependencies.');
            return;
        }

        for (let i = 0; i < TREE_COUNT; i++) {
            // Find a random position within a safe area
            const size = this.options.size * 0.4;
            const x = (Math.random() - 0.5) * size;
            const z = (Math.random() - 0.5) * size;
            
            const drySpot = this.findDrySpot(x, z, 10, 8, 0.3);
            
            if (drySpot) {
                const root = new BABYLON.Mesh('tree_root_' + i, this.scene);
                root.position = new BABYLON.Vector3(drySpot.x, drySpot.y, drySpot.z);

                const treeEntity = new Entity(this.scene, drySpot);
                treeEntity.mesh = root;
                
                const scale = 0.5 + Math.random() * 0.8;
                
                // Trunk (Cylinder)
                const trunk = BABYLON.MeshBuilder.CreateCylinder(`tree_trunk_${i}`, {
                    height: 3 * scale, 
                    diameter: 0.3 * scale
                }, this.scene);
                trunk.position.y += (3 * scale) / 2;
                trunk.parent = root;
                
                // Canopy (Cone)
                const canopy = BABYLON.MeshBuilder.CreateCylinder(`tree_canopy_${i}`, {
                    height: 4 * scale,
                    diameterTop: 0,
                    diameterBottom: 2 * scale
                }, this.scene);
                canopy.position.y += (3 * scale) + (4 * scale) / 2 - (0.5 * scale);
                canopy.parent = root;

                // Materials
                const trunkMat = new BABYLON.StandardMaterial('trunk_mat', this.scene);
                trunkMat.diffuseColor = new BABYLON.Color3(0.5, 0.4, 0.2);
                trunk.material = trunkMat;

                const canopyMat = new BABYLON.StandardMaterial('canopy_mat', this.scene);
                canopyMat.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.1);
                canopy.material = canopyMat;
                
                // Shadows
                if (this.shadowGenerator) {
                    this.shadowGenerator.addShadowCaster(trunk);
                    this.shadowGenerator.addShadowCaster(canopy);
                }

                this.trees.push(treeEntity);
            }
        }
        
        console.log(`[World] ✓ Trees created: ${this.trees.length}`);
    };


    createBuilding(landmark) {
        console.log(`[World] Creating building: ${landmark.name}`);
        // Simplified building creation (placeholder)
        const position = this.findDrySpot(landmark.x, landmark.z, 5, 2, 0.1);
        if (position) {
            const size = 10 * (landmark.scale || 1.0);
            const height = 15 * (landmark.scale || 1.0);
            
            const box = BABYLON.MeshBuilder.CreateBox(landmark.name, {
                size: size,
                height: height
            }, this.scene);
            box.position = position.add(new BABYLON.Vector3(0, height / 2, 0));
            box.checkCollisions = true;
            if (this.shadowGenerator) {
                this.shadowGenerator.addShadowCaster(box);
            }
            this.buildings.push(new Entity(this.scene, position));
            this.buildings[this.buildings.length - 1].mesh = box;
            // Add the physical mesh to the landmark for minimap access
            this.landmarks.find(l => l.name === landmark.name).mesh = box;
        }
    }

    createTreeGrove(landmark) {
        console.log(`[World] Creating tree grove at ${landmark.name}`);
        // Stub
    }

    createRockFormation(landmark) {
        console.log(`[World] Creating rock formation: ${landmark.name}`);
        // Stub
    }

    createNPCs(count) {
        console.log(`[World] Creating ${count} NPCs...`);
        for (let i = 0; i < count; i++) {
            const type = (i % 2 === 0) ? 'guard' : 'merchant';
            const x = (Math.random() - 0.5) * 50;
            const z = (Math.random() - 0.5) * 50;
            const pos = this.findDrySpot(x, z, 5, 20, 0.1);
            if (pos) {
                this.npcs.push(new NPC(this.scene, type, pos));
            }
        }
    }

    createEnemies(count) {
        console.log(`[World] Creating ${count} enemies...`);
        for (let i = 0; i < count; i++) {
            const type = (i % 2 === 0) ? 'wolf' : 'goblin';
            const x = (Math.random() - 0.5) * 200;
            const z = (Math.random() - 0.5) * 200;
            const pos = this.findDrySpot(x, z, 5, 20, 0.1);
            if (pos) {
                this.enemies.push(new Enemy(this.scene, type, pos));
            }
        }
    }

    createItems(count) {
        console.log(`[World] Creating ${count} items...`);
        // Stub
    }

    populateWorld() {
        // Define static landmark positions for consistent world
        this.landmarks = [
            // Town Center 
            { type: 'building', name: 'Town Hall', x: 0, z: 0, scale: 1.5, position: new BABYLON.Vector3(0, 0, 0) }, 
            { type: 'building', name: 'Inn', x: 15, z: 10, scale: 1.2, position: new BABYLON.Vector3(15, 0, 10) }, 
        ];
        
        this.landmarks.forEach(landmark => {
            if (landmark.type === 'building') {
                this.createBuilding(landmark);
            } else if (landmark.type === 'tree_grove') {
                this.createTreeGrove(landmark);
            } else if (landmark.type === 'rock_formation') {
                this.createRockFormation(landmark);
            }
        });

        // Trees
        this.createTrees(500); // This call is now safe
        
        // Finalize world objects
        this.createNPCs(5);
        this.createEnemies(10);
        this.createItems(20);
    }
    
    setupEventListeners() {
        // Simple on-update loop for the world (e.g., time, weather)
        this.scene.onBeforeRenderObservable.add(() => {
            this.time += this.scene.getEngine().getDeltaTime() / 1000 / 60 / 60; // Increment time
            if (this.time >= 24) {
                this.time -= 24;
                this.day++;
            }
        });
    }
}

// ==================== NPC Class ====================
class NPC extends Entity {
    constructor(scene, type, position) {
        super(scene, position);
        this.type = type;
        this.name = type.charAt(0).toUpperCase() + type.slice(1);
        // Uses full manifest path
        this.assetKey = `CHARACTERS/NPCS/${type}`; 
        this.loadAssetModel(this.assetKey, 1.0);
        this.isNPC = true;
    }

    async loadAssetModel(assetKey, requestedScale) {
        try {
            const model = await this.scene.assetLoader.loadModel(assetKey, { scaling: new BABYLON.Vector3(requestedScale, requestedScale, requestedScale) });
            if (model && model.root) {
                // Remove placeholder and set the actual model
                if (this.mesh) this.mesh.dispose();
                this.mesh = model.root;
                this.mesh.position = this.position.clone();
                this.mesh.metadata = { isNPC: true, type: this.type };
                this.mesh.isPickable = true;

                this.mesh.scaling.scaleInPlace(model.scale || 1.0);
                this.snapToGround();
                
                if (this.scene.shadowGenerator) {
                    this.scene.shadowGenerator.addShadowCaster(this.mesh);
                }

                console.log(`[NPC] ✓ Loaded model for ${this.name}`);
            } else {
                console.warn(`[NPC] AssetLoader or manifest entry for '${this.assetKey}' not found. Using fallback mesh.`);
                // Fallback (e.g., procedural box/sphere)
                if (this.mesh) this.mesh.dispose(); // Dispose of any previous fallback
                this.mesh = BABYLON.MeshBuilder.CreateBox(this.name + '_fallback', { size: 1 }, this.scene);
                this.mesh.position = this.position.clone();
                this.snapToGround();
            }
        } catch (e) {
            console.warn(`[NPC] Failed to load model for ${this.name}`, e);
            // Fallback mesh creation on error
            if (this.mesh) this.mesh.dispose(); 
            this.mesh = BABYLON.MeshBuilder.CreateBox(this.name + '_fallback', { size: 1 }, this.scene);
            this.mesh.position = this.position.clone();
            this.snapToGround();
        }
    }

    snapToGround() {
        if (!this.mesh) return;
        const height = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
        this.mesh.position.y = height;
        this.position.y = height;
    }
}

// ==================== Enemy Class ====================
class Enemy extends Entity {
    constructor(scene, type, position) {
        super(scene, position);
        this.type = type;
        this.name = type.charAt(0).toUpperCase() + type.slice(1);
        // FIX: Use the full manifest path for consistency with NPC and AssetLoader
        this.assetKey = `CHARACTERS/ENEMIES/${type}`; 
        // Use a default scale appropriate for the model (wolf scale 0.02, goblin scale 1.0)
        this.loadAssetModel(this.assetKey, (type === 'wolf' ? 0.02 : 1.0)); 
        this.isEnemy = true;
        this.health = 100;
        this.target = null;
    }

    async loadAssetModel(assetKey, requestedScale) {
        return new Promise((resolve, reject) => {
            if (!this.scene.assetLoader) {
                console.warn('[Enemy] AssetLoader not available, skipping model load.');
                return resolve(null);
            }

            this.scene.assetLoader.loadModel(assetKey, { 
                // The AssetLoader's _cloneLoadedModel will apply this
                scaling: new BABYLON.Vector3(requestedScale, requestedScale, requestedScale) 
            }).then(model => { 
                if (!model || !model.root) { 
                    console.warn(`[Enemy] Failed to load model for ${this.assetKey}. Falling back to procedural mesh.`); 
                    // Fallback to procedural mesh
                    if (this.mesh) this.mesh.dispose();
                    this.mesh = BABYLON.MeshBuilder.CreateBox(this.name + '_fallback', { size: 1 }, this.scene);
                    this.mesh.position = this.position.clone();
                    this.snapToGround();
                    return resolve(null);
                } 

                if (this.mesh) this.mesh.dispose();
                this.mesh = model.root; 
                this.mesh.position = this.position.clone(); 
                this.mesh.metadata = { isEnemy: true, type: this.type };
                this.mesh.isPickable = true;
                
                // Normalization happens inside AssetLoader but re-snapping is necessary
                this.snapToGround(); 
                
                // Shadows
                if (this.scene.shadowGenerator) {
                    // FIX: Only set receiveShadows on non-instanced meshes (source meshes)
                    // The loader returns the source meshes which should receive shadows from other objects
                    if (model.meshes) {
                        model.meshes.forEach(m => {
                            if (!m.isAnInstance) {
                                m.receiveShadows = true; 
                            }
                        });
                    }
                    
                    // Add the root mesh as a shadow caster
                    this.scene.shadowGenerator.addShadowCaster(this.mesh);
                } 

                console.log(`[Enemy] ✓ Loaded asset model '${this.assetKey}'`); 
                resolve(model);
            }).catch(err => {
                console.error(`[Enemy] Failed to load model ${assetKey}:`, err);
                // Fallback to procedural mesh on error and reject the promise to prevent silent failures
                if (this.mesh) this.mesh.dispose();
                this.mesh = BABYLON.MeshBuilder.CreateBox(this.name + '_fallback', { size: 1 }, this.scene);
                this.mesh.position = this.position.clone();
                this.snapToGround();
                reject(err);
            });
        });
    }

    snapToGround() {
        if (!this.mesh) return;
        const height = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
        this.mesh.position.y = height;
        this.position.y = height;
    }
}

// ==================== Item Class ====================
class Item extends Entity {
    constructor(scene, data) {
        super(scene, data.position);
        this.id = data.id || this.id;
        this.type = data.type || 'generic';
        this.name = data.name || 'Generic Item';
        this.description = data.description || '';
        this.icon = data.icon || 'default.png';
        this.value = data.value || 1;
        this.quantity = data.quantity || 1;
        this.stackable = data.stackable || true;

        // Visuals (Placeholder)
        this.mesh = BABYLON.MeshBuilder.CreateSphere(this.name, { diameter: 0.5 }, this.scene);
        this.mesh.material = new BABYLON.StandardMaterial('itemMat', this.scene);
        this.mesh.material.diffuseColor = new BABYLON.Color3(Math.random(), Math.random(), Math.random());
        this.mesh.position.y += 0.25;
        this.mesh.checkCollisions = true;
        this.mesh.isPickable = true;
        this.mesh.metadata = { isItem: true, itemData: this };

        this.snapToGround();
    }

    snapToGround() {
        const height = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
        this.mesh.position.y = height + 0.25; // Base height + radius
        this.position.y = height + 0.25;
    }
    
    // Serialization methods (omitted for brevity)
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
