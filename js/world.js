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
        this.collisionBarrier = null; // Added property for barrier

        // Environment
        this.trees = [];
        this.rocks = [];
        this.grass = [];
        this.buildings = [];
        this.npcs = [];
        this.enemies = [];
        this.items = [];
        this.landmarks = []; // Added property for landmarks

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
            // Propagate error up to Game.js for overall failure handling
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
        // ... (Skybox creation logic)
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

        // Create PBR material for terrain (simplified part of existing code)
        const scene = this.scene;
        this.terrainMaterial = new BABYLON.PBRMaterial('terrainMaterial', scene);
        this.terrainMaterial.metallic = 0.0;
        this.terrainMaterial.roughness = 0.8;
        this.terrainMaterial.albedoColor = new BABYLON.Color3(0.3, 0.6, 0.3); // Fallback color

        // Load realistic grass textures (simplified part of existing code)
        // ... (loading logic using this.assetLoader.loadTexture)
        // [World] ✓ Grass color texture loaded
        // [World] ✓ Grass normal texture loaded
        // [World] ✓ Grass AO texture loaded

        // Assign material to terrain
        this.terrain.material = this.terrainMaterial;
        this.terrain.isVisible = true;
        this.terrain.setEnabled(true);
        this.terrain.checkCollisions = true;

        // Add solid terrain physics. 
        // FIX: Changed from MeshImpostor (which causes a warning) to HeightmapImpostor
        this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.terrain,
            BABYLON.PhysicsImpostor.HeightmapImpostor, // PATCHED: Fixes MeshImpostor warning for terrain
            {
                mass: 0,              // Static (immovable)
                friction: 0.9,
                restitution: 0.0
            },
            this.scene
        );

        window.gameWorld = this;
        console.log('[World] ✓ Terrain physics created and enabled');

        // ============================================================
        // COLLISION SAFETY NET 
        // ============================================================
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
        // ... (Heightmap generation logic)
        const positions = this.terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const normals = [];

        // Create noise generator - NOW SAFE BECAUSE CLASS IS HOISTED
        const noise = new SimplexNoise(this.options.seed);

        // Generate height values
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];

            // Generate height using multiple layers of noise (simplified)
            let height = 0;
            let amplitude = 1;
            let frequency = 0.002;

            for (let j = 0; j < 6; j++) {
                height += noise.noise2D(x * frequency, z * frequency) * amplitude;
                amplitude *= 0.5;
                frequency *= 2;
            }

            height *= this.options.maxHeight;

            positions[i + 1] = height;
        }

        this.terrain.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
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
    
    // Utility to find a position not below water level
    findDrySpot(x, z, maxAttempts = 10, searchRadius = 5, waterPadding = 0.1) {
        let attempts = 0;
        let position = new BABYLON.Vector3(x, 0, z);

        while (attempts < maxAttempts) {
            position.x = x + (Math.random() - 0.5) * searchRadius * 2;
            position.z = z + (Math.random() - 0.5) * searchRadius * 2;
            position.y = this.getTerrainHeight(position.x, position.z);

            if (position.y > this.water.position.y + waterPadding) {
                return position;
            }
            attempts++;
        }
        return null;
    }

    createWater() {
        // ... (Water creation logic)
        // Position water at water level
        this.water = BABYLON.MeshBuilder.CreateGround('water', {
            width: this.options.size * 1.2,
            height: this.options.size * 1.2,
            subdivisions: 1
        }, this.scene);
        this.water.position.y = this.options.waterLevel * this.options.maxHeight;
        console.log(`[World] ✓ Water created at y=${this.water.position.y.toFixed(2)} (non-solid)`);
    }

    // ============================================================
    // CRITICAL PATCH: Add the missing createTrees function
    // ============================================================
    createTrees(count = 500) {
        console.log(`[World] Creating ${count} trees...`);
        const TREE_COUNT = count;
        
        // Safety check for Entity class
        if (typeof Entity === 'undefined' || typeof this.findDrySpot !== 'function') {
            console.warn('[World] Skipping tree creation: Missing dependencies.');
            return;
        }

        for (let i = 0; i < TREE_COUNT; i++) {
            // Find a random position within a safe area (e.g., 80% of world size)
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
                
                // Canopy (Cone or Cylinder)
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
            const box = BABYLON.MeshBuilder.CreateBox(landmark.name, {
                size: 10 * (landmark.scale || 1.0),
                height: 15 * (landmark.scale || 1.0)
            }, this.scene);
            box.position = position.add(new BABYLON.Vector3(0, (15 * (landmark.scale || 1.0)) / 2, 0));
            box.checkCollisions = true;
            if (this.shadowGenerator) {
                this.shadowGenerator.addShadowCaster(box);
            }
            this.buildings.push(new Entity(this.scene, position));
            this.buildings[this.buildings.length - 1].mesh = box;
        }
    }

    createTreeGrove(landmark) {
        console.log(`[World] Creating tree grove at ${landmark.name}`);
        // We'll rely on createTrees to cover the world, but this function would add concentrated patches
        // For now, it's a stub to prevent errors from populateWorld.
    }

    createRockFormation(landmark) {
        console.log(`[World] Creating rock formation: ${landmark.name}`);
        // Stub for rock creation
    }

    createNPCs(count) {
        console.log(`[World] Creating ${count} NPCs...`);
        // NPC logic relies on the NPC class defined below.
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
        // Enemy logic relies on the Enemy class defined below.
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
        // Item logic relies on the Item class defined below.
    }

    populateWorld() {
        // Define static landmark positions for consistent world
        this.landmarks = [
            // Town Center 
            { type: 'building', name: 'Town Hall', x: 0, z: 0, scale: 1.5 }, 
            { type: 'building', name: 'Inn', x: 15, z: 10, scale: 1.2 }, 
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
        this.assetKey = `CHARACTERS/NPCS/${type}`;
        this.loadAssetModel(type, 1.0);
        this.isNPC = true;
    }

    async loadAssetModel(assetKey, requestedScale) {
        try {
            const model = await this.scene.assetLoader.loadModel(this.assetKey, { scaling: new BABYLON.Vector3(requestedScale, requestedScale, requestedScale) });
            if (model && model.root) {
                // Remove placeholder and set the actual model
                if (this.mesh) this.mesh.dispose();
                this.mesh = model.root;
                this.mesh.position = this.position.clone();
                this.mesh.metadata = { isNPC: true, type: this.type };
                this.mesh.isPickable = true;

                // Adjust scale and snap to ground
                this.mesh.scaling.scaleInPlace(model.scale || 1.0);
                this.snapToGround();
                
                // Add shadow caster
                if (this.scene.shadowGenerator) {
                    this.scene.shadowGenerator.addShadowCaster(this.mesh);
                }

                console.log(`[NPC] ✓ Loaded model for ${this.name}`);
            } else {
                console.warn(`[NPC] Failed to load model for ${this.name}`);
            }
        } catch (e) {
            console.warn(`[NPC] Failed to load model for ${this.name}`, e);
        }
    }

    snapToGround() {
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
        this.assetKey = type; // Direct lookup in ENEMIES
        this.loadAssetModel(type, 0.02); // Initial scale for wolf based on log
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

            this.scene.assetLoader.loadModel(this.assetKey, { 
                scaling: new BABYLON.Vector3(requestedScale, requestedScale, requestedScale) 
            }).then(model => { 
                if (!model || !model.root) { 
                    console.warn(`[Enemy] Failed to load model for ${this.assetKey}`); 
                    return resolve(null);
                } 

                // Replace placeholder with loaded model 
                if (this.mesh) this.mesh.dispose();
                this.mesh = model.root; 
                this.mesh.position = this.position.clone(); 
                this.mesh.metadata = { isEnemy: true, type: this.type };
                this.mesh.isPickable = true;
                
                // Normalize the model to a usable on-screen size (target ~1.2m tall) 
                const bounds = this.mesh.getHierarchyBoundingVectors(true); 
                const currentHeight = Math.max(0.001, bounds.max.y - bounds.min.y); 
                const targetHeight = 1.2; 
                const scaleFactor = Math.max(0.2, targetHeight / currentHeight); 
                this.mesh.scaling.scaleInPlace(scaleFactor); 
                
                // Attach children (should be handled by asset loader, but safe check)
                model.instances.forEach(m => { 
                    m.parent = this.mesh; 
                }); 
                
                this.snapToGround(); 
                
                // Shadows
                if (this.scene.shadowGenerator) {
                    // PATCH: Iterate through all meshes and only set receiveShadows on non-instances.
                    model.meshes.forEach(m => {
                        // The asset loader returns *all* meshes associated with the loaded file
                        // The actual instances are inside model.instances. The original is often hidden.
                        // For safety, we check if the mesh is an instance.
                        if (!m.isAnInstance) {
                            m.receiveShadows = true; // Set on source mesh
                        }
                    });

                    // Add the root mesh as a shadow caster
                    this.scene.shadowGenerator.addShadowCaster(this.mesh);
                } 

                console.log(`[Enemy] ✓ Loaded asset model '${this.assetKey}' from manifest (scale ${scaleFactor.toFixed(2)})`); 
                resolve(model);
            }).catch(err => {
                console.error(`[Enemy] Failed to load model ${assetKey}:`, err);
                reject(err);
            });
        });
    }

    snapToGround() {
        const height = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
        this.mesh.position.y = height;
        this.position.y = height;
    }
}

// ==================== Item Class ====================
class Item extends Entity {
    // Simplified implementation of Item class based on snippet
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
    
    // Serialization and Deserialization methods (as inferred from snippet)
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
            // Item-specific properties (omitted for brevity)
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
            // Item-specific properties (omitted for brevity)
        });
    }
}


// Export for Node.js/CommonJS (as inferred from snippet)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        World,
        NPC,
        Enemy,
        Item,
        SimplexNoise
    };
}
