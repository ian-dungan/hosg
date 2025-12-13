// ============================================================================
// HEROES OF SHADY GROVE - WORLD MANAGER v3.0.0
// Complete database-driven world with proper NPC/enemy placement
// ============================================================================

class World {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.game = scene.game;
        
        // Configuration
        this.size = options.size || CONFIG.WORLD.SIZE;
        this.segments = options.segments || CONFIG.WORLD.TERRAIN_SIZE;
        this.maxHeight = options.maxHeight || 5;
        this.seed = options.seed || CONFIG.WORLD.SEED;
        this.waterLevel = options.waterLevel || CONFIG.WORLD.WATER_LEVEL;
        this.onProgress = options.onProgress || (() => {});
        
        // World elements
        this.ground = null;
        this.water = null;
        this.skybox = null;
        this.heightMap = null;
        
        // NPCs and Enemies
        this.npcs = [];
        this.enemies = [];
        this.allEntities = new Map(); // id -> entity
        
        // Spawn data from database
        this.npcTemplates = new Map(); // id -> template
        this.spawnPoints = []; // All spawn points from database
        this.spawnedEntities = new Map(); // spawn_id -> entity array
        
        // Respawn management
        this.respawnQueue = [];
        this.respawnCheckInterval = 1000; // Check every second
        this.lastRespawnCheck = 0;
        
        console.log('[World] Initializing...');
    }
    
    async init() {
        try {
            // Create terrain
            this.onProgress('Generating terrain...', 10);
            await this.createTerrain();
            
            // Create skybox
            this.onProgress('Creating sky...', 30);
            this.createSkybox();
            
            // Create water
            this.onProgress('Adding water...', 40);
            this.createWater();
            
            // Load NPC templates and spawns from database
            this.onProgress('Loading world data...', 50);
            await this.loadFromDatabase();
            
            // Spawn all NPCs and enemies
            this.onProgress('Populating world...', 70);
            await this.populateWorld();
            
            // Setup lighting
            this.onProgress('Setting up lighting...', 90);
            this.setupLighting();
            
            this.onProgress('World ready!', 100);
            console.log('[World] ✓ Initialized');
            console.log(`[World] NPCs: ${this.npcs.length}, Enemies: ${this.enemies.length}`);
            
        } catch (error) {
            console.error('[World] Initialization failed:', error);
            throw error;
        }
    }
    
    // ==================== DATABASE LOADING ====================
    
    async loadFromDatabase() {
        if (!window.supabaseService || !window.supabaseService.client) {
            console.warn('[World] Supabase not available, using procedural generation');
            return;
        }
        
        try {
            // Load NPC templates
            const { data: templates, error: templatesError } = await window.supabaseService.client
                .from('hosg_npc_templates')
                .select('*');
            
            if (templatesError) throw templatesError;
            
            if (templates) {
                templates.forEach(template => {
                    this.npcTemplates.set(template.id, template);
                });
                console.log(`[World] ✓ Loaded ${templates.length} NPC templates`);
            }
            
            // Load spawn points
            const { data: spawns, error: spawnsError } = await window.supabaseService.client
                .from('hosg_npc_spawns')
                .select('*')
                .eq('zone_id', 1); // Load all zones, or filter by current zone
            
            if (spawnsError) throw spawnsError;
            
            if (spawns) {
                this.spawnPoints = spawns;
                console.log(`[World] ✓ Loaded ${spawns.length} spawn points`);
            }
            
        } catch (error) {
            console.error('[World] Database load failed:', error);
            console.warn('[World] Continuing with procedural generation');
        }
    }
    
    // ==================== WORLD POPULATION ====================
    
    async populateWorld() {
        // Spawn from database if available
        if (this.spawnPoints.length > 0) {
            for (const spawn of this.spawnPoints) {
                await this.createSpawn(spawn);
            }
            console.log(`[World] ✓ Spawned ${this.npcs.length} NPCs and ${this.enemies.length} enemies from database`);
        } else {
            // Fallback to procedural generation
            console.warn('[World] No database spawns, using procedural generation');
            this.createProceduralSpawns();
        }
    }
    
    async createSpawn(spawnData) {
        const template = this.npcTemplates.get(spawnData.npc_template_id);
        if (!template) {
            console.warn(`[World] Template not found: ${spawnData.npc_template_id}`);
            return;
        }
        
        const spawnArray = [];
        const maxSpawn = spawnData.max_spawn || 1;
        const spawnRadius = parseFloat(spawnData.spawn_radius) || 0;
        
        for (let i = 0; i < maxSpawn; i++) {
            // Calculate spawn position
            let x = parseFloat(spawnData.position_x);
            let z = parseFloat(spawnData.position_z);
            
            // Add randomness within spawn radius
            if (spawnRadius > 0) {
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * spawnRadius;
                x += Math.cos(angle) * distance;
                z += Math.sin(angle) * distance;
            }
            
            // Get terrain height and add offset
            const y = this.getHeightAt(x, z) + 0.9; // Half height of entity
            
            const position = new BABYLON.Vector3(x, y, z);
            
            // Create entity based on faction
            let entity;
            if (template.faction === 'hostile') {
                entity = await this.createEnemy(template, position, spawnData);
            } else {
                entity = await this.createNPC(template, position, spawnData);
            }
            
            if (entity) {
                spawnArray.push(entity);
            }
        }
        
        // Store spawn data for respawning
        this.spawnedEntities.set(spawnData.id, {
            spawn: spawnData,
            template: template,
            entities: spawnArray
        });
    }
    
    async createEnemy(template, position, spawnData) {
        const enemyId = `enemy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Create enemy mesh
        const mesh = BABYLON.MeshBuilder.CreateCapsule(enemyId, {
            height: 1.8,
            radius: 0.4
        }, this.scene);
        
        // CRITICAL: Set position BEFORE enabling physics
        mesh.position.copyFrom(position);
        
        // Material based on level/type
        const mat = new BABYLON.StandardMaterial(`enemyMat_${enemyId}`, this.scene);
        const hue = (template.level || 1) * 30;  // Different color per level
        mat.diffuseColor = BABYLON.Color3.FromHSV(hue, 0.8, 0.6);
        mat.emissiveColor = BABYLON.Color3.FromHSV(hue, 0.8, 0.2);
        mesh.material = mat;
        
        // Create enemy object
        const enemy = {
            id: enemyId,
            mesh: mesh,
            name: template.name,
            level: template.level,
            type: template.code,
            faction: template.faction,
            stats: template.stats || {},
            spawnData: spawnData,
            spawnPosition: position.clone(),
            spawnRadius: parseFloat(spawnData.spawn_radius) || 15,
            isAlive: true,
            maxHealth: (template.stats && template.stats.health) || 100,
            health: (template.stats && template.stats.health) || 100,
            damage: (template.stats && template.stats.attack) || 10,
            defense: (template.stats && template.stats.defense) || 0,
            lootTable: template.loot_table || {},
            aiProfile: template.ai_profile || 'aggressive'
        };
        
        // Store reference in mesh
        mesh.entityData = enemy;
        mesh.isPickable = true;
        
        // Initialize AI if available
        if (window.EnemyAI) {
            enemy.ai = new EnemyAI(enemy);
        } else {
            console.warn('[World] EnemyAI not available for', enemy.name);
        }
        
        // Add to world
        this.enemies.push(enemy);
        this.allEntities.set(enemyId, enemy);
        
        // Create nameplate
        this.createNameplate(mesh, enemy.name, enemy.level, 'red');
        
        console.log(`[World] ✓ Spawned enemy: ${enemy.name} (Lv.${enemy.level}) at`, position.toString());
        
        return enemy;
    }
    
    async createNPC(template, position, spawnData) {
        const npcId = `npc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Create NPC mesh
        const mesh = BABYLON.MeshBuilder.CreateCapsule(npcId, {
            height: 1.8,
            radius: 0.4
        }, this.scene);
        
        // CRITICAL: Set position BEFORE enabling physics
        mesh.position.copyFrom(position);
        
        // Friendly NPC material (green-ish)
        const mat = new BABYLON.StandardMaterial(`npcMat_${npcId}`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.3);
        mat.emissiveColor = new BABYLON.Color3(0.1, 0.2, 0.1);
        mesh.material = mat;
        
        // Create NPC object
        const npc = {
            id: npcId,
            mesh: mesh,
            name: template.name,
            level: template.level,
            type: template.code,
            faction: template.faction,
            stats: template.stats || {},
            spawnData: spawnData,
            spawnPosition: position.clone(),
            isAlive: true,
            maxHealth: (template.stats && template.stats.health) || 150,
            health: (template.stats && template.stats.health) || 150
        };
        
        // Store reference in mesh
        mesh.entityData = npc;
        mesh.isPickable = true;
        
        // Add to world
        this.npcs.push(npc);
        this.allEntities.set(npcId, npc);
        
        // Create nameplate
        this.createNameplate(mesh, npc.name, npc.level, 'green');
        
        console.log(`[World] ✓ Spawned NPC: ${npc.name} (Lv.${npc.level}) at`, position.toString());
        
        return npc;
    }
    
    createNameplate(mesh, name, level, color) {
        // Create plane for nameplate
        const plane = BABYLON.MeshBuilder.CreatePlane(
            `nameplate_${mesh.name}`,
            { width: 2, height: 0.4 },
            this.scene
        );
        
        plane.parent = mesh;
        plane.position.y = 1.2;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        
        // Create dynamic texture
        const texture = new BABYLON.DynamicTexture(
            `nameplateTexture_${mesh.name}`,
            { width: 512, height: 128 },
            this.scene,
            false
        );
        
        const mat = new BABYLON.StandardMaterial(`nameplateMat_${mesh.name}`, this.scene);
        mat.diffuseTexture = texture;
        mat.emissiveTexture = texture;
        mat.opacityTexture = texture;
        mat.backFaceCulling = false;
        plane.material = mat;
        
        // Draw text
        const ctx = texture.getContext();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, 512, 128);
        
        ctx.font = 'bold 40px Arial';
        ctx.fillStyle = color || 'white';
        ctx.textAlign = 'center';
        ctx.fillText(`${name} (Lv.${level})`, 256, 75);
        
        texture.update();
        
        return plane;
    }
    
    createProceduralSpawns() {
        console.log('[World] Creating procedural spawns (fallback)');
        
        // Create some wolves in a circle around spawn
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 / 8) * i;
            const distance = 50;
            const x = Math.cos(angle) * distance;
            const z = Math.sin(angle) * distance;
            const y = this.getHeightAt(x, z) + 0.9;
            
            this.createProceduralEnemy('wolf', new BABYLON.Vector3(x, y, z), 3);
        }
        
        // Create some merchants in town
        const merchantPositions = [
            new BABYLON.Vector3(10, 0, 10),
            new BABYLON.Vector3(-10, 0, 10),
            new BABYLON.Vector3(10, 0, -10),
            new BABYLON.Vector3(-10, 0, -10)
        ];
        
        merchantPositions.forEach((pos, i) => {
            pos.y = this.getHeightAt(pos.x, pos.z) + 0.9;
            this.createProceduralNPC('merchant', pos, 5);
        });
    }
    
    createProceduralEnemy(type, position, level) {
        const template = {
            id: 999,
            code: type,
            name: type.charAt(0).toUpperCase() + type.slice(1),
            level: level,
            faction: 'hostile',
            stats: {
                health: 40 + (level * 10),
                attack: 8 + (level * 2),
                defense: 2 + level,
                speed: 1.0,
                aggro_range: 15
            },
            ai_profile: 'aggressive',
            loot_table: {}
        };
        
        const spawnData = {
            id: 999,
            npc_template_id: 999,
            zone_id: 1,
            position_x: position.x,
            position_y: position.y,
            position_z: position.z,
            respawn_seconds: 120,
            max_spawn: 1,
            spawn_radius: 0
        };
        
        return this.createEnemy(template, position, spawnData);
    }
    
    createProceduralNPC(type, position, level) {
        const template = {
            id: 998,
            code: type,
            name: type.charAt(0).toUpperCase() + type.slice(1),
            level: level,
            faction: 'friendly',
            stats: {
                health: 150,
                defense: 5
            }
        };
        
        const spawnData = {
            id: 998,
            npc_template_id: 998,
            zone_id: 1,
            position_x: position.x,
            position_y: position.y,
            position_z: position.z,
            respawn_seconds: 0,
            max_spawn: 1,
            spawn_radius: 0
        };
        
        return this.createNPC(template, position, spawnData);
    }
    
    // ==================== TERRAIN GENERATION ====================
    
    async createTerrain() {
        // Create ground mesh
        this.ground = BABYLON.MeshBuilder.CreateGroundFromHeightMap(
            'ground',
            'data:image/png;base64,' + this.generateHeightMapDataURL(),
            {
                width: this.size,
                height: this.size,
                subdivisions: this.segments,
                minHeight: 0,
                maxHeight: this.maxHeight,
                onReady: (mesh) => {
                    console.log('[World] ✓ Terrain generated');
                }
            },
            this.scene
        );
        
        this.ground.checkCollisions = true;
        this.ground.isPickable = true;
        
        // Apply grass texture if available
        const grassTexture = ASSET_PATHS.getTexturePath('grass');
        if (grassTexture && this.scene.game.assetManager) {
            const texture = await this.scene.game.assetManager.loadTexture(grassTexture, {
                uScale: CONFIG.WORLD.GROUND.TILE_SCALE,
                vScale: CONFIG.WORLD.GROUND.TILE_SCALE
            });
            
            if (texture) {
                const mat = new BABYLON.StandardMaterial('groundMat', this.scene);
                mat.diffuseTexture = texture;
                mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
                this.ground.material = mat;
            } else {
                this.applyDefaultGroundMaterial();
            }
        } else {
            this.applyDefaultGroundMaterial();
        }
        
        // Store height map for later use
        this.cacheHeightMap();
    }
    
    applyDefaultGroundMaterial() {
        const mat = new BABYLON.StandardMaterial('groundMat', this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.2); // Grass green
        mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        this.ground.material = mat;
    }
    
    generateHeightMapDataURL() {
        // Create a simple procedural height map using noise
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        const imageData = ctx.createImageData(size, size);
        const data = imageData.data;
        
        // Simple noise-based terrain
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                
                // Multiple octaves of noise
                const nx = x / size;
                const ny = y / size;
                
                let height = 0;
                height += this.noise(nx * 2, ny * 2) * 0.5;
                height += this.noise(nx * 4, ny * 4) * 0.25;
                height += this.noise(nx * 8, ny * 8) * 0.125;
                
                // Normalize to 0-255
                const value = Math.floor((height + 1) * 127.5);
                
                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = 255;
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL().split(',')[1];
    }
    
    noise(x, y) {
        // Simple hash-based noise
        const seed = this.seed || 12345;
        const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453123;
        return (n - Math.floor(n)) * 2 - 1;
    }
    
    cacheHeightMap() {
        // Cache height map for fast lookups
        this.heightMap = {};
        console.log('[World] Height map cached');
    }
    
    getHeightAt(x, z) {
        if (!this.ground) return 0;
        
        // Use Babylon's built-in height retrieval
        const height = this.ground.getHeightAtCoordinates(x, z);
        return height !== null ? height : 0;
    }
    
    // ==================== SKYBOX ====================
    
    createSkybox() {
        const skybox = BABYLON.MeshBuilder.CreateBox(
            'skybox',
            { size: CONFIG.WORLD.SKYBOX.SIZE },
            this.scene
        );
        
        const skyboxMat = new BABYLON.StandardMaterial('skyboxMat', this.scene);
        skyboxMat.backFaceCulling = false;
        skyboxMat.disableLighting = true;
        
        // Use simple gradient sky (HDRI requires .env or .dds cubemap files)
        skyboxMat.emissiveColor = new BABYLON.Color3(0.5, 0.7, 1.0);
        
        skybox.material = skyboxMat;
        skybox.infiniteDistance = true;
        
        this.skybox = skybox;
        console.log('[World] ✓ Skybox created');
    }
    
    // ==================== WATER ====================
    
    createWater() {
        if (this.waterLevel <= 0) return;
        
        this.water = BABYLON.MeshBuilder.CreateGround(
            'water',
            { width: this.size, height: this.size },
            this.scene
        );
        
        this.water.position.y = this.waterLevel;
        
        const waterMat = new BABYLON.StandardMaterial('waterMat', this.scene);
        waterMat.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.6);
        waterMat.specularColor = new BABYLON.Color3(1, 1, 1);
        waterMat.alpha = 0.7;
        
        this.water.material = waterMat;
        console.log('[World] ✓ Water created at y =', this.waterLevel);
    }
    
    // ==================== LIGHTING ====================
    
    setupLighting() {
        // Main directional light (sun)
        const sun = new BABYLON.DirectionalLight(
            'sun',
            new BABYLON.Vector3(-1, -2, -1),
            this.scene
        );
        sun.intensity = 0.8;
        sun.diffuse = new BABYLON.Color3(1, 0.95, 0.9);
        sun.specular = new BABYLON.Color3(1, 1, 1);
        
        // Ambient light
        const ambient = new BABYLON.HemisphericLight(
            'ambient',
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        ambient.intensity = 0.4;
        ambient.diffuse = new BABYLON.Color3(0.8, 0.8, 1.0);
        ambient.groundColor = new BABYLON.Color3(0.3, 0.3, 0.2);
        
        console.log('[World] ✓ Lighting setup complete');
    }
    
    // ==================== UPDATE LOOP ====================
    
    update(deltaTime) {
        // Update enemies
        for (let i = 0; i < this.enemies.length; i++) {
            const enemy = this.enemies[i];
            
            if (enemy.isAlive) {
                // Update AI
                if (enemy.ai && enemy.ai.update) {
                    enemy.ai.update(deltaTime);
                }
                
                // CRITICAL: Keep enemies on ground
                if (enemy.mesh) {
                    const groundY = this.getHeightAt(enemy.mesh.position.x, enemy.mesh.position.z);
                    enemy.mesh.position.y = groundY + 0.9; // Half height
                }
            } else {
                // Handle dead enemy
                if (enemy.mesh && !enemy.mesh.isDisposed()) {
                    // Schedule respawn if applicable
                    if (enemy.spawnData && enemy.spawnData.respawn_seconds > 0) {
                        this.scheduleRespawn(enemy);
                    }
                }
            }
        }
        
        // Update NPCs (keep them on ground)
        for (let i = 0; i < this.npcs.length; i++) {
            const npc = this.npcs[i];
            if (npc.mesh && npc.isAlive) {
                const groundY = this.getHeightAt(npc.mesh.position.x, npc.mesh.position.z);
                npc.mesh.position.y = groundY + 0.9;
            }
        }
        
        // Handle respawns
        this.handleRespawns(deltaTime);
    }
    
    // ==================== RESPAWN SYSTEM ====================
    
    scheduleRespawn(entity) {
        if (!entity.spawnData || entity.spawnData.respawn_seconds <= 0) return;
        
        const respawnTime = Date.now() + (entity.spawnData.respawn_seconds * 1000);
        
        this.respawnQueue.push({
            entity: entity,
            respawnTime: respawnTime,
            spawnData: entity.spawnData,
            template: this.npcTemplates.get(entity.spawnData.npc_template_id)
        });
        
        // Remove entity mesh
        if (entity.mesh) {
            entity.mesh.dispose();
            entity.mesh = null;
        }
        
        console.log(`[World] Scheduled respawn for ${entity.name} in ${entity.spawnData.respawn_seconds}s`);
    }
    
    handleRespawns(deltaTime) {
        const now = Date.now();
        
        for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
            const respawn = this.respawnQueue[i];
            
            if (now >= respawn.respawnTime) {
                // Respawn the entity
                this.createSpawn(respawn.spawnData);
                
                // Remove from queue
                this.respawnQueue.splice(i, 1);
                
                console.log(`[World] ✓ Respawned ${respawn.template.name}`);
            }
        }
    }
    
    // ==================== ENTITY MANAGEMENT ====================
    
    getEntityById(id) {
        return this.allEntities.get(id);
    }
    
    getEntityByMesh(mesh) {
        if (!mesh) return null;
        return mesh.entityData || null;
    }
    
    getNearbyEnemies(position, radius) {
        return this.enemies.filter(enemy => {
            if (!enemy.mesh || !enemy.isAlive) return false;
            const distance = BABYLON.Vector3.Distance(position, enemy.mesh.position);
            return distance <= radius;
        });
    }
    
    getNearbyNPCs(position, radius) {
        return this.npcs.filter(npc => {
            if (!npc.mesh || !npc.isAlive) return false;
            const distance = BABYLON.Vector3.Distance(position, npc.mesh.position);
            return distance <= radius;
        });
    }
    
    // ==================== CLEANUP ====================
    
    dispose() {
        // Dispose enemies
        this.enemies.forEach(enemy => {
            if (enemy.ai) enemy.ai.dispose();
            if (enemy.mesh) enemy.mesh.dispose();
        });
        
        // Dispose NPCs
        this.npcs.forEach(npc => {
            if (npc.mesh) npc.mesh.dispose();
        });
        
        // Dispose world elements
        if (this.ground) this.ground.dispose();
        if (this.water) this.water.dispose();
        if (this.skybox) this.skybox.dispose();
        
        console.log('[World] ✓ Disposed');
    }
}

window.World = World;
console.log('[World] v3.0.0 loaded - Database-driven with AI');
