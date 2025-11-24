// ============================================================
// HEROES OF SHADY GROVE - ENHANCED GAME SYSTEMS v3.0
// Includes: Loot, Quests, Inventory, Sound, Skills, Bosses
// ============================================================

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
    } catch (e) {}
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
      uncommon: [
        { type: 'gold', amount: [20, 50], chance: 1.0 },
        { type: 'weapon_sword', level: [1, 5], chance: 0.15 },
        { type: 'armor_chest', level: [1, 5], chance: 0.15 },
        { type: 'gem_small', amount: 1, chance: 0.1 }
      ],
      rare: [
        { type: 'gold', amount: [50, 150], chance: 1.0 },
        { type: 'weapon_sword', level: [5, 15], chance: 0.3 },
        { type: 'armor_chest', level: [5, 15], chance: 0.3 },
        { type: 'gem_large', amount: 1, chance: 0.2 }
      ],
      boss: [
        { type: 'gold', amount: [200, 500], chance: 1.0 },
        { type: 'weapon_legendary', level: [15, 25], chance: 0.8 },
        { type: 'armor_legendary', level: [15, 25], chance: 0.8 },
        { type: 'skill_scroll', skill: 'random', chance: 0.5 }
      ]
    };
  }

  rollLoot(enemyLevel, isBoss = false) {
    const tier = isBoss ? 'boss' : 
                 enemyLevel > 10 ? 'rare' :
                 enemyLevel > 5 ? 'uncommon' : 'common';
    
    const table = this.lootTables[tier];
    const drops = [];

    for (const entry of table) {
      if (Math.random() < entry.chance) {
        const item = { ...entry };
        if (item.amount && Array.isArray(item.amount)) {
          item.amount = Math.floor(Math.random() * (item.amount[1] - item.amount[0] + 1)) + item.amount[0];
        }
        if (item.level && Array.isArray(item.level)) {
          item.level = Math.floor(Math.random() * (item.level[1] - item.level[0] + 1)) + item.level[0];
        }
        drops.push(item);
      }
    }

    return drops;
  }

  spawnLootBag(position, loot) {
    const scene = this.scene;
    const bag = BABYLON.MeshBuilder.CreateSphere('lootBag', { diameter: 0.6 }, scene);
    bag.position = position.clone();
    bag.position.y = 0.5;

    const mat = new BABYLON.StandardMaterial('lootMat', scene);
    mat.emissiveColor = new BABYLON.Color3(1, 0.8, 0);
    bag.material = mat;

    // Bounce animation
    let time = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      time += scene.getEngine().getDeltaTime() / 1000;
      bag.position.y = 0.5 + Math.sin(time * 3) * 0.2;
      bag.rotation.y = time * 2;
    });

    bag.metadata = { loot, observer: obs, isLootBag: true };
    
    // Auto-despawn after 60 seconds
    setTimeout(() => {
      scene.onBeforeRenderObservable.remove(obs);
      bag.dispose();
    }, 60000);

    return bag;
  }
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

  addItem(item) {
    if (item.type === 'gold') {
      this.gold += item.amount;
      return true;
    }

    if (this.items.length >= this.maxSlots) {
      return false; // Inventory full
    }

    this.items.push(item);
    return true;
  }

  removeItem(index) {
    if (index >= 0 && index < this.items.length) {
      this.items.splice(index, 1);
      return true;
    }
    return false;
  }

  equipItem(index) {
    const item = this.items[index];
    if (!item) return null;

    const slot = item.type.includes('weapon') ? 'weapon' :
                 item.type.includes('armor') ? 'armor' : 'accessory';

    const oldItem = this.equipped[slot];
    this.equipped[slot] = item;
    this.removeItem(index);

    return oldItem;
  }

  getStats() {
    let bonus = { attack: 0, defense: 0, hp: 0, mp: 0 };
    
    for (const slot in this.equipped) {
      const item = this.equipped[slot];
      if (item && item.stats) {
        bonus.attack += item.stats.attack || 0;
        bonus.defense += item.stats.defense || 0;
        bonus.hp += item.stats.hp || 0;
        bonus.mp += item.stats.mp || 0;
      }
    }

    return bonus;
  }
}

// ==================== QUEST SYSTEM ====================
class QuestSystem {
  constructor() {
    this.activeQuests = [];
    this.completedQuests = [];
    this.questTemplates = this.initQuestTemplates();
  }

  initQuestTemplates() {
    return [
      {
        id: 'starter_1',
        name: 'Wolf Hunter',
        description: 'Defeat 5 wolves in the forest',
        type: 'kill',
        target: 'wolf',
        required: 5,
        rewards: { gold: 50, xp: 100 },
        level: 1
      },
      {
        id: 'starter_2',
        name: 'Goblin Menace',
        description: 'Eliminate 3 goblins',
        type: 'kill',
        target: 'goblin',
        required: 3,
        rewards: { gold: 100, xp: 200, item: 'weapon_sword' },
        level: 5
      },
      {
        id: 'elite_1',
        name: 'Skeleton King',
        description: 'Defeat the Skeleton King boss',
        type: 'kill',
        target: 'skeleton_boss',
        required: 1,
        rewards: { gold: 500, xp: 1000, item: 'armor_legendary' },
        level: 15
      }
    ];
  }

  acceptQuest(questId) {
    const template = this.questTemplates.find(q => q.id === questId);
    if (!template) return null;

    const quest = {
      ...template,
      progress: 0,
      accepted: Date.now()
    };

    this.activeQuests.push(quest);
    return quest;
  }

  updateProgress(targetType, amount = 1) {
    for (const quest of this.activeQuests) {
      if (quest.type === 'kill' && quest.target === targetType) {
        quest.progress = Math.min(quest.progress + amount, quest.required);
      }
    }
  }

  checkComplete(questId) {
    const quest = this.activeQuests.find(q => q.id === questId);
    return quest && quest.progress >= quest.required;
  }

  completeQuest(questId) {
    const index = this.activeQuests.findIndex(q => q.id === questId);
    if (index < 0) return null;

    const quest = this.activeQuests[index];
    if (quest.progress < quest.required) return null;

    this.activeQuests.splice(index, 1);
    this.completedQuests.push(quest);

    return quest.rewards;
  }
}

// ==================== SKILL TREE SYSTEM ====================
class SkillTreeSystem {
  constructor() {
    this.unlockedSkills = new Set([1]); // Basic attack unlocked by default
    this.skillPoints = 0;
    this.skills = this.initSkills();
  }

  initSkills() {
    return new Map([
      [1, { id: 1, name: "Basic Attack", baseDamage: 10, mpCost: 0, cooldown: 1500, unlocked: true }],
      [2, { id: 2, name: "Fireball", baseDamage: 25, mpCost: 15, cooldown: 3000, cost: 1, requires: null }],
      [3, { id: 3, name: "Ice Shard", baseDamage: 20, mpCost: 12, cooldown: 2500, cost: 1, requires: null }],
      [4, { id: 4, name: "Lightning Strike", baseDamage: 30, mpCost: 20, cooldown: 4000, cost: 2, requires: 2 }],
      [5, { id: 5, name: "Meteor", baseDamage: 50, mpCost: 35, cooldown: 8000, cost: 3, requires: 4 }],
      [6, { id: 6, name: "Heal", baseDamage: -30, mpCost: 20, cooldown: 5000, cost: 2, requires: null }],
      [7, { id: 7, name: "Shield", baseDamage: 0, mpCost: 15, cooldown: 10000, cost: 2, requires: null }]
    ]);
  }

  canUnlock(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill || this.unlockedSkills.has(skillId)) return false;
    if (this.skillPoints < (skill.cost || 1)) return false;
    if (skill.requires && !this.unlockedSkills.has(skill.requires)) return false;
    return true;
  }

  unlockSkill(skillId) {
    if (!this.canUnlock(skillId)) return false;
    const skill = this.skills.get(skillId);
    this.skillPoints -= (skill.cost || 1);
    this.unlockedSkills.add(skillId);
    return true;
  }

  addSkillPoints(amount) {
    this.skillPoints += amount;
  }
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

  calculateDamage(attacker, defender, skill) {
    const baseDmg = skill.baseDamage || 10;
    const atkStat = attacker.stats.attack || 10;
    const defStat = defender.stats.defense || 5;
    
    const rawDmg = (baseDmg + atkStat) - (defStat * 0.5);
    const variance = 0.15;
    const finalDmg = Math.max(1, Math.floor(
      rawDmg * (1 + (Math.random() * variance * 2 - variance))
    ));
    
    const isCrit = Math.random() < 0.1;
    return {
      damage: isCrit ? Math.floor(finalDmg * 1.5) : finalDmg,
      isCritical: isCrit
    };
  }

  canUseSkill(skillId) {
    const now = Date.now();
    const lastUsed = this.cooldowns.get(skillId) || 0;
    const skill = this.skills.get(skillId);
    if (!skill) return false;
    return (now - lastUsed) >= (skill.cooldown || 1000);
  }

  async useSkill(attacker, defender, skillId) {
    if (!this.canUseSkill(skillId)) {
      return { success: false, reason: "Skill on cooldown" };
    }

    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, reason: "Invalid skill" };
    }

    if (!attacker || !defender) {
      return { success: false, reason: "Invalid target" };
    }

    if (attacker.stats.mp < (skill.mpCost || 0)) {
      return { success: false, reason: "Not enough MP" };
    }

    const { damage, isCritical } = this.calculateDamage(attacker, defender, skill);
    
    defender.stats.hp = Math.max(0, defender.stats.hp - damage);
    attacker.stats.mp -= (skill.mpCost || 0);

    this.cooldowns.set(skillId, Date.now());

    // Combo system
    const now = Date.now();
    if (now - this.lastHitTime < 3000) {
      this.comboCounter++;
    } else {
      this.comboCounter = 1;
    }
    this.lastHitTime = now;

    // Screen shake and effects
    this.screenShake();
    this.createCombatEffect(attacker, defender, skill, damage, isCritical);
    this.sound.play(isCritical ? 'skill' : 'hit');

    const targetDied = defender.stats.hp <= 0;
    if (targetDied) {
      this.handleDeath(defender, attacker);
      this.sound.play('death');
      this.comboCounter = 0;
    }

    return { success: true, damage, isCritical, targetDied, combo: this.comboCounter };
  }

  screenShake() {
    const camera = this.scene.activeCamera;
    if (!camera) return;

    const originalPos = camera.position.clone();
    let shakeTime = 0;
    const shakeDuration = 0.2;

    const obs = this.scene.onBeforeRenderObservable.add(() => {
      shakeTime += this.scene.getEngine().getDeltaTime() / 1000;
      
      if (shakeTime < shakeDuration) {
        camera.position.x = originalPos.x + (Math.random() - 0.5) * 0.2;
        camera.position.y = originalPos.y + (Math.random() - 0.5) * 0.2;
      } else {
        camera.position = originalPos;
        this.scene.onBeforeRenderObservable.remove(obs);
      }
    });
  }

  createCombatEffect(attacker, defender, skill, damage, isCrit) {
    this.createDamageNumber(defender.position, damage, isCrit ? "#ff6b00" : "#ffffff");
    
    if (skill.particleEffect) {
      this.createParticleEffect(attacker.position, defender.position, skill.particleEffect);
    }

    // Flash effect on target
    if (defender.mesh && defender.mesh.root) {
      const originalColor = defender.mesh.root.getChildMeshes()[0]?.material?.emissiveColor;
      if (originalColor) {
        const mat = defender.mesh.root.getChildMeshes()[0].material;
        mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        setTimeout(() => {
          mat.emissiveColor = originalColor;
        }, 100);
      }
    }
  }

  createDamageNumber(position, damage, color) {
    const scene = this.scene;
    const plane = BABYLON.MeshBuilder.CreatePlane("dmgNumber", { width: 2, height: 0.8 }, scene);
    plane.position = position.clone();
    plane.position.y += 2;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const texture = new BABYLON.DynamicTexture("dmgTex", { width: 256, height: 128 }, scene);
    texture.drawText(damage.toString(), null, 80, "bold 60px Arial", color, "transparent", true);

    const mat = new BABYLON.StandardMaterial("dmgMat", scene);
    mat.diffuseTexture = texture;
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    mat.opacityTexture = texture;
    plane.material = mat;

    let time = 0;
    const startY = plane.position.y;
    const animObs = scene.onBeforeRenderObservable.add(() => {
      time += scene.getEngine().getDeltaTime() / 1000;
      plane.position.y = startY + time * 2;
      mat.alpha = 1 - (time / 1.5);
      
      if (time > 1.5) {
        scene.onBeforeRenderObservable.remove(animObs);
        plane.dispose();
        texture.dispose();
        mat.dispose();
      }
    });
  }

  createParticleEffect(fromPos, toPos, effectType) {
    const scene = this.scene;
    const particleSystem = new BABYLON.ParticleSystem("combat", 100, scene);
    particleSystem.particleTexture = new BABYLON.Texture(
      "https://assets.babylonjs.com/textures/flare.png", scene
    );

    particleSystem.emitter = fromPos;
    particleSystem.minEmitBox = new BABYLON.Vector3(-0.2, 0, -0.2);
    particleSystem.maxEmitBox = new BABYLON.Vector3(0.2, 0, 0.2);

    const colors = {
      fire: [new BABYLON.Color4(1, 0.5, 0, 1), new BABYLON.Color4(1, 0, 0, 0)],
      ice: [new BABYLON.Color4(0.5, 0.8, 1, 1), new BABYLON.Color4(0, 0.5, 1, 0)],
      lightning: [new BABYLON.Color4(1, 1, 0.5, 1), new BABYLON.Color4(0.5, 0.5, 1, 0)],
      physical: [new BABYLON.Color4(1, 1, 1, 1), new BABYLON.Color4(0.7, 0.7, 0.7, 0)]
    };

    const [c1, c2] = colors[effectType] || colors.physical;
    particleSystem.color1 = c1;
    particleSystem.color2 = c2;

    particleSystem.minSize = 0.3;
    particleSystem.maxSize = 0.8;
    particleSystem.minLifeTime = 0.3;
    particleSystem.maxLifeTime = 0.6;
    particleSystem.emitRate = 200;
    particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    particleSystem.gravity = new BABYLON.Vector3(0, -2, 0);
    particleSystem.direction1 = toPos.subtract(fromPos).normalize();
    particleSystem.direction2 = toPos.subtract(fromPos).normalize();
    particleSystem.minEmitPower = 8;
    particleSystem.maxEmitPower = 12;

    particleSystem.start();
    setTimeout(() => {
      particleSystem.stop();
      setTimeout(() => particleSystem.dispose(), 1000);
    }, 300);
  }

  handleDeath(victim, killer) {
    console.log(`${victim.name} was defeated by ${killer.name}`);
    
    const xpGain = victim.stats.level * 10;
    killer.stats.xp = (killer.stats.xp || 0) + xpGain;
    
    const xpNeeded = 100 * Math.pow(killer.stats.level, 1.8);
    if (killer.stats.xp >= xpNeeded) {
      killer.stats.level++;
      killer.stats.xp = 0;
      killer.stats.maxHp += 10;
      killer.stats.maxMp += 5;
      killer.stats.attack += 2;
      killer.stats.defense += 1;
      killer.stats.hp = killer.stats.maxHp;
      killer.stats.mp = killer.stats.maxMp;
      this.sound.play('levelup');
      console.log(`${killer.name} leveled up to ${killer.stats.level}!`);
    }
    
    if (victim.mesh && victim.mesh.root) {
      victim.mesh.root.setEnabled(false);
      setTimeout(() => {
        victim.stats.hp = victim.stats.maxHp;
        victim.mesh.root.setEnabled(true);
      }, 30000);
    }
  }
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
    try {
        const scene = this.scene;
        const enemyId = `enemy_${id}`;
        
        // Try to load the model
        let mesh;
        try {
            const model = await window.assetLoaderInstance.loadAsset(name.toLowerCase().replace(/\s+/g, '_'));
            mesh = model.meshes[0].clone(enemyId);
            mesh.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5);
        } catch (error) {
            console.warn(`Failed to load model for ${name}, using fallback`, error);
            mesh = createFallbackMesh(enemyId, scene, {
                size: isBoss ? 2 : 1,
                color: isBoss ? '#ff0000' : '#00ff00'
            });
        }
      } catch (error) {
        console.log('[NPC] Using procedural fallback:', error.message);
      }
    }
    
    if (body) {
      const scale = isBoss ? 2.5 : 1.0;
      body = BABYLON.MeshBuilder.CreateCapsule(id + "_body", {
        height: 2.4 * scale, radius: 0.5 * scale
      }, scene);
      body.parent = root;
      body.position.y = 1.2 * scale;

      head = BABYLON.MeshBuilder.CreateSphere(id + "_head", {
        diameter: 0.7 * scale
      }, scene);
      head.parent = root;
      head.position.y = 2.3 * scale;

      const mat = new BABYLON.StandardMaterial(id + "_mat", scene);
      mat.diffuseColor = isBoss ? new BABYLON.Color3(0.5, 0, 0.5) : new BABYLON.Color3(0.8, 0.2, 0.1);
      mat.emissiveColor = isBoss ? new BABYLON.Color3(0.2, 0, 0.2) : new BABYLON.Color3(0.1, 0, 0);
      body.material = mat;
      head.material = mat;
    }

    root.position = position.clone();

    if (scene.shadowGenerator) {
      scene.shadowGenerator.addShadowCaster(body);
      if (head !== body) scene.shadowGenerator.addShadowCaster(head);
    }

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

    if (animationGroups.length > 0) {
      this.playAnimation(enemy, 0, true);
    }

    this.enemies.set(id, enemy);
    return enemy;
  }
  
  playAnimation(enemy, animIndex, loop = true) {
    if (!enemy.animationGroups || enemy.animationGroups.length === 0) return;
    
    if (enemy.currentAnimation) {
      enemy.currentAnimation.stop();
    }
    
    if (animIndex < enemy.animationGroups.length) {
      enemy.currentAnimation = enemy.animationGroups[animIndex];
      enemy.currentAnimation.start(loop);
    }
  }

  createNameplate(parent, name, level, faction) {
    const scene = this.scene;
    const plate = BABYLON.MeshBuilder.CreatePlane("nameplate", {
      width: 3, height: 0.6
    }, scene);
    plate.parent = parent;
    plate.position.y = 3.2;
    plate.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const tex = new BABYLON.DynamicTexture("nameTex", {
      width: 256, height: 64
    }, scene);
    tex.hasAlpha = true;

    let color = "#ffffff";
    if (faction === "boss") color = "#ff00ff";
    else if (faction === "hostile") color = "#ff4444";
    else if (faction === "friendly") color = "#44ff44";

    tex.drawText(`${name} [Lv.${level}]`, null, 42, "18px Arial", color, "transparent", true);

    const mat = new BABYLON.StandardMaterial("nameMat", scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    mat.opacityTexture = tex;
    mat.backFaceCulling = false;
    plate.material = mat;

    return { mesh: plate, texture: tex };
  }

  createHealthBar(parent) {
    const scene = this.scene;
    const barBg = BABYLON.MeshBuilder.CreatePlane("hpBg", {
      width: 2, height: 0.15
    }, scene);
    barBg.parent = parent;
    barBg.position.y = 2.8;
    barBg.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const barFg = BABYLON.MeshBuilder.CreatePlane("hpFg", {
      width: 2, height: 0.15
    }, scene);
    barFg.parent = barBg;
    barFg.position.z = -0.01;

    const bgMat = new BABYLON.StandardMaterial("hpBgMat", scene);
    bgMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    bgMat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    barBg.material = bgMat;

    const fgMat = new BABYLON.StandardMaterial("hpFgMat", scene);
    fgMat.diffuseColor = new BABYLON.Color3(0.8, 0.1, 0.1);
    fgMat.emissiveColor = new BABYLON.Color3(0.3, 0, 0);
    barFg.material = fgMat;

    return { bg: barBg, fg: barFg, fgMat };
  }

  updateHealthBar(npc) {
    const healthBar = npc.mesh.healthBar;
    if (!healthBar) return;

    const percent = npc.stats.hp / npc.stats.maxHp;
    healthBar.fg.scaling.x = Math.max(0, percent);
    healthBar.fg.position.x = -(1 - percent);
  }

  updateAI(deltaTime, players) {
    const now = Date.now();
    if (now - this.lastAIUpdate < this.aiUpdateInterval) return;
    this.lastAIUpdate = now;

    for (const [id, enemy] of this.enemies) {
      this.updateEnemyAI(enemy, players, deltaTime);
      this.updateHealthBar(enemy);
    }
  }

  updateEnemyAI(enemy, players, deltaTime) {
    const ai = enemy.ai;
    const now = Date.now();

    enemy.position = enemy.mesh.root.position;

    switch (ai.state) {
      case "idle":
        const nearestPlayer = this.findNearestPlayer(enemy, players, ai.aggroRadius);
        if (nearestPlayer) {
          ai.target = nearestPlayer;
          ai.state = "combat";
          console.log(`${enemy.name} engaged ${nearestPlayer.name}`);
        }
        break;

      case "combat":
        if (!ai.target || ai.target.stats.hp <= 0) {
          ai.target = null;
          ai.state = "returning";
          break;
        }

        const distToTarget = BABYLON.Vector3.Distance(
          enemy.mesh.root.position,
          ai.target.position
        );

        const distToHome = BABYLON.Vector3.Distance(
          enemy.mesh.root.position,
          ai.homePosition
        );
        if (distToHome > ai.leashRadius) {
          console.log(`${enemy.name} leashed`);
          ai.target = null;
          ai.state = "returning";
          enemy.stats.hp = enemy.stats.maxHp;
          break;
        }

        if (distToTarget > enemy.stats.attackRange) {
          this.moveToward(enemy, ai.target.position, deltaTime);
        } else {
          if (now - ai.lastAction > ai.actionCooldown) {
            this.performAttack(enemy, ai.target);
            ai.lastAction = now;
            ai.actionCooldown = 1500 + Math.random() * 500;
          }
        }
        break;

      case "returning":
        const distHome = BABYLON.Vector3.Distance(
          enemy.mesh.root.position,
          ai.homePosition
        );
        if (distHome < 1) {
          enemy.mesh.root.position = ai.homePosition.clone();
          ai.state = "idle";
        } else {
          this.moveToward(enemy, ai.homePosition, deltaTime);
        }
        break;
    }
  }

  findNearestPlayer(npc, players, maxDistance) {
    let nearest = null;
    let nearestDist = maxDistance;

    for (const player of players) {
      if (player.stats.hp <= 0) continue;
      
      const dist = BABYLON.Vector3.Distance(
        npc.mesh.root.position,
        player.position
      );

      if (dist < nearestDist) {
        nearest = player;
        nearestDist = dist;
      }
    }

    return nearest;
  }

  moveToward(npc, targetPos, deltaTime) {
    const current = npc.mesh.root.position;
    const direction = targetPos.subtract(current);
    direction.y = 0;
    direction.normalize();

    const speed = npc.stats.speed * (deltaTime || 1);
    const movement = direction.scale(speed);

    npc.mesh.root.position.addInPlace(movement);

    if (direction.length() > 0.01) {
      const angle = Math.atan2(direction.x, direction.z);
      npc.mesh.root.rotation.y = angle;
    }
  }

  performAttack(attacker, target) {
    if (!this.combat) return;
    this.combat.useSkill(attacker, target, 1);
  }

  getNPC(npcId) {
    return this.npcs.get(npcId) || this.enemies.get(npcId);
  }

  getEnemiesInRange(position, range) {
    const result = [];
    for (const [id, enemy] of this.enemies) {
      const dist = BABYLON.Vector3.Distance(
        enemy.mesh.root.position,
        position
      );
      if (dist <= range) {
        result.push(enemy);
      }
    }
    return result;
  }
}

// ==================== GLOBAL GAME STATE ====================
window.GameSystems = {
  sound: null,
  loot: null,
  inventory: null,
  quests: null,
  skillTree: null,
  combat: null,
  npcManager: null,
  currentTarget: null,
  targetRing: null,
  
  init: function(scene, supabase) {
    this.sound = new SoundSystem();
    this.loot = new LootSystem(scene);
    this.inventory = new InventorySystem();
    this.quests = new QuestSystem();
    this.skillTree = new SkillTreeSystem();
    this.combat = new CombatSystem(scene, supabase, this.sound);
    this.npcManager = new NPCManager(scene, supabase, this.combat);
    console.log("[HOSG] Enhanced game systems initialized");
  },
  
  spawnTestEnemies: async function(scene) {
    console.log('[HOSG] Spawning enhanced enemies...');
    const positions = [
      new BABYLON.Vector3(15, 0, 15),
      new BABYLON.Vector3(-20, 0, 10),
      new BABYLON.Vector3(10, 0, -15),
      new BABYLON.Vector3(-15, 0, -20),
      new BABYLON.Vector3(25, 0, 0)
    ];
    
    for (let i = 0; i < positions.length; i++) {
      await this.npcManager.createTestEnemy(`enemy_wolf_${i}`, positions[i], "Gray Wolf", 3);
    }
    
    // Spawn a boss
    await this.npcManager.createTestEnemy('boss_skeleton', new BABYLON.Vector3(0, 0, 50), "Skeleton King", 10, true);
    
    console.log("[HOSG] ✓ Spawned enemies + boss");
  }
};
// ==================== SHADOW SYSTEM ====================
let shadowGenerator = null;

function setupShadows(scene) {
    if (!scene) {
        console.error("No scene provided for shadow setup");
        return null;
    }

    try {
        const light = scene.lights.find(l => l instanceof BABYLON.DirectionalLight);
        if (!light) {
            console.warn("No directional light found for shadows");
            return null;
        }
        
        shadowGenerator = new BABYLON.ShadowGenerator(1024, light);
        shadowGenerator.useBlurExponentialShadowMap = true;
        shadowGenerator.blurKernel = 32;
        shadowGenerator.forceBackFacesOnly = true;
        
        return shadowGenerator;
    } catch (error) {
        console.error("Failed to setup shadows:", error);
        return null;
    }
}

// Initialize shadows when the scene is ready
if (window.GameSystems.init) {
    const originalInit = window.GameSystems.init;
    window.GameSystems.init = function(scene, supabase) {
        const result = originalInit.call(this, scene, supabase);
        setupShadows(scene);
        return result;
    };
}

// ==================== TARGETING SYSTEM ====================
function targetNearestEnemy() {
    if (!window.GameState || !window.GameState.enemies) {
        console.warn("No GameState or enemies found");
        return null;
    }
    
    const player = window.GameState.player;
    if (!player || !player.position) {
        console.warn("Player position not found");
        return null;
    }
    
    let nearestEnemy = null;
    let nearestDistance = Infinity;
    
    Object.values(window.GameState.enemies || {}).forEach(enemy => {
        if (!enemy?.mesh || (enemy.stats?.hp !== undefined && enemy.stats.hp <= 0)) return;
        
        const distance = BABYLON.Vector3.Distance(player.position, enemy.mesh.position);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestEnemy = enemy;
        }
    });
    
    if (nearestEnemy) {
        window.GameState.currentTarget = nearestEnemy;
        console.log(`Targeting: ${nearestEnemy.name || 'Enemy'}`);
    } else {
        console.log("No valid enemies found");
    }
    
    return nearestEnemy;
}

// Make it globally available
window.targetNearestEnemy = targetNearestEnemy;

// Update the existing CombatSystem's handleDeath method
if (window.GameSystems.combat && window.GameSystems.combat.handleDeath) {
    const originalHandleDeath = window.GameSystems.combat.handleDeath;
    
    window.GameSystems.combat.handleDeath = function(defender, attacker) {
        try {
            const oldLevel = attacker?.stats?.level || 1;
            return originalHandleDeath.call(this, defender, attacker);
        } catch (error) {
            console.error("Error in handleDeath:", error);
            return false;
        }
    };
}
;
console.log("[HOSG] Enhanced game systems loaded v3.0");
