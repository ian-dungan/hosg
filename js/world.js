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


// NPC Class
class NPC extends Entity {
    constructor(scene, options = {}) {
        super(scene, options.position);
        this.id = options.id || BABYLON.Tools.RandomId();
        this.name = options.name || "NPC";
        this.type = options.type || "merchant"; // merchant, guard, quest_giver
        this.dialogue = options.dialogue || ["Hello, adventurer.", "The world is dangerous."];
        this.isLandmark = options.isLandmark !== false; // NPCs are often landmarks

        this.init(options.model || this.type);
    }

    async init(modelName) {
        if (this.isLandmark) {
            this.scene.world.landmarks.push(this);
        }

        try {
            const assetInfo = ASSET_MANIFEST.CHARACTERS.NPCS[this.type];
            if (!assetInfo) {
                console.warn(`[NPC] Asset manifest entry not found for: ${modelName}`);
                return;
            }

            const model = await this.scene.assetLoader.loadModel(assetInfo.model);

            if (model) {
                this.mesh = model;
                this.mesh.name = this.name;
                this.mesh.position.copyFrom(this.position);
                this.mesh.scaling.setAll(assetInfo.scale || 1.0);
                
                // Add metadata for interaction
                this.mesh.metadata = { 
                    entityType: 'NPC', 
                    id: this.id, 
                    name: this.name, 
                    isNPC: true 
                };
                
                // Set the correct position
                if (assetInfo.offset) {
                    this.mesh.position.addInPlace(new BABYLON.Vector3(assetInfo.offset.x, assetInfo.offset.y, assetInfo.offset.z));
                }

                // Make the NPC cast shadows
                if (this.scene.world.shadowGenerator) {
                    this.scene.world.shadowGenerator.addShadowCaster(this.mesh);
                }
            }
        } catch (e) {
            console.warn(`[NPC] Failed to load model for ${this.name}:`, e);
        }
    }

    interact() {
        // Simple interaction logic (e.g., open a shop, start a quest)
        const dialogue = this.dialogue[Math.floor(Math.random() * this.dialogue.length)];
        console.log(`[NPC] ${this.name}: ${dialogue}`);
        if (this.scene.game?.ui) {
            this.scene.game.ui.showMessage(`[${this.name}] ${dialogue}`, 3000, "dialogue");
        }
    }
}

// Enemy Class
class Enemy extends Entity {
    constructor(scene, options = {}) {
        super(scene, options.position);
        this.id = options.id || BABYLON.Tools.RandomId();
        this.name = options.name || "Enemy";
        this.type = options.type || "wolf"; // wolf, goblin, orc, etc.
        this.health = options.health || 50;
        this.maxHealth = this.health;
        this.attackDamage = options.attackDamage || 5;
        this.moveSpeed = options.moveSpeed || 3.0;

        this._target = null; // The player or another enemy
        this._isDead = false;

        this.init(options.model || this.type);
    }

    async init(modelName) {
        try {
            const assetInfo = ASSET_MANIFEST.CHARACTERS.ENEMIES[this.type];
            if (!assetInfo) {
                console.warn(`[Enemy] Asset manifest entry not found for: ${modelName}`);
                return;
            }

            const model = await this.scene.assetLoader.loadModel(assetInfo.model);

            if (model) {
                this.mesh = model;
                this.mesh.name = this.name;
                this.mesh.position.copyFrom(this.position);
                this.mesh.scaling.setAll(assetInfo.scale || 1.0);
                
                // Add metadata for interaction
                this.mesh.metadata = { 
                    entityType: 'Enemy', 
                    id: this.id, 
                    name: this.name, 
                    isEnemy: true,
                    health: this.health
                };
                
                // Set the correct position
                if (assetInfo.offset) {
                    this.mesh.position.addInPlace(new BABYLON.Vector3(assetInfo.offset.x, assetInfo.offset.y, assetInfo.offset.z));
                }

                // Make the Enemy cast shadows
                if (this.scene.world.shadowGenerator) {
                    this.scene.world.shadowGenerator.addShadowCaster(this.mesh);
                }
            } else {
                console.warn(`[Enemy] Failed to load model for ${this.type}`);
            }
        } catch (e) {
            console.warn(`[Enemy] Failed to load model for ${this.type}:`, e);
        }
    }

    takeDamage(amount) {
        if (this._isDead) return;
        this.health -= amount;

        if (this.health <= 0) {
            this.health = 0;
            this.die();
        } else {
            // Flash red or play hit animation
            if (this.mesh && this.scene.game?.ui) {
                this.scene.game.ui.showFloatingText(
                    "-" + amount, 
                    this.mesh.position, 
                    "enemyDamage"
                );
            }
        }
    }

    die() {
        this._isDead = true;
        console.log(`[Enemy] ${this.name} has died.`);
        // Play death animation/effect
        // Drop loot
        this.dispose();
    }

    update(deltaTime) {
        if (this._isDead || !this.mesh) return;

        // Basic AI: Move towards target (e.g., player)
        if (this._target) {
            const direction = this._target.position.subtract(this.mesh.position).normalize();
            const distance = BABYLON.Vector3.Distance(this._target.position, this.mesh.position);
            
            if (distance > 2) {
                // Move
                this.mesh.position.addInPlace(direction.scale(this.moveSpeed * deltaTime));
            } else {
                // Attack
                // TODO: Implement attack logic
            }

            // Simple rotation
            const angle = Math.atan2(direction.x, direction.z);
            this.mesh.rotation.y = angle;
        }

        super.update(deltaTime);
    }
}

// Item Class
class Item extends Entity {
    constructor(scene, options = {}) {
        super(scene, options.position);
        this.id = options.id || BABYLON.Tools.RandomId();
        this.type = options.type || "consumable"; // weapon, armor, consumable, material
        this.name = options.name || "Item";
        this.description = options.description || "A mysterious object.";
        this.icon = options.icon || "default_item.png";
        this.value = options.value || 0; // gold value
        this.quantity = options.quantity || 1;
        this.stackable = options.stackable !== false;

        // Item-specific properties (for equipment)
        this.equipSlot = options.equipSlot || null; // head, chest, weapon_1h, etc.
        this.stats = options.stats || {};
        this.damage = options.damage || 0;
        this.attackSpeed = options.attackSpeed || 1.0;
        this.defense = options.defense || 0;
        this.effect = options.effect || null;
        this.cooldown = options.cooldown || 0;

        this.init(options.model || "default_item.glb");
    }

    async init(modelPath) {
        try {
            // Items are not in the main asset manifest, they are usually loaded on demand
            const model = await this.scene.assetLoader.loadModel(modelPath);

            if (model) {
                this.mesh = model;
                this.mesh.name = this.name;
                this.mesh.position.copyFrom(this.position);
                this.mesh.scaling.setAll(0.5); // Default size for small items
                
                // Add metadata for interaction
                this.mesh.metadata = { 
                    entityType: 'Item', 
                    id: this.id, 
                    name: this.name, 
                    isItem: true 
                };
                
                // Add a simple hover effect for visibility
                this.mesh.isPickable = true;
                this.mesh.actionManager = new BABYLON.ActionManager(this.scene);
                this.mesh.actionManager.registerAction(
                    new BABYLON.ExecuteCodeAction(
                        BABYLON.ActionManager.OnPickTrigger, 
                        () => {
                            this.scene.game?.player.pickUpItem(this);
                        }
                    )
                );
            }
        } catch (e) {
            console.warn(`[Item] Failed to load model for ${this.name}:`, e);
            // Fallback: Create a simple sphere
            this.mesh = BABYLON.MeshBuilder.CreateSphere(this.name, { diameter: 0.5 }, this.scene);
            this.mesh.position.copyFrom(this.position);
            this.mesh.material = this.scene.assetLoader.createProceduralMaterial('item');
            this.mesh.metadata = { entityType: 'Item', id: this.id, name: this.name, isItem: true };
            this.mesh.isPickable = true;
        }
    }

    // Called by the player when they interact with the item
    onPickedUp() {
        // Broadcast event to network
        // Remove from world entities list
        this.dispose();
    }

    serialize() {
        return {
            id: this.id,
            type: this.type,
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
        this.terrainData = null; // Stored heightmap data
        this.collisionBarrier = null;
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

        // UI/Game Integration: Landmaks needed for minimap
        this.landmarks = []; // <-- Initialized landmarks array for UIManager

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
        console.log('[World] Initializing...');

        // 1. Core Environment
        this.createLights();
        this.createSkybox();
        this.createWater();

        // 2. Terrain & Physics
        this.createTerrain();

        // 3. Assets & Population (Awaited to ensure full world state before signalling player)
        await this.loadAssets();
        this.populateWorld();

        // 4. Final Setup
        this.setupEventListeners();

        // CRITICAL: Signal player that world is ready
        // Wait a bit to ensure physics is fully stabilized
        setTimeout(() => {
            console.log('[World] ✅ World fully initialized, signaling player...');
            const player = this.scene.player || this.scene.game?.player;
            if (player && typeof player.startAfterWorldReady === 'function') {
                player.startAfterWorldReady();
            } else {
                // If player doesn't have the explicit method, we assume it's checking the world ready state
                // This is fine for now, but the explicit call is cleaner
                console.warn('[World] Player not found or startAfterWorldReady not available');
            }
        }, 500); // 500ms delay to ensure physics is stable
    }

    // PATCHED: Method required by UIManager for minimap data
    getLandmarks() {
        // Filter landmarks to ensure they are the correct entity type if necessary
        return this.landmarks.filter(l => l.isLandmark !== false);
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
        this.shadowGenerator.get={
            // Set bias and normal bias to reduce acne on the terrain
            bias: 0.005,
            normalBias: 0.02
        };

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

        // Textures are loaded in loadAssets, but apply material now
        this.terrain.material = this.terrainMaterial;
        
        // Make the terrain receive shadows
        this.terrain.receiveShadows = true;

        // Apply physics impostor
        if (this.scene.getPhysicsEngine()) {
            // Using MeshImpostor for terrain is inefficient for complex collision, 
            // but is the typical method for static ground geometry in Cannon.js.
            // Note: Console output warns 'MeshImpostor only collides against spheres.'
            this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.terrain, 
                BABYLON.PhysicsImpostor.MeshImpostor, 
                { mass: 0, restitution: 0.1, friction: 0.8 }, 
                this.scene
            );
            console.log('[World] ✓ Terrain physics created and enabled');
        }

        // Collision Barrier (invisible, cloned ground mesh used for raycasting/collision checks)
        // This is necessary if the main terrain mesh is used for ground/visuals but not reliable for player capsule/raycast checks
        this.collisionBarrier = this.terrain.clone('collisionBarrier');
        this.collisionBarrier.position.y -= 0.02; // Offset slightly below ground
        this.collisionBarrier.isVisible = false;
        this.collisionBarrier.isPickable = false;
        this.collisionBarrier.checkCollisions = true; // For built-in Babylon collision system (if used)

        if (this.scene.getPhysicsEngine() && this.collisionBarrier) {
            this.collisionBarrier.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.collisionBarrier, 
                BABYLON.PhysicsImpostor.MeshImpostor, 
                { mass: 0, restitution: 0.1, friction: 0.8 }, 
                this.scene
            );
        }
        console.log('[World] ✓ Collision barrier cloned from terrain and offset -0.02y');
    }

    generateHeightmap() {
        const size = this.options.size;
        const segments = this.options.segments;
        const maxHeight = this.options.maxHeight;
        const noise = new SimplexNoise(this.options.seed);

        const positions = this.terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const uvs = this.terrain.getVerticesData(BABYLON.VertexBuffer.UVKind);

        // Calculate steps for iteration
        const step = size / segments;

        // Store heights in a 2D array for fast lookup
        this.terrainData = new Array(segments + 1).fill(0).map(() => new Array(segments + 1).fill(0));

        // Iterate through all vertices
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];

            // Calculate normalized coordinates for noise
            const nx = x / size;
            const nz = z / size;

            // Generate noise
            let y = 0;
            // Base layer (large scale features)
            y += noise.noise2D(nx * 0.5, nz * 0.5) * 0.6;
            // Mid layer (hills and valleys)
            y += noise.noise2D(nx * 2, nz * 2) * 0.25;
            // Detail layer (small bumps and roughness)
            y += noise.noise2D(nx * 8, nz * 8) * 0.1;

            // Apply scaling and set minimum height (e.g., above water level)
            y = (y + 1) / 2; // Normalize to 0-1
            y = y * maxHeight;
            
            // Flatten area near the center (spawn point)
            const distSq = x * x + z * z;
            const flattenRadius = 100;
            if (distSq < flattenRadius * flattenRadius) {
                const smoothFactor = distSq / (flattenRadius * flattenRadius);
                const flatHeight = 3.5; // Target flat height
                y = this.lerp(smoothFactor, flatHeight, y);
            }

            positions[i + 1] = y;

            // Store height for lookup
            const ix = Math.round((x + size / 2) / step);
            const iz = Math.round((z + size / 2) / step);
            if (ix >= 0 && ix <= segments && iz >= 0 && iz <= segments) {
                this.terrainData[ix][iz] = y;
            }
        }

        this.terrain.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        this.terrain.createNormals(true); // Recalculate normals

        console.log('[World] ✓ Terrain heightmap generated');
    }

    // Utility function to interpolate (linear interpolation)
    lerp(a, b, t) {
        return a + (b - a) * t;
    }

    // Get terrain height at world coordinates (x, z)
    getTerrainHeight(x, z) {
        if (!this.terrainData || !this.terrain) return 0;

        const size = this.options.size;
        const segments = this.options.segments;
        const step = size / segments;

        // Convert world coords to grid indices
        const halfSize = size / 2;
        let ix = Math.floor((x + halfSize) / step);
        let iz = Math.floor((z + halfSize) / step);

        // Clamp indices
        ix = Math.max(0, Math.min(segments, ix));
        iz = Math.max(0, Math.min(segments, iz));

        // Note: Simple nearest neighbor lookup. For better results, use bilinear interpolation.
        return this.terrainData[ix][iz] || 0;
    }

    createWater() {
        const waterMesh = BABYLON.MeshBuilder.CreateGround("waterMesh", {
            width: this.options.size,
            height: this.options.size,
            subdivisions: 10
        }, this.scene);
        waterMesh.position.y = this.options.waterLevel;
        waterMesh.isPickable = false;

        this.waterMaterial = new BABYLON.WaterMaterial("waterMaterial", this.scene, new BABYLON.Vector2(512, 512));
        this.waterMaterial.backFaceCulling = true;
        this.waterMaterial.windForce = 0;
        this.waterMaterial.waveHeight = 0.05;
        this.waterMaterial.bumpHeight = 0.5;
        this.waterMaterial.waveLength = 0.1;
        this.waterMaterial.colorBlendFactor = 0.2;
        this.waterMaterial.waterColor = new BABYLON.Color3(0.0, 0.3, 0.7);
        this.waterMaterial.fogColor = new BABYLON.Color3(0.0, 0.3, 0.7);
        this.waterMaterial.windDirection = new BABYLON.Vector2(1, 1);

        // Add meshes to be reflected and refracted
        this.waterMaterial.addToRenderList(this.skybox);
        if (this.terrain) {
            this.waterMaterial.addToRenderList(this.terrain);
        }

        waterMesh.material = this.waterMaterial;
        this.water = waterMesh;

        console.log('[World] ✓ Water plane created');
    }

    async loadAssets() {
        console.log('[World] 📦 Starting asset loading...');

        // 1. Load Terrain Textures (Handles 404 errors by trying to load, and then using procedural fallback)
        await this.loadTerrainAssets();

        // 2. Load Environment Assets (Trees, Rocks, etc.)
        await this.loadEnvironmentAssets();

        // 3. Load Characters/Entities (NPCs, Enemies) - only loading the GLTF is enough, entities are created in populateWorld
        // The manifest already lists required models, so the AssetLoader handles loading them into cache.

        console.log('[World] ✅ All world assets loaded');
    }

    async loadTerrainAssets() {
        if (!this.assetLoader) {
            console.warn('[World] AssetLoader not available for terrain assets.');
            return;
        }

        const TEXTURE_PATHS = [
            'textures/terrain/grass_diffuse.jpg', // Missing texture in logs (404)
            'textures/terrain/grass_normal.jpg',  // Missing texture in logs (404)
            'textures/terrain/grass_ao.jpg'       // Missing texture in logs (404)
        ];
        
        console.log('[World] Attempting to load grass textures...');
        
        let loadedDiffuse = false;
        let loadedNormal = false;
        let loadedAO = false;

        // Load Diffuse/Color
        try {
            const diffuse = await this.assetLoader.loadTexture(TEXTURE_PATHS[0]);
            this.terrainMaterial.albedoTexture = diffuse;
            console.log('[World] ✓ Grass diffuse texture loaded');
            loadedDiffuse = true;
        } catch (e) {
            console.warn('[World] ✗ Failed to load diffuse texture, using procedural color.');
            this.terrainMaterial.albedoColor = new BABYLON.Color3(0.3, 0.5, 0.2); // Fallback to a procedural green
        }

        // Load Normal map
        try {
            const normal = await this.assetLoader.loadTexture(TEXTURE_PATHS[1]);
            this.terrainMaterial.bumpTexture = normal;
            console.log('[World] ✓ Grass normal texture loaded');
            loadedNormal = true;
        } catch (e) {
            console.warn('[World] ✗ Failed to load normal texture, no bump map applied.');
        }

        // Load AO map
        try {
            const ao = await this.assetLoader.loadTexture(TEXTURE_PATHS[2]);
            this.terrainMaterial.ambientTexture = ao;
            this.terrainMaterial.ambientTextureStrength = 1.0;
            console.log('[World] ✓ Grass AO texture loaded');
            loadedAO = true;
        } catch (e) {
            console.warn('[World] ✗ Failed to load AO texture, no ambient occlusion applied.');
        }

        // Water Bump Texture
        try {
            const waterBump = await this.assetLoader.loadTexture('textures/water/water_bump.png');
            if (this.waterMaterial) {
                this.waterMaterial.bumpTexture = waterBump;
                console.log('[World] ✓ Water bump texture loaded');
            }
        } catch (e) {
            console.warn('[World] ✗ Failed to load water bump texture.');
        }
    }
    
    async loadEnvironmentAssets() {
        // Load tree models, rock models, etc. from manifest into cache
        // The actual instantiation happens in populateWorld
        // Example:
        // await this.assetLoader.loadModel('environment/pine_tree.glb');
        // await this.assetLoader.loadModel('environment/rock_large.glb');
    }

    populateWorld() {
        const size = this.options.size;
        const halfSize = size / 2;

        // Reset entities
        this.npcs = [];
        this.enemies = [];
        this.landmarks = []; // Resetting for the minimap

        // 1. Create Landmarks (Points of Interest for minimap/quests)
        const landmarkPositions = [
            { x: 0, z: 0, name: "Spawn Camp", type: "camp" },
            { x: 150, z: 150, name: "Merchant's Hut", type: "building" },
            { x: -200, z: -100, name: "Wolf Den", type: "cave" },
            { x: 50, z: -300, name: "River Crossing", type: "crossing" },
            { x: -100, z: 250, name: "The Old Guard Tower", type: "building" },
            { x: 300, z: 50, name: "East Forest Edge", type: "tree_grove" },
            { x: -300, z: -300, name: "Goblin Outpost", type: "fort" },
            { x: 100, z: -100, name: "Small Pond", type: "water" },
            { x: -50, z: 50, name: "Stone Circle", type: "ruin" },
            { x: 250, z: 250, name: "Hidden Treasure", type: "treasure" }
        ];

        for (const pos of landmarkPositions) {
            const y = this.getTerrainHeight(pos.x, pos.z);
            this.landmarks.push({
                position: new BABYLON.Vector3(pos.x, y, pos.z),
                name: pos.name,
                type: pos.type,
                isLandmark: true
            });
        }

        // 2. Create NPCs
        this.createNPCs();

        // 3. Create Enemies
        this.createEnemies();

        // 4. Create Environment (Trees/Rocks)
        this.createEnvironment();

        console.log(`[World] ✓ Populated world with ${this.landmarks.length} landmarks and various entities`);
    }

    createNPCs() {
        // Create a few merchants near the main spawn
        const npcData = [
            { type: 'merchant', position: { x: 150, z: 150 }, name: "Alchemist Al" },
            { type: 'guard', position: { x: 140, z: 160 }, name: "Guard Bob" },
            { type: 'merchant', position: { x: -50, z: -50 }, name: "Traveler Trader" },
            { type: 'guard', position: { x: -40, z: -60 }, name: "Guard Charlie" },
            { type: 'merchant', position: { x: 20, z: 20 }, name: "Weaponsmith Wil" },
            { type: 'guard', position: { x: 10, z: 30 }, name: "Guard Dan" },
            { type: 'merchant', position: { x: -100, z: 100 }, name: "Potion Seller" },
            { type: 'guard', position: { x: -110, z: 90 }, name: "Guard Eve" },
            { type: 'merchant', position: { x: 200, z: -200 }, name: "Roving Broker" },
            { type: 'guard', position: { x: 210, z: -190 }, name: "Guard Fred" }
        ];

        for (const data of npcData) {
            const y = this.getTerrainHeight(data.position.x, data.position.z);
            const npc = new NPC(this.scene, { 
                ...data, 
                position: new BABYLON.Vector3(data.position.x, y, data.position.z) 
            });
            this.npcs.push(npc);
        }
    }

    createEnemies() {
        // Create enemies in a few clustered areas (e.g., near Wolf Den)
        const enemyClusters = [
            { type: 'wolf', count: 5, center: { x: -200, z: -100 }, radius: 50 },
            { type: 'goblin', count: 4, center: { x: -300, z: -300 }, radius: 30 },
            { type: 'wolf', count: 3, center: { x: 100, z: 300 }, radius: 20 },
            { type: 'goblin', count: 5, center: { x: 300, z: -100 }, radius: 40 },
            { type: 'wolf', count: 2, center: { x: -500, z: 50 }, radius: 10 },
            { type: 'goblin', count: 3, center: { x: 50, z: -500 }, radius: 30 }
        ];

        for (const cluster of enemyClusters) {
            for (let i = 0; i < cluster.count; i++) {
                const offsetX = (Math.random() * cluster.radius * 2) - cluster.radius;
                const offsetZ = (Math.random() * cluster.radius * 2) - cluster.radius;
                const x = cluster.center.x + offsetX;
                const z = cluster.center.z + offsetZ;
                const y = this.getTerrainHeight(x, z);

                const enemy = new Enemy(this.scene, {
                    type: cluster.type,
                    position: new BABYLON.Vector3(x, y, z),
                    name: cluster.type.charAt(0).toUpperCase() + cluster.type.slice(1)
                });
                this.enemies.push(enemy);
            }
        }
    }
    
    createEnvironment() {
        // Simple tree placement
        const treeCount = 500;
        for (let i = 0; i < treeCount; i++) {
            const x = (Math.random() * this.options.size) - this.options.size / 2;
            const z = (Math.random() * this.options.size) - this.options.size / 2;
            const y = this.getTerrainHeight(x, z);

            // Simple check to avoid placing trees in water
            if (y > this.options.waterLevel + 1.0) {
                // Assuming you have a function to create a tree model
                // const tree = this.createMesh('environment/pine_tree.glb', x, y, z, 1.0 + Math.random() * 0.5);
                // if (tree) this.trees.push(tree);
            }
        }
    }

    setupEventListeners() {
        // Logic for listening to global events (e.g., day/night cycle change)
        // Currently empty
    }

    update(deltaTime) {
        // Update time (simple day/night cycle)
        this.time = (this.time + deltaTime * 0.01) % 24;

        // Update lighting based on time
        this.updateLighting();

        // Update all entities
        for (const npc of this.npcs) {
            npc.update(deltaTime);
        }
        for (const enemy of this.enemies) {
            // Check for player proximity and set target if necessary
            if (this.scene.game?.player?.mesh) {
                const distance = BABYLON.Vector3.Distance(enemy.mesh.position, this.scene.game.player.mesh.position);
                if (distance < 50) { // Aggro radius
                    enemy._target = this.scene.game.player.mesh;
                } else {
                    enemy._target = null;
                }
            }
            enemy.update(deltaTime);
        }

        // Update water animation
        if (this.waterMaterial) {
            this.waterMaterial.waterColor.g = 0.3 + Math.sin(this.time * 0.1) * 0.1;
            this.waterMaterial.waterColor.b = 0.7 + Math.cos(this.time * 0.15) * 0.1;
        }
    }

    updateLighting() {
        // Simple day/night cycle implementation (assuming 12=noon, 0/24=midnight)

        const timeRatio = this.time / 24;
        const sunAngle = Math.PI * 2 * timeRatio;

        // Calculate sun position in world space
        const sunX = Math.sin(sunAngle) * 1000;
        const sunY = Math.cos(sunAngle) * 1000;
        const sunZ = sunX * 0.5; // Slight offset

        this.sunLight.direction = new BABYLON.Vector3(-sunX, -sunY, -sunZ).normalize();

        // Calculate intensity based on time
        let intensity = 0;
        if (this.time >= 6 && this.time < 18) {
            // Day
            const dayTime = (this.time - 6) / 12; // 0 (6am) to 1 (6pm)
            intensity = Math.sin(dayTime * Math.PI); // Peak at noon (12)
            intensity = 0.5 + intensity * 0.5; // Range 0.5 to 1.0
        } else {
            // Night
            intensity = 0.1; // Low ambient light at night
        }

        this.sunLight.intensity = intensity;

        // Ambient Light Adjustments (to make night darker)
        this.ambientLight.intensity = 0.4 + intensity * 0.1; // Range 0.4 to 0.5
    }

    dispose() {
        console.log('[World] Disposing world resources...');
        
        // Dispose all entities
        [...this.npcs, ...this.enemies, ...this.items].forEach(entity => entity.dispose());

        // Dispose core meshes and materials
        if (this.terrain) this.terrain.dispose();
        if (this.terrainMaterial) this.terrainMaterial
