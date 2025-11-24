// ============================================================
// HEROES OF SHADY GROVE - ENHANCED GAME SYSTEMS v3.0
// Includes: Loot, Quests, Inventory, Sound, Skills, Bosses
// ============================================================

// Initialize GameSystems if it doesn't exist
if (!window.GameSystems) {
    window.GameSystems = {
        npcManager: null,
        combat: null,
        init: function() { console.log("GameSystems initialized"); }
    };
}

// ==================== SOUND SYSTEM ====================
class SoundSystem {
  constructor() {
    this.sounds = new Map();
    this.enabled = true;
    this.volume = 0.3;
    this.initSounds();
  }

  initSounds() {
    // Free sound effects from freesound.org via CDN
    this.sounds.set('hit', 'https://assets.mixkit.co/active_storage/sfx/2564/2564-preview.mp3');
    this.sounds.set('levelup', 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3');
    this.sounds.set('loot', 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3');
    this.sounds.set('quest', 'https://assets.mixkit.co/active_storage/sfx/1469/1469-preview.mp3');
    this.sounds.set('death', 'https://assets.mixkit.co/active_storage/sfx/2488/2488-preview.mp3');
    this.sounds.set('skill', 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
  }

  play(soundKey) {
    if (!this.enabled) return;
    try {
      const audio = new Audio(this.sounds.get(soundKey));
      audio.volume = this.volume;
      audio.play().catch(() => {});
    } catch (e) {
      console.warn('Failed to play sound:', e);
    }
  }
}

// ==================== LOOT SYSTEM ====================
class LootSystem {
  constructor(scene) {
    this.scene = scene;
    this.lootTables = this.initLootTables();
  }

  initLootTables() {
    return {
      common: [
        { type: 'gold', amount: [5, 15], chance: 1.0 },
        { type: 'potion_health', amount: 1, chance: 0.3 },
        { type: 'potion_mana', amount: 1, chance: 0.2 }
      ],
      // ... rest of the loot tables ...
    };
  }
  // ... rest of the LootSystem class ...
}

// ==================== INVENTORY SYSTEM ====================
class InventorySystem {
  constructor() {
    this.items = [];
    this.maxSlots = 30;
    this.gold = 0;
    this.equipped = {
      weapon: null,
      armor: null,
      accessory: null
    };
  }
  // ... rest of the InventorySystem class ...
}

// ==================== QUEST SYSTEM ====================
class QuestSystem {
  constructor() {
    this.activeQuests = [];
    this.completedQuests = new Set();
  }
  // ... rest of the QuestSystem class ...
}

// ==================== SKILL TREE SYSTEM ====================
class SkillTreeSystem {
  constructor() {
    this.unlockedSkills = new Set([1]); // Basic attack unlocked by default
    this.skillPoints = 0;
    this.skills = this.initSkills();
  }
  // ... rest of the SkillTreeSystem class ...
}

// ==================== ENHANCED COMBAT SYSTEM ====================
class CombatSystem {
  constructor(scene, supabase, soundSystem) {
    this.scene = scene;
    this.supabase = supabase;
    this.sound = soundSystem;
    this.cooldowns = new Map();
    this.skills = new Map([
      [1, { id: 1, name: "Basic Attack", baseDamage: 10, mpCost: 0, cooldown: 1500, particleEffect: "physical" }],
      [2, { id: 2, name: "Fireball", baseDamage: 25, mpCost: 15, cooldown: 3000, particleEffect: "fire" }],
      [3, { id: 3, name: "Ice Shard", baseDamage: 20, mpCost: 12, cooldown: 2500, particleEffect: "ice" }],
      [4, { id: 4, name: "Lightning Strike", baseDamage: 30, mpCost: 20, cooldown: 4000, particleEffect: "lightning" }]
    ]);
    this.comboCounter = 0;
    this.lastHitTime = 0;
  }
  // ... rest of the CombatSystem class ...
}

// ==================== ENHANCED NPC MANAGER ====================
class NPCManager {
  constructor(scene, supabase, combatSystem) {
    this.scene = scene;
    this.supabase = supabase;
    this.combat = combatSystem;
    this.npcs = new Map();
    this.enemies = new Map();
    this.aiUpdateInterval = 200;
    this.lastAIUpdate = 0;
    
    if (typeof AssetLoader !== 'undefined' && !window.assetLoaderInstance) {
      window.assetLoaderInstance = new AssetLoader(scene);
    }
  }

  async createTestEnemy(id, position, name = "Test Wolf", level = 3, isBoss = false) {
    const scene = this.scene;
    let root, body, head, animationGroups = [];
    
    try {
      // Try to load the model
      const model = await window.assetLoaderInstance.loadAsset(name.toLowerCase().replace(/\s+/g, '_'));
      root = model.meshes[0].clone(`enemy_${id}`);
      body = root.getChildren()[0];
      head = body.getChildren().find(m => m.name.toLowerCase().includes('head')) || body;
      animationGroups = model.animationGroups || [];
    } catch (error) {
      console.warn(`Failed to load model for ${name}, using fallback`, error);
      // Create fallback geometry
      root = new BABYLON.TransformNode(`enemy_${id}`, scene);
      body = BABYLON.MeshBuilder.CreateBox(`enemy_${id}_body`, { width: 0.8, height: 1.6, depth: 0.8 }, scene);
      body.parent = root;
      head = BABYLON.MeshBuilder.CreateSphere(`enemy_${id}_head`, { diameter: 0.6 }, scene);
      head.position.y = 1;
      head.parent = body;
    }

    root.position = position.clone();
    const multiplier = isBoss ? 5 : 1;
    const nameplate = this.createNameplate(root, name, level, isBoss ? "boss" : "hostile");
    const healthBar = this.createHealthBar(root);
    
    const enemy = {
      id,
      name,
      level,
      faction: isBoss ? "boss" : "hostile",
      type: "enemy",
      isBoss,
      stats: {
        level,
        hp: (50 + level * 20) * multiplier,
        maxHp: (50 + level * 20) * multiplier,
        mp: 30 * multiplier,
        maxMp: 30 * multiplier,
        attack: (5 + level * 2) * multiplier,
        defense: (3 + level) * multiplier,
        speed: isBoss ? 0.05 : 0.08,
        attackRange: isBoss ? 5 : 2.5,
        xp: 0
      },
      position: root.position,
      ai: {
        state: "idle",
        target: null,
        homePosition: root.position.clone(),
        wanderRadius: isBoss ? 5 : 10,
        aggroRadius: isBoss ? 25 : 15,
        leashRadius: isBoss ? 40 : 30,
        lastAction: 0,
        actionCooldown: isBoss ? 2000 : 1500
      },
      mesh: { root, body, head, nameplate, healthBar },
      animationGroups: animationGroups,
      currentAnimation: null
    };

    this.enemies.set(id, enemy);
    return enemy;
  }

  createNameplate(parent, name, level, type) {
    // Implementation for nameplate creation
    // ...
  }

  createHealthBar(parent) {
    // Implementation for health bar creation
    // ...
  }
}

// ==================== SHADOW SYSTEM ====================
let shadowGenerator = null;

function setupShadows(scene) {
    if (!scene) {
        console.warn("No scene provided for shadow setup");
        return null;
    }

    try {
        // Create a directional light if none exists
        let light = scene.lights.find(l => l instanceof BABYLON.DirectionalLight);
        
        if (!light) {
            console.log("Creating directional light for shadows...");
            light = new BABYLON.DirectionalLight("shadowLight", new BABYLON.Vector3(-1, -2, -1), scene);
            light.position = new BABYLON.Vector3(0, 20, 0);
            light.intensity = 0.8;
        }

        shadowGenerator = new BABYLON.ShadowGenerator(1024, light);
        shadowGenerator.useBlurExponentialShadowMap = true;
        shadowGenerator.blurKernel = 16;
        shadowGenerator.forceBackFacesOnly = true;
        shadowGenerator.bias = 0.0001;
        
        console.log("Shadow system initialized");
        return shadowGenerator;
    } catch (error) {
        console.warn("Shadow initialization failed, continuing without shadows:", error);
        return null;
    }
}

// Initialize shadows when the scene is ready
if (window.GameSystems.init) {
    const originalInit = window.GameSystems.init;
    window.GameSystems.init = function(scene, supabase) {
        const result = originalInit.call(this, scene, supabase);
        // Delay shadow setup to ensure scene is fully initialized
        setTimeout(() => setupShadows(scene), 500);
        return result;
    };
}

// ==================== TARGETING SYSTEM ====================
function targetNearestEnemy() {
    if (!window.GameSystems || !window.GameSystems.npcManager) {
        console.warn("NPC Manager not available for targeting");
        return;
    }

    const enemies = Array.from(window.GameSystems.npcManager.enemies.values());
    if (enemies.length === 0) {
        console.log("No enemies to target");
        return;
    }

    // Get player position (assuming it's available in window.player or similar)
    const playerPos = window.player ? window.player.position : new BABYLON.Vector3(0, 0, 0);
    
    // Find the closest enemy
    let closestEnemy = null;
    let closestDistance = Infinity;
    
    for (const enemy of enemies) {
        if (enemy.mesh && enemy.mesh.root) {
            const distance = BABYLON.Vector3.Distance(playerPos, enemy.mesh.root.position);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemy;
            }
        }
    }

    if (closestEnemy) {
        console.log(`Targeting ${closestEnemy.name} (${closestDistance.toFixed(1)}m away)`);
        // Highlight the target (implement this function)
        highlightTarget(closestEnemy);
        return closestEnemy;
    }
    
    return null;
}

// Make it globally available
window.targetNearestEnemy = targetNearestEnemy;

// Update the existing CombatSystem's handleDeath method
if (window.GameSystems.combat && window.GameSystems.combat.handleDeath) {
    const originalHandleDeath = window.GameSystems.combat.handleDeath;
    window.GameSystems.combat.handleDeath = function(defender, attacker) {
        // Save the old level before calling the original function
        const oldLevel = attacker.stats ? attacker.stats.level : 1;
        
        // Call the original function
        const result = originalHandleDeath.call(this, defender, attacker);
        
        // Your custom logic here, now with access to oldLevel
        if (attacker.stats && attacker.stats.level > oldLevel) {
            console.log(`Level up! ${attacker.name} is now level ${attacker.stats.level}`);
            if (window.GameSystems.sound) {
                window.GameSystems.sound.play('levelup');
            }
        }
        
        return result;
    };
}

console.log("[HOSG] Enhanced game systems loaded v3.0");
