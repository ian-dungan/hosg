// ============================================================
// HEROES OF SHADY GROVE - ADVANCED FEATURES v3.0
// Day/Night, Dungeons, Crafting, PvP, Achievements
// Add to your game after enhanced systems
// ============================================================

// ==================== DAY/NIGHT CYCLE ====================
class DayNightSystem {
  constructor(scene) {
    this.scene = scene;
    this.timeOfDay = 12; // 0-24 hours
    this.timeScale = 1; // 1 real minute = 1 game hour
    this.sun = scene.lights.find(l => l.name === 'sun');
    this.hemi = scene.lights.find(l => l.name === 'hemi');
  }

  update(deltaTime) {
    this.timeOfDay += (deltaTime / 60000) * this.timeScale;
    if (this.timeOfDay >= 24) this.timeOfDay = 0;

    const hour = Math.floor(this.timeOfDay);
    this.updateLighting(hour);
    this.updateAmbience(hour);
  }

  updateLighting(hour) {
    if (!this.sun || !this.hemi) return;

    if (hour >= 6 && hour <= 18) {
      // Day
      const dayProgress = (hour - 6) / 12;
      this.sun.intensity = Math.sin(dayProgress * Math.PI) * 1.2;
      this.hemi.intensity = 0.7;
      
      const r = 0.5 + dayProgress * 0.3;
      const g = 0.7 - Math.abs(dayProgress - 0.5) * 0.2;
      const b = 0.9 - dayProgress * 0.2;
      this.scene.clearColor = new BABYLON.Color3(r, g, b);
    } else {
      // Night
      this.sun.intensity = 0.15;
      this.hemi.intensity = 0.2;
      this.scene.clearColor = new BABYLON.Color3(0.05, 0.05, 0.15);
    }
  }

  updateAmbience(hour) {
    // Spawn more dangerous enemies at night
    if (hour === 0 || hour === 20) {
      console.log('[DayNight] Night time - spawning nocturnal enemies');
      // Trigger night spawn event
      if (window.GameSystems?.events) {
        window.GameSystems.events.trigger('night_spawn');
      }
    }
  }

  getTimeString() {
    const hour = Math.floor(this.timeOfDay);
    const minute = Math.floor((this.timeOfDay - hour) * 60);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    return `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}`;
  }

  isNight() {
    const hour = Math.floor(this.timeOfDay);
    return hour < 6 || hour >= 20;
  }
}

// ==================== DUNGEON SYSTEM ====================
class DungeonSystem {
  constructor(scene, npcManager) {
    this.scene = scene;
    this.npcManager = npcManager;
    this.dungeons = this.initDungeons();
    this.activeDungeon = null;
    this.returnPosition = null;
  }

  initDungeons() {
    return [
      {
        id: 'cave_1',
        name: 'Dark Cave',
        level: 5,
        entrance: new BABYLON.Vector3(30, 0, -30),
        interior: new BABYLON.Vector3(200, 0, 200),
        enemies: [
          { type: 'goblin', count: 5, level: 5 },
          { type: 'spider', count: 3, level: 7 }
        ],
        boss: { type: 'goblin', name: 'Goblin Chief', level: 10 },
        rewards: { gold: 200, xp: 500, item: 'weapon_rare' }
      },
      {
        id: 'crypt_1',
        name: 'Ancient Crypt',
        level: 15,
        entrance: new BABYLON.Vector3(-40, 0, 40),
        interior: new BABYLON.Vector3(300, 0, 300),
        enemies: [
          { type: 'skeleton', count: 8, level: 15 },
          { type: 'ghost', count: 4, level: 18 }
        ],
        boss: { type: 'skeleton', name: 'Lich Lord', level: 20 },
        rewards: { gold: 500, xp: 1500, item: 'armor_legendary' }
      }
    ];
  }

  createEntrancePortal(dungeon) {
    const scene = this.scene;
    const portal = BABYLON.MeshBuilder.CreateCylinder('portal', {
      height: 5, diameter: 3, tessellation: 32
    }, scene);
    
    portal.position = dungeon.entrance;
    portal.rotation.x = Math.PI / 2;

    const mat = new BABYLON.StandardMaterial('portalMat', scene);
    mat.emissiveColor = new BABYLON.Color3(0.5, 0, 1);
    mat.alpha = 0.6;
    portal.material = mat;

    // Rotate animation
    let time = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      time += scene.getEngine().getDeltaTime() / 1000;
      portal.rotation.y = time;
      mat.alpha = 0.5 + Math.sin(time * 3) * 0.1;
    });

    portal.metadata = {
      isDungeonPortal: true,
      dungeonId: dungeon.id,
      observer: obs
    };

    return portal;
  }

  async enterDungeon(dungeonId, playerBody) {
    const dungeon = this.dungeons.find(d => d.id === dungeonId);
    if (!dungeon || this.activeDungeon) return;

    this.returnPosition = playerBody.position.clone();
    this.activeDungeon = dungeon;

    playerBody.position = dungeon.interior.clone();

    // Create dungeon environment
    this.createDungeonEnvironment(dungeon);
    
    // Spawn enemies
    await this.spawnDungeonEnemies(dungeon);

    console.log(`[Dungeon] Entered ${dungeon.name}`);
    if (window.showNotification) {
      showNotification(`Entered ${dungeon.name} - Level ${dungeon.level}`);
    }
  }

  createDungeonEnvironment(dungeon) {
    const scene = this.scene;
    const center = dungeon.interior;

    // Dark lighting
    if (scene.lights) {
      scene.lights.forEach(light => {
        if (light.name === 'sun') light.intensity = 0.3;
        if (light.name === 'hemi') light.intensity = 0.2;
      });
    }

    // Fog
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.015;
    scene.fogColor = new BABYLON.Color3(0.1, 0.1, 0.15);

    // Dungeon floor
    const floor = BABYLON.MeshBuilder.CreateGround('dungeon_floor', {
      width: 80, height: 80
    }, scene);
    floor.position = center.clone();
    
    const floorMat = new BABYLON.StandardMaterial('dungeonFloorMat', scene);
    floorMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.25);
    floor.material = floorMat;
    floor.checkCollisions = true;

    // Walls
    for (let i = 0; i < 4; i++) {
      const wall = BABYLON.MeshBuilder.CreateBox('wall', {
        width: 80, height: 10, depth: 2
      }, scene);
      
      const angle = (Math.PI / 2) * i;
      wall.position = center.add(new BABYLON.Vector3(
        Math.cos(angle) * 40,
        5,
        Math.sin(angle) * 40
      ));
      wall.rotation.y = angle;
      
      const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
      wallMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.35);
      wall.material = wallMat;
      wall.checkCollisions = true;
    }

    // Torches
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 4) * i;
      const torchPos = center.add(new BABYLON.Vector3(
        Math.cos(angle) * 35,
        3,
        Math.sin(angle) * 35
      ));
      
      const torch = new BABYLON.PointLight('torch_' + i, torchPos, scene);
      torch.intensity = 0.5;
      torch.diffuse = new BABYLON.Color3(1, 0.6, 0.2);
    }
  }

  async spawnDungeonEnemies(dungeon) {
    const center = dungeon.interior;
    
    // Regular enemies
    for (const enemyGroup of dungeon.enemies) {
      for (let i = 0; i < enemyGroup.count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 10 + Math.random() * 25;
        const pos = center.add(new BABYLON.Vector3(
          Math.cos(angle) * distance,
          0,
          Math.sin(angle) * distance
        ));

        await this.npcManager.createTestEnemy(
          `dungeon_${dungeon.id}_${enemyGroup.type}_${i}`,
          pos,
          enemyGroup.type.charAt(0).toUpperCase() + enemyGroup.type.slice(1),
          enemyGroup.level
        );
      }
    }

    // Boss
    if (dungeon.boss) {
      const bossPos = center.clone();
      await this.npcManager.createTestEnemy(
        `boss_${dungeon.id}`,
        bossPos,
        dungeon.boss.name,
        dungeon.boss.level,
        true
      );
    }
  }

  exitDungeon(playerBody) {
    if (!this.activeDungeon || !this.returnPosition) return;

    playerBody.position = this.returnPosition.clone();
    
    // Clean up dungeon meshes
    const scene = this.scene;
    scene.meshes.filter(m => m.name.includes('dungeon_')).forEach(m => m.dispose());
    scene.lights.filter(l => l.name.includes('torch_')).forEach(l => l.dispose());

    // Restore lighting
    if (scene.lights) {
      scene.lights.forEach(light => {
        if (light.name === 'sun') light.intensity = 1.2;
        if (light.name === 'hemi') light.intensity = 0.7;
      });
    }

    scene.fogMode = BABYLON.Scene.FOGMODE_NONE;

    console.log(`[Dungeon] Exited ${this.activeDungeon.name}`);
    this.activeDungeon = null;
    this.returnPosition = null;
  }
}

// ==================== CRAFTING SYSTEM ====================
class CraftingSystem {
  constructor() {
    this.recipes = this.initRecipes();
    this.craftingStations = ['forge', 'alchemy', 'woodworking'];
  }

  initRecipes() {
    return [
      {
        id: 'iron_sword',
        name: 'Iron Sword',
        station: 'forge',
        requires: { iron_ore: 3, wood: 2, coal: 1 },
        produces: {
          type: 'weapon_sword',
          name: 'Iron Sword',
          level: 5,
          stats: { attack: 15 }
        },
        time: 5000
      },
      {
        id: 'steel_armor',
        name: 'Steel Armor',
        station: 'forge',
        requires: { steel_ingot: 5, leather: 3 },
        produces: {
          type: 'armor_chest',
          name: 'Steel Armor',
          level: 10,
          stats: { defense: 20, hp: 50 }
        },
        time: 10000
      },
      {
        id: 'health_potion',
        name: 'Health Potion',
        station: 'alchemy',
        requires: { red_herb: 2, water: 1 },
        produces: {
          type: 'potion_health',
          name: 'Health Potion',
          amount: 1,
          healing: 50
        },
        time: 3000
      },
      {
        id: 'mana_potion',
        name: 'Mana Potion',
        station: 'alchemy',
        requires: { blue_herb: 2, water: 1 },
        produces: {
          type: 'potion_mana',
          name: 'Mana Potion',
          amount: 1,
          restore: 30
        },
        time: 3000
      },
      {
        id: 'wooden_bow',
        name: 'Wooden Bow',
        station: 'woodworking',
        requires: { wood: 4, string: 2 },
        produces: {
          type: 'weapon_bow',
          name: 'Wooden Bow',
          level: 3,
          stats: { attack: 12, range: 20 }
        },
        time: 4000
      }
    ];
  }

  canCraft(recipeId, inventory) {
    const recipe = this.recipes.find(r => r.id === recipeId);
    if (!recipe) return false;

    for (const [material, amount] of Object.entries(recipe.requires)) {
      const count = inventory.items.filter(i => i.type === material).length;
      if (count < amount) return false;
    }

    return true;
  }

  async craft(recipeId, inventory) {
    const recipe = this.recipes.find(r => r.id === recipeId);
    if (!recipe || !this.canCraft(recipeId, inventory)) {
      return { success: false, reason: 'Cannot craft - missing materials' };
    }

    // Remove materials
    for (const [material, amount] of Object.entries(recipe.requires)) {
      for (let i = 0; i < amount; i++) {
        const index = inventory.items.findIndex(item => item.type === material);
        if (index >= 0) {
          inventory.removeItem(index);
        }
      }
    }

    // Crafting time
    await new Promise(resolve => setTimeout(resolve, recipe.time));

    // Add crafted item
    const success = inventory.addItem(recipe.produces);

    return {
      success,
      item: recipe.produces,
      reason: success ? 'Crafted successfully!' : 'Inventory full'
    };
  }
}

// ==================== PVP SYSTEM ====================
class PvPSystem {
  constructor(scene, combat) {
    this.scene = scene;
    this.combat = combat;
    this.arenaZone = { center: new BABYLON.Vector3(0, 0, -100), radius: 30 };
    this.challenges = new Map();
    this.inCombat = new Set();
  }

  isInArena(position) {
    const dist = BABYLON.Vector3.Distance(position, this.arenaZone.center);
    return dist <= this.arenaZone.radius;
  }

  challengePlayer(challengerId, targetId) {
    if (this.challenges.has(targetId)) {
      return { success: false, reason: 'Player already challenged' };
    }

    this.challenges.set(targetId, {
      challenger: challengerId,
      time: Date.now(),
      timeout: 30000 // 30 seconds to accept
    });

    return { success: true };
  }

  acceptChallenge(targetId, challengerId) {
    const challenge = this.challenges.get(targetId);
    if (!challenge || challenge.challenger !== challengerId) {
      return { success: false, reason: 'No valid challenge' };
    }

    this.challenges.delete(targetId);
    this.inCombat.add(challengerId);
    this.inCombat.add(targetId);

    // Teleport both to arena
    return { success: true };
  }

  endCombat(player1Id, player2Id, winner) {
    this.inCombat.delete(player1Id);
    this.inCombat.delete(player2Id);
    
    // Award winner
    return {
      winner,
      rewards: { gold: 100, xp: 200, rating: 10 }
    };
  }
}

// ==================== ACHIEVEMENT SYSTEM ====================
class AchievementSystem {
  constructor() {
    this.achievements = this.initAchievements();
    this.unlocked = new Set();
    this.progress = new Map();
  }

  initAchievements() {
    return [
      {
        id: 'first_blood',
        name: 'First Blood',
        description: 'Defeat your first enemy',
        type: 'kill',
        requirement: 1,
        reward: { gold: 50, title: 'Rookie' }
      },
      {
        id: 'wolf_slayer',
        name: 'Wolf Slayer',
        description: 'Defeat 100 wolves',
        type: 'kill_wolf',
        requirement: 100,
        reward: { gold: 500, title: 'Wolf Hunter' }
      },
      {
        id: 'level_10',
        name: 'Experienced',
        description: 'Reach level 10',
        type: 'level',
        requirement: 10,
        reward: { gold: 200, skill_points: 3 }
      },
      {
        id: 'treasure_hunter',
        name: 'Treasure Hunter',
        description: 'Loot 500 items',
        type: 'loot',
        requirement: 500,
        reward: { gold: 1000 }
      },
      {
        id: 'boss_slayer',
        name: 'Boss Slayer',
        description: 'Defeat 10 boss enemies',
        type: 'boss_kill',
        requirement: 10,
        reward: { gold: 2000, title: 'Champion' }
      },
      {
        id: 'rich',
        name: 'Wealthy',
        description: 'Accumulate 10,000 gold',
        type: 'gold',
        requirement: 10000,
        reward: { title: 'Merchant Prince' }
      },
      {
        id: 'crafter',
        name: 'Master Crafter',
        description: 'Craft 50 items',
        type: 'craft',
        requirement: 50,
        reward: { gold: 1500, title: 'Artisan' }
      }
    ];
  }

  updateProgress(type, value) {
    for (const achievement of this.achievements) {
      if (achievement.type === type && !this.unlocked.has(achievement.id)) {
        const current = this.progress.get(achievement.id) || 0;
        const newProgress = current + value;
        this.progress.set(achievement.id, newProgress);

        if (newProgress >= achievement.requirement) {
          this.unlock(achievement.id);
        }
      }
    }
  }

  unlock(achievementId) {
    if (this.unlocked.has(achievementId)) return;

    const achievement = this.achievements.find(a => a.id === achievementId);
    if (!achievement) return;

    this.unlocked.add(achievementId);
    
    console.log(`[Achievement] Unlocked: ${achievement.name}`);
    
    if (window.GameSystems?.sound) {
      window.GameSystems.sound.play('levelup');
    }
    
    if (window.showNotification) {
      showNotification(`🏆 Achievement: ${achievement.name}`);
    }

    return achievement.reward;
  }

  getProgress(achievementId) {
    const achievement = this.achievements.find(a => a.id === achievementId);
    if (!achievement) return null;

    return {
      current: this.progress.get(achievementId) || 0,
      required: achievement.requirement,
      unlocked: this.unlocked.has(achievementId)
    };
  }
}

// ==================== EVENT SYSTEM ====================
class EventSystem {
  constructor() {
    this.listeners = new Map();
  }

  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);
  }

  trigger(eventName, data = {}) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }
}

// ==================== INITIALIZE ADVANCED SYSTEMS ====================
window.AdvancedSystems = {
  dayNight: null,
  dungeons: null,
  crafting: null,
  pvp: null,
  achievements: null,
  events: null,

  init: function(scene, npcManager, combat) {
    this.dayNight = new DayNightSystem(scene);
    this.dungeons = new DungeonSystem(scene, npcManager);
    this.crafting = new CraftingSystem();
    this.pvp = new PvPSystem(scene, combat);
    this.achievements = new AchievementSystem();
    this.events = new EventSystem();

    // Set up event listeners
    this.setupEventListeners();

    // Create dungeon portals
    this.dungeons.dungeons.forEach(dungeon => {
      this.dungeons.createEntrancePortal(dungeon);
    });

    console.log('[Advanced] All advanced systems initialized');
  },

  setupEventListeners: function() {
    // Achievement tracking
    this.events.on('enemy_killed', (data) => {
      this.achievements.updateProgress('kill', 1);
      if (data.enemyType) {
        this.achievements.updateProgress(`kill_${data.enemyType}`, 1);
      }
      if (data.isBoss) {
        this.achievements.updateProgress('boss_kill', 1);
      }
    });

    this.events.on('item_looted', () => {
      this.achievements.updateProgress('loot', 1);
    });

    this.events.on('item_crafted', () => {
      this.achievements.updateProgress('craft', 1);
    });

    this.events.on('level_up', (data) => {
      this.achievements.updateProgress('level', 1);
    });

    this.events.on('gold_gained', (data) => {
      this.achievements.updateProgress('gold', data.amount);
    });
  },

  update: function(deltaTime) {
    if (this.dayNight) {
      this.dayNight.update(deltaTime);
    }
  }
};

console.log('[Advanced] Advanced systems loaded v3.0');
