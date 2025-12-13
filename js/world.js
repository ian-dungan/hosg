// ============================================================================
// HEROES OF SHADY GROVE - WORLD MANAGER v3.0.0
// Complete database-driven world with proper NPC/enemy placement
// ============================================================================

// WorldItem class - represents items dropped in the world
class WorldItem {
    constructor(scene, position, itemData) {
        this.scene = scene;
        this.position = position;
        this.itemData = itemData;
        this.mesh = null;
        this.particleSystem = null;
        this.createMesh();
        this.createSparkle();
    }
    
    createMesh() {
        // Create simple box for now
        this.mesh = BABYLON.MeshBuilder.CreateBox('worldItem', {
            width: 0.3,
            height: 0.3,
            depth: 0.3
        }, this.scene);
        
        this.mesh.position = this.position.clone();
        
        // Material based on rarity
        const mat = new BABYLON.StandardMaterial('itemMat', this.scene);
        mat.emissiveColor = this.getRarityColor(this.itemData.rarity);
        this.mesh.material = mat;
        
        this.mesh.metadata = { isItem: true, itemData: this.itemData };
    }
    
    createSparkle() {
        // Store start time for animation
        this.startTime = Date.now();
    }
    
    getRarityColor(rarity) {
        switch(rarity) {
            case 'common': return new BABYLON.Color3(0.8, 0.8, 0.8);
            case 'uncommon': return new BABYLON.Color3(0.2, 0.8, 0.2);
            case 'rare': return new BABYLON.Color3(0.2, 0.4, 1.0);
            case 'epic': return new BABYLON.Color3(0.7, 0.2, 0.9);
            case 'legendary': return new BABYLON.Color3(1.0, 0.6, 0.0);
            default: return new BABYLON.Color3(0.8, 0.8, 0.8);
        }
    }
    
    update(deltaTime) {
        if (!this.mesh) return;
        
        // Float up and down
        const time = (Date.now() - this.startTime) / 1000;
        this.mesh.position.y = this.position.y + Math.sin(time * 2) * 0.1;
        
        // Rotate
        this.mesh.rotation.y += deltaTime * 0.001;
    }
    
    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        if (this.particleSystem) {
            this.particleSystem.dispose();
            this.particleSystem = null;
        }
    }
}

class World {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.game = scene.game;
        
        // Configuration (matching original structure)
        this.options = {
            size: options.size || CONFIG.WORLD.SIZE,
            segments: options.segments || CONFIG.WORLD.TERRAIN_SIZE,
            maxHeight: options.maxHeight || 5,
            seed: options.seed || CONFIG.WORLD.SEED,
            waterLevel: options.waterLevel || CONFIG.WORLD.WATER_LEVEL,
            ...options
        };
        
        // Shortcut properties for compatibility
        this.size = this.options.size;
        this.segments = this.options.segments;
        this.maxHeight = this.options.maxHeight;
        this.seed = this.options.seed;
        this.waterLevel = this.options.waterLevel;
        this.onProgress = options.onProgress || (() => {});
        
        // Terrain (both old and new naming for compatibility)
        this.terrain = null;
        this.terrainMaterial = null;
        this.ground = null; // New v3 naming
        this.water = null;
        this.waterMaterial = null;
        this.skybox = null;
        this.heightMap = null;
        
        // Environment decoration
        this.trees = [];
        this.rocks = [];
        this.grass = [];
        this.buildings = [];
        
        // NPCs and Enemies
        this.npcs = [];
        this.enemies = [];
        this.items = []; // Original items array
        this.worldItems = []; // Items dropped in the world (for inventory pickup)
        this.allEntities = new Map(); // id -> entity (v3 addition)
        
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
        
        // Asset loader (for caching models/textures)
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
        
        // Spawn data from database (v3 additions)
        this.npcTemplates = new Map(); // id -> template
        this.spawnPoints = []; // All spawn points from database
        this.spawnedEntities = new Map(); // spawn_id -> entity array
        
        // Respawn management (v3 additions)
        this.respawnQueue = [];
        this.respawnCheckInterval = 1000; // Check every second
        this.lastRespawnCheck = 0;
        
        console.log('[World] Initializing...');
    }
    
    async init() {
        try {
            // Create lights first
            this.reportProgress('Creating lights...', 10);
            this.setupLighting();
            
            // Create skybox
            this.reportProgress('Creating skybox...', 20);
            this.createSkybox();
            
            // Create terrain
            this.reportProgress('Generating terrain...', 30);
            await this.createTerrain();
            await this.delay(10);
            
            // Create water
            this.reportProgress('Adding water...', 40);
            this.createWater();
            await this.delay(10);
            
            // Load NPC templates and spawns from database
            this.reportProgress('Loading world data...', 50);
            await this.loadFromDatabase();
            
            // Populate world with NPCs, enemies, and decorations
            this.reportProgress('Populating world...', 60);
            await this.populateWorld();
            
            // Add environmental decorations
            this.reportProgress('Adding trees...', 75);
            await this.createTrees(50); // Spawn 50 trees
            
            this.reportProgress('Adding rocks...', 80);
            await this.createRocks(30); // Spawn 30 rocks
            
            this.reportProgress('Adding grass...', 85);
            await this.createGrass(100); // Spawn 100 grass patches
            
            this.reportProgress('Finalizing...', 95);
            await this.delay(10);
            
            this.reportProgress('World ready!', 100);
            console.log('[World] ✓ Initialized');
            console.log(`[World] NPCs: ${this.npcs.length}, Enemies: ${this.enemies.length}, Trees: ${this.trees.length}, Rocks: ${this.rocks.length}, Grass: ${this.grass.length}`);
            
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
            
            // Load spawn points from ALL zones
            const { data: spawns, error: spawnsError } = await window.supabaseService.client
                .from('hosg_npc_spawns')
                .select('*');
                // Removed .eq('zone_id', 1) to load ALL zones!
            
            if (spawnsError) throw spawnsError;
            
            if (spawns) {
                this.spawnPoints = spawns;
                console.log(`[World] ✓ Loaded ${spawns.length} spawn points across all zones`);
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
        
        let mesh = null;
        
        // Try to load GLTF model from ASSET_PATHS
        const assetKey = template.code || 'wolf'; // Use template code (wolf, goblin, orc, etc)
        
        if (window.ASSET_PATHS && window.ASSET_PATHS.getEnemyPath && this.assetLoader) {
            const modelPath = window.ASSET_PATHS.getEnemyPath(assetKey);
            
            if (modelPath) {
                try {
                    console.log(`[World] Loading enemy model: ${modelPath} for ${template.name}`);
                    const result = await this.assetLoader.loadModel(modelPath, {
                        name: template.name,
                        scaling: new BABYLON.Vector3(1.0, 1.0, 1.0)
                    });
                    
                    if (result && result.meshes && result.meshes.length > 0) {
                        mesh = result.meshes[0]; // Root mesh
                        mesh.position.copyFrom(position);
                        
                        // Hide collision/debug meshes
                        result.meshes.forEach(m => {
                            if (!m) return;
                            const name = (m.name || '').toLowerCase();
                            if (name.includes('collision') || name.includes('collider') || 
                                name.includes('hitbox') || name.includes('debug')) {
                                m.isVisible = false;
                                m.isPickable = false;
                                m.setEnabled(false);
                            }
                        });
                        
                        console.log(`[World] ✓ Loaded model for ${template.name}`);
                    }
                } catch (e) {
                    console.warn(`[World] Failed to load model for ${assetKey}:`, e);
                }
            }
        }
        
        // Fallback: Create simple capsule if model failed or unavailable
        if (!mesh) {
            console.log(`[World] Using simple mesh for ${template.name}`);
            mesh = BABYLON.MeshBuilder.CreateCapsule(enemyId, {
                height: 1.8,
                radius: 0.4
            }, this.scene);
            
            mesh.position.copyFrom(position);
            
            // Material based on level/type
            const mat = new BABYLON.StandardMaterial(`enemyMat_${enemyId}`, this.scene);
            const hue = (template.level || 1) * 30;
            mat.diffuseColor = BABYLON.Color3.FromHSV(hue, 0.8, 0.6);
            mat.emissiveColor = BABYLON.Color3.FromHSV(hue, 0.8, 0.2);
            mesh.material = mat;
        }
        
        // Create enemy object
        const enemy = {
            id: enemyId,
            mesh: mesh,
            scene: this.scene, // CRITICAL: AI needs this!
            name: template.name,
            level: template.level,
            type: template.code,
            faction: template.faction,
            stats: template.stats || {},
            spawnData: spawnData,
            spawnPosition: position.clone(),
            spawnRadius: parseFloat(spawnData.spawn_radius) || 15,
            isAlive: true,
            isEnemy: true, // CRITICAL: UI needs this to show Attack option!
            maxHealth: (template.stats && template.stats.health) || 100,
            health: (template.stats && template.stats.health) || 100,
            damage: (template.stats && template.stats.attack) || 10,
            defense: (template.stats && template.stats.defense) || 0,
            lootTable: template.loot_table || {},
            aiProfile: template.ai_profile || 'aggressive'
        };
        
        // Store reference in mesh metadata AND entityData
        mesh.metadata = { isEnemy: true, id: enemyId }; // For click detection
        mesh.entityData = enemy; // For entity lookup
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
        
        let mesh = null;
        
        // Try to load GLTF model from ASSET_PATHS
        const assetKey = template.code || 'merchant'; // Use template code (merchant, guard, etc)
        
        if (window.ASSET_PATHS && window.ASSET_PATHS.getNPCPath && this.assetLoader) {
            const modelPath = window.ASSET_PATHS.getNPCPath(assetKey);
            
            if (modelPath) {
                try {
                    console.log(`[World] Loading NPC model: ${modelPath} for ${template.name}`);
                    const result = await this.assetLoader.loadModel(modelPath, {
                        name: template.name,
                        scaling: new BABYLON.Vector3(1.0, 1.0, 1.0)
                    });
                    
                    if (result && result.meshes && result.meshes.length > 0) {
                        mesh = result.meshes[0]; // Root mesh
                        mesh.position.copyFrom(position);
                        
                        // Hide collision/debug meshes
                        result.meshes.forEach(m => {
                            if (!m) return;
                            const name = (m.name || '').toLowerCase();
                            if (name.includes('collision') || name.includes('collider') || 
                                name.includes('hitbox') || name.includes('debug')) {
                                m.isVisible = false;
                                m.isPickable = false;
                                m.setEnabled(false);
                            }
                        });
                        
                        console.log(`[World] ✓ Loaded model for ${template.name}`);
                    }
                } catch (e) {
                    console.warn(`[World] Failed to load NPC model for ${assetKey}:`, e);
                }
            }
        }
        
        // Fallback: Create simple capsule if model failed or unavailable
        if (!mesh) {
            console.log(`[World] Using simple mesh for ${template.name}`);
            mesh = BABYLON.MeshBuilder.CreateCapsule(npcId, {
                height: 1.8,
                radius: 0.4
            }, this.scene);
            
            mesh.position.copyFrom(position);
            
            // Friendly NPC material (green-ish)
            const mat = new BABYLON.StandardMaterial(`npcMat_${npcId}`, this.scene);
            mat.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.3);
            mat.emissiveColor = new BABYLON.Color3(0.1, 0.2, 0.1);
            mesh.material = mat;
        }
        
        // Create NPC object
        const npc = {
            id: npcId,
            mesh: mesh,
            scene: this.scene, // For consistency
            name: template.name,
            level: template.level,
            type: template.code,
            faction: template.faction,
            stats: template.stats || {},
            spawnData: spawnData,
            spawnPosition: position.clone(),
            isAlive: true,
            isNPC: true, // CRITICAL: UI needs this to show Talk/Trade options!
            maxHealth: (template.stats && template.stats.health) || 150,
            health: (template.stats && template.stats.health) || 150
        };
        
        // Store reference in mesh metadata AND entityData
        mesh.metadata = { isNPC: true, id: npcId }; // For click detection
        mesh.entityData = npc; // For entity lookup
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
        // Create ground mesh (name it 'terrain' for player compatibility)
        this.ground = BABYLON.MeshBuilder.CreateGroundFromHeightMap(
            'terrain', // IMPORTANT: Player waits for mesh named 'terrain'
            'data:image/png;base64,' + this.generateHeightMapDataURL(),
            {
                width: this.size,
                height: this.size,
                subdivisions: this.segments,
                minHeight: 0,
                maxHeight: this.maxHeight,
                onReady: (mesh) => {
                    // IMPORTANT: Set checkCollisions AFTER heightmap is loaded
                    // This signals to player that terrain is fully ready
                    mesh.checkCollisions = true;
                    mesh.isPickable = true;
                    mesh.receiveShadows = true;
                    mesh.metadata = { isTerrain: true, type: 'ground' };
                    console.log('[World] ✓ Terrain generated and ready');
                }
            },
            this.scene
        );
        
        // Backward compatibility alias
        this.terrain = this.ground;
        
        // Apply grass texture using AssetLoader (like original)
        if (this.assetLoader) {
            const grassTexturePath = ASSET_PATHS.getTexturePath('grass');
            if (grassTexturePath) {
                this.assetLoader.loadTexture(grassTexturePath, { uScale: 50, vScale: 50 })
                    .then(diffuseTexture => {
                        if (diffuseTexture) {
                            const mat = new BABYLON.StandardMaterial('groundMat', this.scene);
                            mat.diffuseTexture = diffuseTexture;
                            mat.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.4); // Green tint
                            mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Low specular
                            this.ground.material = mat;
                            this.terrainMaterial = mat;
                            console.log('[World] ✓ Grass texture loaded');
                        } else {
                            this.applyDefaultGroundMaterial();
                        }
                    })
                    .catch(e => {
                        console.error('[World] Failed to load grass texture:', e);
                        this.applyDefaultGroundMaterial();
                    });
            } else {
                console.warn('[World] No grass texture path found');
                this.applyDefaultGroundMaterial();
            }
        } else {
            console.warn('[World] AssetLoader not available');
            this.applyDefaultGroundMaterial();
        }
        
        // Store height map for later use
        this.cacheHeightMap();
    }
    
    applyDefaultGroundMaterial() {
        const mat = new BABYLON.StandardMaterial('groundMat', this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.4); // Natural grass green
        mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Low shine
        this.ground.material = mat;
        this.terrainMaterial = mat;
        console.log('[World] ✓ Using default grass material (no texture)');
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
    
    // Backward compatibility alias
    getTerrainHeight(x, z) {
        return this.getHeightAt(x, z);
    }
    
    // ==================== UTILITY METHODS ====================
    
    reportProgress(message, percent) {
        console.log(`[World] ${message} (${percent}%)`);
        if (this.onProgress) {
            this.onProgress(message, percent);
        }
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ==================== WORLD DECORATION ====================
    
    async createTrees(count) {
        const spawnRadius = Math.min(200, this.size * 0.4);
        let spawned = 0;
        let attempts = 0;
        const maxAttempts = count * 5;
        
        // Check if we have tree models available
        const hasTreeModels = window.ASSET_PATHS && 
                             window.ASSET_PATHS.GENERIC_MODELS && 
                             window.ASSET_PATHS.GENERIC_MODELS.tree01;
        
        const treeTypes = [];
        if (hasTreeModels) {
            if (window.ASSET_PATHS.GENERIC_MODELS.tree01) treeTypes.push('tree01');
            if (window.ASSET_PATHS.GENERIC_MODELS.tree02) treeTypes.push('tree02');
            if (window.ASSET_PATHS.GENERIC_MODELS.tree03) treeTypes.push('tree03');
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
            const waterY = this.waterLevel || 0;
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
            if (maxSlope > 3.0) continue;
            
            // Create tree (either GLTF model or simple mesh)
            if (hasTreeModels && treeTypes.length > 0 && this.assetLoader) {
                const treeType = treeTypes[Math.floor(Math.random() * treeTypes.length)];
                await this.createTreeModel(treeType, x, groundY, z);
            } else {
                this.createSimpleTree(x, groundY, z);
            }
            
            spawned++;
        }
        
        console.log(`[World] ✓ Spawned ${spawned}/${count} trees (${attempts} attempts)`);
    }
    
    async createTreeModel(treeType, x, groundY, z) {
        try {
            const modelPath = window.ASSET_PATHS.getModelPath(treeType);
            if (!modelPath) {
                this.createSimpleTree(x, groundY, z);
                return;
            }
            
            const BASE_TREE_SCALE = 2.0;
            const result = await this.assetLoader.loadModel(modelPath, {
                scaling: new BABYLON.Vector3(BASE_TREE_SCALE, BASE_TREE_SCALE, BASE_TREE_SCALE)
            });
            
            if (result && result.meshes && result.meshes.length > 0) {
                const treeMesh = result.meshes[0];
                treeMesh.position = new BABYLON.Vector3(x, groundY, z);
                treeMesh.checkCollisions = true;
                treeMesh.isPickable = false;
                
                // Random rotation
                treeMesh.rotation.y = Math.random() * Math.PI * 2;
                
                // Shadows
                if (this.shadowGenerator) {
                    result.meshes.forEach(mesh => {
                        this.shadowGenerator.addShadowCaster(mesh);
                        mesh.receiveShadows = true;
                    });
                }
                
                this.trees.push(treeMesh);
            }
        } catch (e) {
            console.warn('[World] Failed to load tree model, using simple tree:', e);
            this.createSimpleTree(x, groundY, z);
        }
    }
    
    createSimpleTree(x, groundY, z) {
        // Trunk
        const trunkHeight = 3 + Math.random() * 2;
        const trunk = BABYLON.MeshBuilder.CreateCylinder('treeTrunk', {
            height: trunkHeight,
            diameter: 0.3 + Math.random() * 0.2
        }, this.scene);
        trunk.position = new BABYLON.Vector3(x, groundY + trunkHeight / 2, z);
        
        const trunkMat = new BABYLON.StandardMaterial('trunkMat', this.scene);
        trunkMat.diffuseColor = new BABYLON.Color3(0.4, 0.3, 0.2);
        trunk.material = trunkMat;
        trunk.checkCollisions = true;
        trunk.receiveShadows = true;
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(trunk);
        
        // Foliage
        const foliageSize = 2 + Math.random();
        const foliage = BABYLON.MeshBuilder.CreateSphere('treeFoliage', {
            diameter: foliageSize,
            segments: 8
        }, this.scene);
        foliage.position = new BABYLON.Vector3(x, groundY + trunkHeight + foliageSize / 2, z);
        
        const foliageMat = new BABYLON.StandardMaterial('foliageMat', this.scene);
        foliageMat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.3);
        foliage.material = foliageMat;
        foliage.receiveShadows = true;
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(foliage);
        
        this.trees.push(trunk);
        this.trees.push(foliage);
    }
    
    async createRocks(count) {
        const spawnRadius = Math.min(200, this.size * 0.4);
        let spawned = 0;
        let attempts = 0;
        const maxAttempts = count * 5;
        
        // Check if we should try loading FBX models
        const tryFBXModels = false; // Set to false until FBX loader is configured
        
        // Define rock model paths (if using GLB instead of FBX, change extension)
        const rockModels = {
            large: [
                'assets/environment/rock_largeA.glb',  // Convert FBX to GLB for better compatibility
                'assets/environment/rock_largeB.glb',
                'assets/environment/rock_largeC.glb'
            ],
            small: [
                'assets/environment/rock_smallA.glb',
                'assets/environment/rock_smallB.glb',
                'assets/environment/rock_smallC.glb'
            ]
        };
        
        if (!tryFBXModels) {
            console.log('[World] Using simple rock meshes (set tryFBXModels=true to use 3D models)');
        }
        
        while (spawned < count && attempts < maxAttempts) {
            attempts++;
            
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * spawnRadius;
            const x = Math.sin(angle) * distance;
            const z = Math.cos(angle) * distance;
            
            const groundY = this.getHeightAt(x, z);
            const waterY = this.waterLevel || 0;
            if (groundY <= waterY + 0.5) continue;
            
            // Try to load rock model, fallback to simple mesh
            if (tryFBXModels && this.assetLoader) {
                // Randomly choose large or small (70% small, 30% large for variety)
                const isLarge = Math.random() > 0.7;
                const rockType = isLarge ? 'large' : 'small';
                const models = rockModels[rockType];
                const modelPath = models[Math.floor(Math.random() * models.length)];
                
                try {
                    await this.createRockModel(modelPath, x, groundY, z, isLarge);
                    spawned++;
                } catch (e) {
                    // Silently fall back to simple rocks
                    this.createSimpleRock(x, groundY, z);
                    spawned++;
                }
            } else {
                // Use simple rocks
                this.createSimpleRock(x, groundY, z);
                spawned++;
            }
        }
        
        console.log(`[World] ✓ Spawned ${spawned}/${count} rocks`);
    }
    
    async createRockModel(modelPath, x, groundY, z, isLarge) {
        const scale = isLarge ? 1.5 : 1.0; // Large rocks are 1.5x bigger
        
        const result = await this.assetLoader.loadModel(modelPath, {
            scaling: new BABYLON.Vector3(scale, scale, scale)
        });
        
        if (result && result.meshes && result.meshes.length > 0) {
            const rockMesh = result.meshes[0];
            rockMesh.position = new BABYLON.Vector3(x, groundY, z);
            rockMesh.checkCollisions = true;
            rockMesh.isPickable = false;
            
            // Random rotation for variety
            rockMesh.rotation.y = Math.random() * Math.PI * 2;
            
            // Slight random tilt for natural look
            rockMesh.rotation.x = (Math.random() - 0.5) * 0.2;
            rockMesh.rotation.z = (Math.random() - 0.5) * 0.2;
            
            // Shadows
            if (this.shadowGenerator) {
                result.meshes.forEach(mesh => {
                    this.shadowGenerator.addShadowCaster(mesh);
                    mesh.receiveShadows = true;
                });
            }
            
            this.rocks.push(rockMesh);
        } else {
            throw new Error('No meshes in model');
        }
    }
    
    createSimpleRock(x, groundY, z) {
        // Fallback: Create simple deformed sphere rock
        const rockSize = 0.5 + Math.random() * 1.5;
        const rock = BABYLON.MeshBuilder.CreateSphere('rock', {
            diameter: rockSize,
            segments: 8
        }, this.scene);
        
        rock.position = new BABYLON.Vector3(x, groundY + rockSize / 3, z);
        rock.scaling.x = 0.8 + Math.random() * 0.4;
        rock.scaling.y = 0.6 + Math.random() * 0.3;
        rock.scaling.z = 0.8 + Math.random() * 0.4;
        rock.rotation.y = Math.random() * Math.PI * 2;
        
        const rockMat = new BABYLON.StandardMaterial('rockMat', this.scene);
        rockMat.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.45);
        rockMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        rock.material = rockMat;
        rock.checkCollisions = true;
        rock.receiveShadows = true;
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(rock);
        
        this.rocks.push(rock);
    }
    
    async createGrass(count) {
        const spawnRadius = Math.min(150, this.size * 0.3);
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
            const waterY = this.waterLevel || 0;
            if (groundY <= waterY + 0.3) continue;
            
            // Create grass tuft
            const grassPatch = BABYLON.MeshBuilder.CreatePlane('grass', {
                size: 0.5 + Math.random() * 0.5
            }, this.scene);
            
            grassPatch.position = new BABYLON.Vector3(x, groundY + 0.2, z);
            grassPatch.rotation.x = Math.PI / 2;
            grassPatch.rotation.z = Math.random() * Math.PI * 2;
            
            const grassMat = new BABYLON.StandardMaterial('grassMat', this.scene);
            grassMat.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.3);
            grassMat.alpha = 0.8;
            grassPatch.material = grassMat;
            grassPatch.isPickable = false;
            grassPatch.receiveShadows = true;
            
            this.grass.push(grassPatch);
            spawned++;
        }
        
        console.log(`[World] ✓ Spawned ${spawned}/${count} grass patches`);
    }
    
    // ==================== SKYBOX ====================
    
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
            this.skybox.infiniteDistance = true;
        }
    }
    
    // ==================== WATER ====================
    
    createWater() {
        if (this.waterLevel <= 0) return;
        
        // Create water plane
        this.water = BABYLON.MeshBuilder.CreateGround(
            "water",
            { width: this.size * 1.5, height: this.size * 1.5, subdivisions: 1 },
            this.scene
        );
        this.water.position.y = this.waterLevel;
        this.water.isPickable = false;
        this.water.checkCollisions = false; // No collision with water
        
        // Check for WaterMaterial and AssetLoader
        if (typeof BABYLON.WaterMaterial === 'undefined' || !this.assetLoader) {
            console.log('[World] WaterMaterial not found, using basic material');
            this.waterMaterial = new BABYLON.StandardMaterial('basicWater', this.scene);
            this.waterMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.9);
            this.waterMaterial.alpha = 0.7;
            this.water.material = this.waterMaterial;
            console.log('[World] ✓ Water created at y =', this.waterLevel);
            return;
        }

        // Use WaterMaterial if available
        try {
            this.waterMaterial = new BABYLON.WaterMaterial("waterMat", this.scene, new BABYLON.Vector2(512, 512));
            this.waterMaterial.backFaceCulling = true;
            this.waterMaterial.waterColor = new BABYLON.Color3(0.1, 0.5, 0.9);
            this.waterMaterial.waterColorLevel = 0.1;
            this.waterMaterial.fresnelLevel = 1.0;
            this.waterMaterial.waveHeight = 0.3;
            this.waterMaterial.waveLength = 0.1;

            // Reflect terrain
            this.waterMaterial.reflectionTexture = new BABYLON.MirrorTexture("reflection", 1024, this.scene, true);
            this.waterMaterial.reflectionTexture.mirrorPlane = new BABYLON.Plane(0, -1, 0, this.waterLevel);
            this.waterMaterial.reflectionTexture.renderList.push(this.skybox);
            this.waterMaterial.reflectionTexture.renderList.push(this.terrain);
            
            // Refraction
            this.waterMaterial.refractionTexture = new BABYLON.RenderTargetTexture("refraction", 1024, this.scene, true);
            this.waterMaterial.refractionTexture.renderList.push(this.terrain);
            
            this.water.material = this.waterMaterial;

            // Load water bump texture
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
                            console.log('[World] Water bump texture not found:', e);
                        });
                }
            }
            
            console.log('[World] ✓ WaterMaterial created');
        } catch (e) {
            console.warn('[World] Failed to create WaterMaterial:', e);
            // Fallback to basic material
            this.waterMaterial = new BABYLON.StandardMaterial('basicWater', this.scene);
            this.waterMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.9);
            this.waterMaterial.alpha = 0.7;
            this.water.material = this.waterMaterial;
        }
        
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
        this.sunLight = sun; // Store reference
        
        // Ambient light
        const ambient = new BABYLON.HemisphericLight(
            'ambient',
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        ambient.intensity = 0.4;
        ambient.diffuse = new BABYLON.Color3(0.8, 0.8, 1.0);
        ambient.groundColor = new BABYLON.Color3(0.3, 0.3, 0.2);
        this.ambientLight = ambient; // Store reference
        
        console.log('[World] ✓ Lighting setup complete');
    }
    
    // ==================== UPDATE LOOP ====================
    
    update(deltaTime) {
        // Update time and weather
        this.time += deltaTime * 0.001; // Time progresses slowly (0.001 = game hour per second)
        if (this.time >= 24) {
            this.time -= 24;
            this.day++;
        }
        
        // Smooth weather transitions
        if (this.weatherIntensity !== this.weatherTargetIntensity) {
            if (this.weatherIntensity < this.weatherTargetIntensity) {
                this.weatherIntensity = Math.min(
                    this.weatherTargetIntensity,
                    this.weatherIntensity + this.weatherTransitionSpeed * deltaTime
                );
            } else {
                this.weatherIntensity = Math.max(
                    this.weatherTargetIntensity,
                    this.weatherIntensity - this.weatherTransitionSpeed * deltaTime
                );
            }
        }
        
        // Update world items (floating and spinning animations)
        for (let i = 0; i < this.worldItems.length; i++) {
            const item = this.worldItems[i];
            if (item && typeof item.update === 'function') {
                item.update(deltaTime);
            }
        }
        
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
        
        // Dispose world items
        this.worldItems.forEach(item => {
            if (item && item.dispose) item.dispose();
        });
        
        // Dispose decorations
        this.trees.forEach(tree => {
            if (tree) tree.dispose();
        });
        this.rocks.forEach(rock => {
            if (rock) rock.dispose();
        });
        this.grass.forEach(grass => {
            if (grass) grass.dispose();
        });
        
        // Dispose world elements
        if (this.ground) this.ground.dispose();
        if (this.water) this.water.dispose();
        if (this.skybox) this.skybox.dispose();
        
        console.log('[World] ✓ Disposed');
    }
}

window.WorldItem = WorldItem;
window.World = World;
console.log('[World] v3.0.0 loaded - Database-driven with AI, complete decorations, and animations');
