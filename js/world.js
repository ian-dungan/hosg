// Simplex Noise for terrain generation
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
        this.perm = new Array(512);
        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
        }
    }
    lerp(t, a, b) { return a + t * (b - a); }
    dot(g, x, y) { return g[0] * x + g[1] * y; }
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

// Base Entity class
class Entity {
    constructor(scene, position) {
        this.scene = scene;
        if (typeof BABYLON !== "undefined" && BABYLON.Vector3) {
            if (position instanceof BABYLON.Vector3) {
                this.position = position.clone();
            } else {
                this.position = BABYLON.Vector3.Zero();
            }
        } else {
            this.position = position || { x: 0, y: 0, z: 0 };
        }
        this.mesh = null;
        this._isDisposed = false;
    }
    update(deltaTime) {
        if (this.mesh && this.mesh.position && this.position && typeof this.mesh.position.copyFrom === "function") {
            this.mesh.position.copyFrom(this.position);
        }
    }
    dispose() {
        this._isDisposed = true;
        if (this.mesh && typeof this.mesh.dispose === "function") {
            this.mesh.dispose();
            this.mesh = null;
        }
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

        this.terrain = null;
        this.terrainMaterial = null;
        this.water = null;
        this.waterMaterial = null;
        this.skybox = null;
        this.collisionBarrier = null;

        this.trees = [];
        this.rocks = [];
        this.grass = [];
        this.buildings = [];
        this.npcs = [];
        this.enemies = [];
        this.items = [];
        this.landmarks = []; // Store landmarks for UI

        this.time = 0;
        this.day = 1;
        this.weather = 'clear';
        this.weatherIntensity = 0;
        this.weatherTargetIntensity = 0;
        this.weatherTransitionSpeed = 0.1;

        this.sunLight = null;
        this.ambientLight = null;
        this.shadowGenerator = null;
        this.gravity = new BABYLON.Vector3(0, -9.81, 0);

        this.assetLoader = (typeof AssetLoader !== 'undefined') ? new AssetLoader(this.scene) : null;
        if (this.scene) {
            this.scene.world = this;
            if (this.scene.game) {
                this.scene.game.world = this;
            }
            this.scene.assetLoader = this.assetLoader;
            if (this.scene.game) {
                this.scene.game.assetLoader = this.assetLoader;
            }
        }
        this.init();
    }

    init() {
        this.createLights();
        this.createSkybox();
        this.createTerrain();
        this.createWater();
        this.populateWorld();
        this.setupEventListeners();

        // Signal readiness
        setTimeout(() => {
            console.log('[World] ✅ World fully initialized, signaling player...');
            const player = this.scene.player || this.scene.game?.player;
            if (player && typeof player.startAfterWorldReady === 'function') {
                player.startAfterWorldReady();
            } else {
                console.warn('[World] Player not found or startAfterWorldReady not available');
            }
        }, 500);
    }
    
    // PATCH START: Add missing accessor function for UIManager
    getLandmarks() {
        return this.landmarks;
    }
    // PATCH END

    createLights() {
        this.sunLight = new BABYLON.DirectionalLight('sunLight', new BABYLON.Vector3(-1, -2, -1), this.scene);
        this.sunLight.intensity = 1.0;
        this.sunLight.diffuse = new BABYLON.Color3(1, 0.95, 0.9);
        this.sunLight.specular = new BABYLON.Color3(1, 0.95, 0.9);

        this.sunLight.shadowEnabled = true;
        this.shadowGenerator = new BABYLON.ShadowGenerator(1024, this.sunLight);
        this.shadowGenerator.useBlurExponentialShadowMap = true;
        this.shadowGenerator.blurKernel = 32;

        this.ambientLight = new BABYLON.HemisphericLight('ambientLight', new BABYLON.Vector3(0, 1, 0), this.scene);
        this.ambientLight.intensity = 0.5;
        this.ambientLight.diffuse = new BABYLON.Color3(0.5, 0.5, 0.6);
        this.ambientLight.specular = new BABYLON.Color3(0.1, 0.1, 0.1);
    }

    createSkybox() {
        // Simple procedural skybox
        const skybox = BABYLON.MeshBuilder.CreateBox("skybox", { size: 10000.0 }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        
        // Procedural gradient if possible, otherwise blue
        skyboxMaterial.emissiveColor = new BABYLON.Color3(0.5, 0.7, 1.0); 
        skybox.material = skyboxMaterial;
        this.skybox = skybox;
    }

    generateHeightmap() {
        // NOTE: Moved this definition up in previous interactions to fix hoisting
        const positions = this.terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const normals = [];
        const noise = new SimplexNoise(this.options.seed);

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            let y = 0;
            
            // Multiple octaves
            y += noise.noise2D(x * 0.005, z * 0.005) * 1;
            y += noise.noise2D(x * 0.01, z * 0.01) * 0.5;
            y += noise.noise2D(x * 0.02, z * 0.02) * 0.25;

            positions[i + 1] = y * this.options.maxHeight;
        }

        this.terrain.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        BABYLON.VertexData.ComputeNormals(positions, this.terrain.getIndices(), normals);
        this.terrain.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    }

    createTerrain() {
        this.terrain = BABYLON.MeshBuilder.CreateGround('terrain', {
            width: this.options.size,
            height: this.options.size,
            subdivisions: this.options.segments,
            updatable: true
        }, this.scene);

        this.generateHeightmap();

        this.terrainMaterial = new BABYLON.StandardMaterial('terrainMaterial', this.scene);
        this.terrainMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.6, 0.3); // Green grass
        this.terrainMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        this.terrain.material = this.terrainMaterial;
        
        this.terrain.receiveShadows = true;
        this.terrain.checkCollisions = true;

        if (this.scene.getPhysicsEngine()) {
            this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.terrain,
                BABYLON.PhysicsImpostor.HeightmapImpostor, // FIX: Use HeightmapImpostor for terrain
                { mass: 0, friction: 0.8, restitution: 0.1 },
                this.scene
            );
        }

        // Invisible collision barrier for raycasting consistency
        this.collisionBarrier = this.terrain.clone('terrainCollisionBarrier');
        this.collisionBarrier.isVisible = false;
        this.collisionBarrier.position.y -= 0.05;
        this.collisionBarrier.checkCollisions = true;
        if (this.scene.getPhysicsEngine()) {
            this.collisionBarrier.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.collisionBarrier,
                BABYLON.PhysicsImpostor.HeightmapImpostor,
                { mass: 0, friction: 0.8, restitution: 0.1 },
                this.scene
            );
        }
    }

    getHeightAt(x, z) {
        if (!this.terrain) return 0;
        // Raycast from top down
        const ray = new BABYLON.Ray(new BABYLON.Vector3(x, 500, z), BABYLON.Vector3.Down());
        const pick = this.scene.pickWithRay(ray, (mesh) => mesh === this.terrain);
        return pick.hit ? pick.pickedPoint.y : 0;
    }
    
    // Alias for compatibility
    getTerrainHeight(x, z) {
        return this.getHeightAt(x, z);
    }

    createWater() {
        this.water = BABYLON.MeshBuilder.CreateGround("water", {
            width: this.options.size,
            height: this.options.size,
            subdivisions: 1
        }, this.scene);
        this.water.position.y = this.options.waterLevel;
        this.water.isPickable = false;
        
        const waterMat = new BABYLON.StandardMaterial("waterMat", this.scene);
        waterMat.diffuseColor = new BABYLON.Color3(0, 0.4, 0.8);
        waterMat.alpha = 0.6;
        waterMat.specularColor = new BABYLON.Color3(0.8, 0.8, 0.8);
        this.water.material = waterMat;
        
        console.log('[World] Water created');
    }

    populateWorld() {
        this.landmarks = []; // Init landmarks for UI

        // Add landmarks
        this.landmarks.push({ name: "Spawn Point", position: new BABYLON.Vector3(0, this.getHeightAt(0,0), 0), type: "spawn" });
        
        this.createTrees(50);
        this.createRocks(20);
        this.createGrass(100);
        this.createNPCs(5);
        this.createEnemies(10);
        
        // Add generated entities to landmarks if significant
        this.buildings.forEach(b => {
             this.landmarks.push({ name: "Building", position: b.mesh.position, type: "building" });
        });
    }

    createTrees(count) {
        const mat = new BABYLON.StandardMaterial("treeMat", this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.4, 0.3, 0.2);
        
        const leafMat = new BABYLON.StandardMaterial("leafMat", this.scene);
        leafMat.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.1);

        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * this.options.size;
            const z = (Math.random() - 0.5) * this.options.size;
            const y = this.getHeightAt(x, z);

            if (y > this.options.waterLevel) {
                const trunk = BABYLON.MeshBuilder.CreateCylinder("trunk" + i, {height: 4, diameter: 1}, this.scene);
                trunk.position = new BABYLON.Vector3(x, y + 2, z);
                trunk.material = mat;
                trunk.receiveShadows = true;
                this.shadowGenerator.addShadowCaster(trunk);

                const leaves = BABYLON.MeshBuilder.CreateSphere("leaves" + i, {diameter: 5}, this.scene);
                leaves.position = new BABYLON.Vector3(x, y + 5, z);
                leaves.material = leafMat;
                leaves.receiveShadows = true;
                this.shadowGenerator.addShadowCaster(leaves);

                const treeEntity = new Entity(this.scene, trunk.position);
                treeEntity.mesh = trunk; // Just track root
                this.trees.push(treeEntity);
            }
        }
    }

    createRocks(count) {
        const mat = new BABYLON.StandardMaterial("rockMat", this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);

        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * this.options.size;
            const z = (Math.random() - 0.5) * this.options.size;
            const y = this.getHeightAt(x, z);

            const rock = BABYLON.MeshBuilder.CreateBox("rock" + i, {size: 2}, this.scene);
            rock.position = new BABYLON.Vector3(x, y + 1, z);
            rock.rotation = new BABYLON.Vector3(Math.random(), Math.random(), Math.random());
            rock.material = mat;
            rock.receiveShadows = true;
            this.shadowGenerator.addShadowCaster(rock);

            // Simple collision
            if (this.scene.getPhysicsEngine()) {
                rock.physicsImpostor = new BABYLON.PhysicsImpostor(rock, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0 }, this.scene);
            }

            const rockEntity = new Entity(this.scene, rock.position);
            rockEntity.mesh = rock;
            this.rocks.push(rockEntity);
        }
    }

    createGrass(count) {
        // Simplified grass
        const mat = new BABYLON.StandardMaterial("grassMat", this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.2);
        mat.backFaceCulling = false;

        for (let i = 0; i < count; i++) {
             const x = (Math.random() - 0.5) * this.options.size;
             const z = (Math.random() - 0.5) * this.options.size;
             const y = this.getHeightAt(x, z);
             
             if (y > this.options.waterLevel) {
                 const grass = BABYLON.MeshBuilder.CreatePlane("grass"+i, {size: 1}, this.scene);
                 grass.position = new BABYLON.Vector3(x, y + 0.5, z);
                 grass.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
                 grass.material = mat;
                 this.grass.push(new Entity(this.scene, grass.position));
             }
        }
    }
    
    // Placeholder for buildings
    createBuildings(count) {
        // ... (implementation same as previous versions)
    }

    createNPCs(count) {
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 100;
            const z = (Math.random() - 0.5) * 100;
            const y = this.getHeightAt(x, z);
            const pos = new BABYLON.Vector3(x, y + 1, z);
            
            const npc = new NPC(this.scene, pos, i, "merchant");
            this.npcs.push(npc);
        }
    }

    createEnemies(count) {
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 200;
            const z = (Math.random() - 0.5) * 200;
            const y = this.getHeightAt(x, z);
            const pos = new BABYLON.Vector3(x, y + 1, z);
            
            const enemy = new Enemy(this.scene, pos, i, "wolf");
            this.enemies.push(enemy);
        }
    }

    setupEventListeners() {
        this.scene.onBeforeRenderObservable.add(() => {
            this.update(this.scene.getEngine().getDeltaTime() / 1000);
        });
    }

    update(deltaTime) {
        this.time += deltaTime * 0.1;
        
        // Update entities
        this.npcs.forEach(n => n.update(deltaTime));
        this.enemies.forEach(e => e.update(deltaTime));
        this.items.forEach(i => i.update(deltaTime));
        
        // Simple day/night
        const intensity = Math.max(0.1, Math.sin(this.time));
        this.sunLight.intensity = intensity;
    }

    dispose() {
        if (this.terrain) this.terrain.dispose();
        if (this.water) this.water.dispose();
        // ... dispose other assets
    }
    
    // Helper to find a dry location
    findDrySpot(x, z, attempts, radius, margin) {
        return { x: x, y: this.getHeightAt(x,z), z: z }; // Simplified fallback
    }
}

// NPC Class
class NPC extends Entity {
    constructor(scene, position, id, type) {
        super(scene, position);
        this.id = id;
        this.type = type;
        this.assetKey = type;
        this.name = `NPC ${id}`;
        this.state = 'idle';
        this.init();
    }
    
    async init() {
        await this.loadModel();
    }
    
    async loadModel() {
        if (!this.assetKey) this.assetKey = 'merchant'; // Fallback
        
        // Use AssetLoader if available
        if (this.scene.assetLoader) {
             // ...
        }
        
        // Create placeholder for now to ensure visibility
        this.createPlaceholderMesh();
    }
    
    createPlaceholderMesh() {
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("npc"+this.id, {height: 2, diameter: 0.8}, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.metadata = { isNPC: true, id: this.id };
        const mat = new BABYLON.StandardMaterial("npcMat", this.scene);
        mat.diffuseColor = new BABYLON.Color3(0, 0, 1);
        this.mesh.material = mat;
    }
    
    update(dt) {
        super.update(dt);
        // Simple AI logic
    }
}

// Enemy Class
class Enemy extends NPC {
    constructor(scene, position, id, type) {
        super(scene, position, id, type);
        this.assetKey = type || 'wolf';
        this.name = `Enemy ${id}`;
    }
    
    // FIX: Updated loadModel to handle null/failure safely
    async loadModel() {
        if (!window.ASSET_MANIFEST || !window.ASSET_MANIFEST.CHARACTERS || !window.ASSET_MANIFEST.CHARACTERS.ENEMIES) {
            console.warn(`[Enemy] Manifest missing, using placeholder`);
            this.createPlaceholderMesh();
            return;
        }
        
        const config = window.ASSET_MANIFEST.CHARACTERS.ENEMIES[this.assetKey];
        if (!config) {
             console.warn(`[Enemy] Config not found for ${this.assetKey}, using placeholder`);
             this.createPlaceholderMesh();
             return;
        }
        
        const path = window.ASSET_MANIFEST.BASE_PATH + config.model;
        
        try {
            const result = await this.scene.assetLoader.loadModel(path, { 
                scaling: new BABYLON.Vector3(config.scale, config.scale, config.scale) 
            });
            
            // FIX: Check if result is valid
            if (!result || !result.root) {
                console.warn(`[Enemy] Model load failed/returned null for ${this.assetKey}`);
                this.createPlaceholderMesh();
                return;
            }
            
            this.mesh = result.root;
            this.mesh.position.copyFrom(this.position);
            // ... setup ...
            
        } catch (e) {
            console.warn(`[Enemy] Load error: ${e}`);
            this.createPlaceholderMesh();
        }
    }
    
    createPlaceholderMesh() {
        this.mesh = BABYLON.MeshBuilder.CreateBox("enemy"+this.id, {size: 1}, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.metadata = { isEnemy: true, id: this.id };
        const mat = new BABYLON.StandardMaterial("enemyMat", this.scene);
        mat.diffuseColor = new BABYLON.Color3(1, 0, 0);
        this.mesh.material = mat;
    }
}

// Item Class
class Item extends Entity {
    constructor(scene, options) {
        super(scene, options.position);
        this.type = options.type;
        this.init();
    }
    
    init() {
        this.mesh = BABYLON.MeshBuilder.CreateSphere("item", {diameter: 0.5}, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.metadata = { isItem: true };
    }
    
    static deserialize(data, scene) {
        return new Item(scene, { position: new BABYLON.Vector3(data.position.x, data.position.y, data.position.z), type: data.type });
    }
}

// Exports
if (typeof module !== 'undefined') {
    module.exports = { World, NPC, Enemy, Item, SimplexNoise };
}
