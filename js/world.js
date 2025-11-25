class World {
    constructor(scene, shadowGenerator) {
        this.scene = scene;
        this.shadowGenerator = shadowGenerator;
        
        // World state
        this.terrain = null;
        this.chunks = new Map();
        this.npcs = new Map();
        this.enemies = new Map();
        this.items = new Map();
        this.quests = new Map();
        
        // Time and weather
        this.timeOfDay = 0; // 0-24 hours
        this.day = 1;
        this.weather = 'clear'; // clear, rain, snow, storm
        this.weatherDuration = 0;
        this.weatherTimer = 0;
        
        // Environment
        this.skybox = null;
        this.sunLight = null;
        this.ambientLight = null;
        this.fog = null;
        this.particleSystems = [];
    }
    
    async init() {
        // Create environment
        this.createLights();
        this.createSkybox();
        this.createTerrain();
        this.setupWeather();
        
        // Load world data
        await Promise.all([
            this.loadNPCs(),
            this.loadQuests(),
            this.loadWorldData()
        ]);
        
        // Start time cycle
        this.setupTimeCycle();
    }
    
    createLights() {
        // Sun light (directional)
        this.sunLight = new BABYLON.DirectionalLight('sunLight', new BABYLON.Vector3(-1, -2, -1), this.scene);
        this.sunLight.position = new BABYLON.Vector3(0, 50, 0);
        this.sunLight.intensity = 1.0;
        this.sunLight.diffuse = new BABYLON.Color3(1, 0.95, 0.84);
        
        // Add shadow support
        if (this.shadowGenerator) {
            this.shadowGenerator.getShadowMap().renderList = [];
            // Shadow casters (player, enemies, objects) are added elsewhere.
            // Just configure sun light shadow bounds here if needed.
            this.sunLight.shadowMinZ = 1;
            this.sunLight.shadowMaxZ = 250;
        }
        
        // Ambient light
        this.ambientLight = new BABYLON.HemisphericLight('ambientLight', new BABYLON.Vector3(0, 1, 0), this.scene);
        this.ambientLight.intensity = 0.5;
        this.ambientLight.groundColor = new BABYLON.Color3(0.2, 0.2, 0.3);
        this.ambientLight.diffuse = new BABYLON.Color3(0.8, 0.8, 0.9);
    }
    
    createSkybox() {
        // Simple skybox
        this.skybox = BABYLON.MeshBuilder.CreateBox('skybox', { size: 1000 }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial('skyboxMaterial', this.scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.disableLighting = true;
        
        // Set skybox texture based on time of day
        this.updateSkybox();
        
        this.skybox.material = skyboxMaterial;
        this.skybox.infiniteDistance = true;
    }
    
    updateSkybox() {
        if (!this.skybox) return;
        
        const skyboxMaterial = this.skybox.material;
        
        // Update sky color based on time of day
        if (this.timeOfDay >= 5 && this.timeOfDay < 8) {
            // Dawn
            skyboxMaterial.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.7);
        } else if (this.timeOfDay >= 8 && this.timeOfDay < 18) {
            // Day
            skyboxMaterial.emissiveColor = new BABYLON.Color3(0.8, 0.9, 1.0);
        } else if (this.timeOfDay >= 18 && this.timeOfDay < 20) {
            // Dusk
            skyboxMaterial.emissiveColor = new BABYLON.Color3(0.7, 0.5, 0.5);
        } else {
            // Night
            skyboxMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.2);
        }
    }
    
    createTerrain() {
        // Simple ground plane for now
        this.terrain = BABYLON.MeshBuilder.CreateGround('terrain', {
            width: 100,
            height: 100,
            subdivisions: 20
        }, this.scene);
        
        // Add some basic material
        const groundMaterial = new BABYLON.StandardMaterial('groundMaterial', this.scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.6, 0.3);
        groundMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        this.terrain.material = groundMaterial;
        
        // Enable physics
        this.terrain.checkCollisions = true;
        this.terrain.receiveShadows = true;
        
        // Add some obstacles
        this.createObstacles();
    }
    
    createObstacles() {
        // Add some simple obstacles
        const obstacleCount = 10;
        for (let i = 0; i < obstacleCount; i++) {
            const size = Math.random() * 2 + 1;
            const obstacle = BABYLON.MeshBuilder.CreateBox(`obstacle_${i}`, {
                width: size,
                height: size * 2,
                depth: size
            }, this.scene);
            
            // Random position
            const x = (Math.random() - 0.5) * 80;
            const z = (Math.random() - 0.5) * 80;
            obstacle.position = new BABYLON.Vector3(x, size, z);
            
            // Physics
            obstacle.checkCollisions = true;
            obstacle.receiveShadows = true;
            
            // Random color
            const material = new BABYLON.StandardMaterial(`obstacleMat_${i}`, this.scene);
            material.diffuseColor = new BABYLON.Color3(
                Math.random() * 0.5 + 0.3,
                Math.random() * 0.5 + 0.3,
                Math.random() * 0.5 + 0.3
            );
            obstacle.material = material;
            
            // Add to shadow caster
            if (this.shadowGenerator) {
                this.shadowGenerator.addShadowCaster(obstacle);
            }
        }
    }
    
    setupWeather() {
        // Initialize weather system
        this.changeWeather('clear');
    }
    
    changeWeather(type) {
        // Clean up previous weather effects
        this.cleanupWeather();
        
        this.weather = type;
        console.log(`Weather changed to: ${type}`);
        
        switch (type) {
            case 'rain':
                this.createRain();
                this.weatherDuration = 300 + Math.random() * 600; // 5-15 minutes
                break;
                
            case 'snow':
                this.createSnow();
                this.weatherDuration = 600 + Math.random() * 900; // 10-25 minutes
                break;
                
            case 'storm':
                this.createRain(0.2); // Heavy rain
                this.createLightning();
                this.weatherDuration = 180 + Math.random() * 420; // 3-10 minutes
                break;
                
            default: // clear
                this.weather = 'clear';
                this.weatherDuration = 600 + Math.random() * 1200; // 10-35 minutes
                break;
        }
        
        this.weatherTimer = 0;
    }
    
    cleanupWeather() {
        // Remove all particle systems
        for (const system of this.particleSystems) {
            system.dispose();
        }
        this.particleSystems = [];
    }
    
    createRain(intensity = 0.1) {
        // Create rain particle system
        const rain = new BABYLON.ParticleSystem('rain', 5000, this.scene);
        
        // Texture for rain
        rain.particleTexture = new BABYLON.Texture('assets/textures/rain.png', this.scene);
        
        // Where the particles come from
        rain.emitter = new BABYLON.Vector3(0, 50, 0);
        rain.minEmitBox = new BABYLON.Vector3(-100, 0, -100);
        rain.maxEmitBox = new BABYLON.Vector3(100, 0, 100);
        
        // Colors of all particles
        rain.color1 = new BABYLON.Color4(0.8, 0.8, 1.0, 1.0);
        rain.color2 = new BABYLON.Color4(0.8, 0.8, 1.0, 1.0);
        rain.colorDead = new BABYLON.Color4(0, 0, 0.2, 0.0);
        
        // Size of each particle
        rain.minSize = 0.1;
        rain.maxSize = 0.2;
        
        // Life time of each particle
        rain.minLifeTime = 1.0;
        rain.maxLifeTime = 2.0;
        
        // Emission rate
        rain.emitRate = 5000 * intensity;
        
        // Blend mode
        rain.blendMode = BABYLON.ParticleSystem.BLENDMODE_ONEONE;
        
        // Set the gravity of all particles
        rain.gravity = new BABYLON.Vector3(0, -9.81, 0);
        
        // Direction of each particle
        rain.direction1 = new BABYLON.Vector3(-1, -1, -1);
        rain.direction2 = new BABYLON.Vector3(1, -1, 1);
        
        // Power and speed
        rain.minEmitPower = 20;
        rain.maxEmitPower = 30;
        rain.updateSpeed = 0.01;
        
        // Start the particle system
        rain.start();
        
        this.particleSystems.push(rain);
    }
    
    createSnow() {
        // Similar to rain but with different parameters for snow
        const snow = new BABYLON.ParticleSystem('snow', 10000, this.scene);
        
        // Texture for snow
        snow.particleTexture = new BABYLON.Texture('assets/textures/snowflake.png', this.scene);
        
        // Where the particles come from
        snow.emitter = new BABYLON.Vector3(0, 50, 0);
        snow.minEmitBox = new BABYLON.Vector3(-100, 0, -100);
        snow.maxEmitBox = new BABYLON.Vector3(100, 0, 100);
        
        // Colors
        snow.color1 = new BABYLON.Color4(1, 1, 1, 0);
        snow.color2 = new BABYLON.Color4(1, 1, 1, 0.5);
        snow.colorDead = new BABYLON.Color4(1, 1, 1, 0);
        
        // Size
        snow.minSize = 0.1;
        snow.maxSize = 0.3;
        
        // Life time
        snow.minLifeTime = 5.0;
        snow.maxLifeTime = 10.0;
        
        // Emission rate
        snow.emitRate = 1000;
        
        // Blend mode
        snow.blendMode = BABYLON.ParticleSystem.BLENDMODE_ONEONE;
        
        // Gravity
        snow.gravity = new BABYLON.Vector3(0, -2, 0);
        
        // Direction
        snow.direction1 = new BABYLON.Vector3(-0.5, -0.5, -0.5);
        snow.direction2 = new BABYLON.Vector3(0.5, -1, 0.5);
        
        // Power and speed
        snow.minEmitPower = 0.5;
        snow.maxEmitPower = 1.0;
        snow.updateSpeed = 0.01;
        
        // Start the particle system
        snow.start();
        
        this.particleSystems.push(snow);
    }
    
    createLightning() {
        // Flash effect for lightning
        const flash = () => {
            const light = new BABYLON.HemisphericLight('lightning', new BABYLON.Vector3(0, 1, 0), this.scene);
            light.intensity = 1.5;
            
            // Fade out
            const fadeOut = () => {
                light.intensity -= 0.1;
                if (light.intensity > 0) {
                    setTimeout(fadeOut, 50);
                } else {
                    light.dispose();
                }
            };
            
            // Start fade out after a short delay
            setTimeout(fadeOut, 100);
        };
        
        // Random lightning strikes
        const strike = () => {
            if (this.weather === 'storm') {
                flash();
                const delay = 2000 + Math.random() * 5000;
                setTimeout(strike, delay);
            }
        };
        
        // Start lightning
        setTimeout(strike, 5000 + Math.random() * 10000);
    }
    
    setupTimeCycle() {
        // Update time of day every second
        setInterval(() => {
            this.timeOfDay += 0.01; // 1 game hour = 100 real seconds
            if (this.timeOfDay >= 24) {
                this.timeOfDay = 0;
                this.day++;
            }
            
            // Update lighting based on time of day
            this.updateTimeOfDay();
            
            // Check for weather changes
            this.weatherTimer++;
            if (this.weatherTimer >= this.weatherDuration) {
                this.changeRandomWeather();
            }
            
        }, 1000 / 60); // 60 times per second
    }
    
    updateTimeOfDay() {
        // Update sun position and intensity
        const angle = (this.timeOfDay / 24) * Math.PI * 2;
        const sunX = Math.cos(angle) * 100;
        const sunY = Math.sin(angle) * 100;
        
        // Update sun position
        this.sunLight.position = new BABYLON.Vector3(sunX, Math.max(10, sunY), 0);
        this.sunLight.direction = new BABYLON.Vector3(-sunX, -sunY, 0).normalize();
        
        // Update light intensity and color based on time of day
        let intensity = 0;
        let color = new BABYLON.Color3(1, 1, 1);
        
        if (this.timeOfDay >= 5 && this.timeOfDay < 8) {
            // Dawn
            const t = (this.timeOfDay - 5) / 3;
            intensity = t * 0.8 + 0.2;
            color = new BABYLON.Color3(1, 0.8 + t * 0.2, 0.6 + t * 0.4);
        } else if (this.timeOfDay >= 8 && this.timeOfDay < 18) {
            // Day
            intensity = 1.0;
            color = new BABYLON.Color3(1, 0.95, 0.84);
        } else if (this.timeOfDay >= 18 && this.timeOfDay < 20) {
            // Dusk
            const t = (this.timeOfDay - 18) / 2;
            intensity = 0.8 - t * 0.6;
            color = new BABYLON.Color3(1, 0.8 - t * 0.4, 0.6 - t * 0.3);
        } else {
            // Night
            intensity = 0.2;
            color = new BABYLON.Color3(0.4, 0.5, 0.8);
        }
        
        // Apply weather effects
        if (this.weather === 'rain' || this.weather === 'storm') {
            intensity *= 0.7;
            color = new BABYLON.Color3(
                color.r * 0.8,
                color.g * 0.8,
                color.b * 0.9
            );
        } else if (this.weather === 'snow') {
            intensity *= 0.9;
        }
        
        // Update lights
        this.sunLight.intensity = intensity;
        this.sunLight.diffuse = color;
        this.ambientLight.intensity = intensity * 0.5;
        
        // Update skybox
        this.updateSkybox();
    }
    
    changeRandomWeather() {
        const weatherTypes = ['clear', 'rain', 'snow', 'storm'];
        let newWeather = this.weather;
        
        // Make sure we don't get the same weather twice in a row
        while (newWeather === this.weather) {
            const random = Math.random();
            if (random < 0.5) {
                newWeather = 'clear';
            } else if (random < 0.8) {
                newWeather = 'rain';
            } else if (random < 0.95) {
                newWeather = 'snow';
            } else {
                newWeather = 'storm';
            }
        }
        
        this.changeWeather(newWeather);
    }
    
    async loadNPCs() {
        // In a real game, this would load NPC data from a server or file
        // For now, we'll create some placeholder NPCs
        
        const npcData = [
            { id: 'merchant_1', name: 'Blacksmith', type: 'merchant', position: { x: 10, y: 0, z: 5 }, items: ['sword', 'shield', 'armor'] },
            { id: 'quest_giver_1', name: 'Elder', type: 'quest_giver', position: { x: -5, y: 0, z: -8 }, quests: ['first_quest'] },
            { id: 'guard_1', name: 'Guard', type: 'guard', position: { x: 15, y: 0, z: 0 }, dialogue: 'Halt! The town is off limits to outsiders.' }
        ];
        
        for (const npc of npcData) {
            await this.createNPC(npc);
        }
    }
    
    async createNPC(data) {
        // Create NPC mesh
        const npc = BABYLON.MeshBuilder.CreateCylinder(`npc_${data.id}`, {
            height: 2,
            diameter: 0.8
        }, this.scene);
        
        npc.position = new BABYLON.Vector3(data.position.x, 1, data.position.z);
        
        // Set material based on type
        const material = new BABYLON.StandardMaterial(`npcMat_${data.id}`, this.scene);
        
        switch (data.type) {
            case 'merchant':
                material.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.8);
                break;
            case 'quest_giver':
                material.diffuseColor = new BABYLON.Color3(0.8, 0.6, 0.2);
                break;
            case 'guard':
                material.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2);
                break;
            default:
                material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        }
        
        npc.material = material;
        
        // Add to NPCs map
        this.npcs.set(data.id, {
            id: data.id,
            name: data.name,
            type: data.type,
            mesh: npc,
            data: data
        });
        
        // Add shadow
        if (this.shadowGenerator) {
            this.shadowGenerator.addShadowCaster(npc);
        }
        
        // Add interaction
        npc.actionManager = new BABYLON.ActionManager(this.scene);
        npc.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnPickTrigger,
                () => this.onNPCInteract(data.id)
            )
        );
        
        return npc;
    }
    
    async loadQuests() {
        // In a real game, this would load quest data from a server or file
        this.quests.set('first_quest', {
            id: 'first_quest',
            name: 'First Steps',
            description: 'Talk to the Elder to begin your journey.',
            objectives: [
                { type: 'talk', target: 'quest_giver_1', completed: false }
            ],
            rewards: { xp: 100, items: [{ id: 'health_potion', quantity: 3 }] },
            requiredLevel: 1
        });
    }
    
    async loadWorldData() {
        // Load additional world data (terrain, objects, etc.)
        // This would be expanded in a real game
    }
    
    onNPCInteract(npcId) {
        const npc = this.npcs.get(npcId);
        if (!npc) return;
        
        console.log(`Interacting with ${npc.name}`);
        
        // Handle different NPC types
        switch (npc.type) {
            case 'merchant':
                this.openMerchantUI(npc);
                break;
                
            case 'quest_giver':
                this.startQuestDialogue(npc);
                break;
                
            case 'guard':
                this.showDialogue(npc, npc.data.dialogue || `I'm a ${npc.name}. Move along.`);
                break;
                
            default:
                this.showDialogue(npc, `Hello! I'm ${npc.name}.`);
        }
    }
    
    openMerchantUI(npc) {
        // In a real game, this would open a shop UI
        console.log(`Opening ${npc.name}'s shop`);
        // Show merchant UI with items for sale
        if (window.game && window.game.ui) {
            window.game.ui.showMerchantUI(npc);
        }
    }
    
    startQuestDialogue(npc) {
        // Check for available quests
        const availableQuests = this.getAvailableQuests(npc);
        
        if (availableQuests.length > 0) {
            // Start the first available quest
            const quest = availableQuests[0];
            this.showDialogue(npc, this.getQuestDialogue(quest.id, 'start'));
            
            // Add to player's active quests
            if (window.game && window.game.player) {
                window.game.player.activeQuests.push(quest.id);
            }
        } else {
            // No quests available
            this.showDialogue(npc, 'Come back later, I might have more work for you.');
        }
    }
    
    getAvailableQuests(npc) {
        // In a real game, this would check which quests the player can accept
        const available = [];
        
        for (const quest of this.quests.values()) {
            // Check if quest is already completed or in progress
            if (window.game && window.game.player) {
                if (window.game.player.completedQuests.includes(quest.id) || 
                    window.game.player.activeQuests.includes(quest.id)) {
                    continue;
                }
            }
            
            // Check if this NPC gives this quest
            if (npc.data.quests && npc.data.quests.includes(quest.id)) {
                available.push(quest);
            }
        }
        
        return available;
    }
    
    getQuestDialogue(questId, stage) {
        // In a real game, this would return dialogue based on quest and stage
        const quest = this.quests.get(questId);
        if (!quest) return '...';
        
        switch (stage) {
            case 'start':
                return `Ah, I have a task for you: ${quest.description} Will you accept?`;
            case 'complete':
                return `Well done! Here's your reward.`;
            default:
                return '...';
        }
    }
    
    showDialogue(npc, text) {
        // In a real game, this would show a dialogue UI
        console.log(`${npc.name}: ${text}`);
        if (window.game && window.game.ui) {
            window.game.ui.showDialogue(npc, text);
        }
    }
    
    update(deltaTime) {
        // Update NPCs
        for (const npc of this.npcs.values()) {
            // Simple idle animation
            if (npc.mesh) {
                npc.mesh.rotation.y += 0.01;
            }
        }
        
        // Update enemies
        for (const enemy of this.enemies.values()) {
            this.updateEnemy(enemy, deltaTime);
        }
    }
    
    spawnEnemy(type, position) {
        // In a real game, this would create an enemy of the specified type
        const enemyId = `enemy_${Date.now()}`;
        const enemy = {
            id: enemyId,
            type: type,
            health: 50,
            maxHealth: 50,
            damage: 10,
            attackSpeed: 1.0,
            lastAttack: 0,
            target: null,
            state: 'idle', // idle, chasing, attacking
            mesh: null,
            position: position || this.getRandomSpawnPoint()
        };
        
        // Create mesh
        enemy.mesh = this.createEnemyMesh(enemy);
        
        // Add to enemies map
        this.enemies.set(enemyId, enemy);
        
        return enemy;
    }
    
    createEnemyMesh(enemy) {
        // Create a simple enemy mesh
        const mesh = BABYLON.MeshBuilder.CreateCylinder(`enemy_${enemy.id}`, {
            height: 1.8,
            diameter: 0.8
        }, this.scene);
        
        // Position
        mesh.position = new BABYLON.Vector3(
            enemy.position.x,
            0.9,
            enemy.position.z
        );
        
        // Material
        const material = new BABYLON.StandardMaterial(`enemyMat_${enemy.id}`, this.scene);
        material.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2);
        mesh.material = material;
        
        // Add shadow
        if (this.shadowGenerator) {
            this.shadowGenerator.addShadowCaster(mesh);
        }
        
        // Add health bar
        this.createHealthBar(mesh, enemy.health, enemy.maxHealth);
        
        return mesh;
    }
    
    createHealthBar(mesh, currentHealth, maxHealth) {
        // In a real game, this would create a health bar above the entity
        // For now, we'll just log it
        console.log(`Health: ${currentHealth}/${maxHealth}`);
    }
    
    updateEnemy(enemy, deltaTime) {
        if (!enemy.mesh || !window.game || !window.game.player) return;
        
        const player = window.game.player;
        const distance = BABYLON.Vector3.Distance(
            enemy.mesh.position,
            player.mesh.position
        );
        
        // Simple AI
        if (distance < 15) {
            // Chase player
            enemy.state = 'chasing';
            
            // Move towards player
            const direction = player.mesh.position.subtract(enemy.mesh.position);
            direction.normalize();
            direction.scaleInPlace(2.0 * deltaTime);
            
            enemy.mesh.position.addInPlace(direction);
            enemy.mesh.lookAt(player.mesh.position);
            
            // Attack if close enough
            if (distance < 2) {
                enemy.state = 'attacking';
                this.enemyAttack(enemy, player);
            }
        } else {
            enemy.state = 'idle';
        }
    }
    
    enemyAttack(enemy, target) {
        const now = Date.now();
        if (now - enemy.lastAttack < 1000 / enemy.attackSpeed) return;
        
        enemy.lastAttack = now;
        
        // Deal damage to player
        if (target.takeDamage) {
            target.takeDamage(enemy.damage);
            console.log(`${enemy.type} hits you for ${enemy.damage} damage!`);
        }
    }
    
    getRandomSpawnPoint() {
        // In a real game, this would return a valid spawn point
        const x = (Math.random() - 0.5) * 80;
        const z = (Math.random() - 0.5) * 80;
        return { x, y: 0, z };
    }
    
    // Clean up
    dispose() {
        // Clean up resources
        if (this.skybox) this.skybox.dispose();
        if (this.sunLight) this.sunLight.dispose();
        if (this.ambientLight) this.ambientLight.dispose();
        if (this.terrain) this.terrain.dispose();
        
        // Clean up NPCs
        for (const npc of this.npcs.values()) {
            if (npc.mesh) npc.mesh.dispose();
        }
        this.npcs.clear();
        
        // Clean up enemies
        for (const enemy of this.enemies.values()) {
            if (enemy.mesh) enemy.mesh.dispose();
        }
        this.enemies.clear();
        
        // Clean up weather effects
        this.cleanupWeather();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = World;
}
