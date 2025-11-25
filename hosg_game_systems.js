// ============================================================
// HEROES OF SHADY GROVE - GAME SYSTEMS v2.0
// Save this as: hosg_game_systems.js
// Add to index.html: <script src="hosg_game_systems.js"></script>
// ============================================================
// In hosg_game_systems.js
function initGame(scene) {
    console.log('Initializing game systems with scene');
    
    // Your existing game systems initialization code
    // Make sure to use the scene parameter instead of a global scene variable
    
    // If you need to initialize advanced features, you can call:
    if (typeof initAdvancedFeatures === 'function') {
        initAdvancedFeatures(scene);
    }
}
// ==================== COMBAT SYSTEM ====================
class CombatSystem {
  constructor(scene, supabase) {
    this.scene = scene;
    this.supabase = supabase;
    this.cooldowns = new Map();
    
    // Define basic skills
    this.skills = new Map([
      [1, { id: 1, name: "Basic Attack", baseDamage: 10, mpCost: 0, cooldown: 1500, particleEffect: "physical" }],
      [2, { id: 2, name: "Fireball", baseDamage: 25, mpCost: 15, cooldown: 3000, particleEffect: "fire" }],
      [3, { id: 3, name: "Ice Shard", baseDamage: 20, mpCost: 12, cooldown: 2500, particleEffect: "ice" }],
      [4, { id: 4, name: "Lightning Strike", baseDamage: 30, mpCost: 20, cooldown: 4000, particleEffect: "lightning" }]
    ]);
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

    // Calculate and apply damage
    const { damage, isCritical } = this.calculateDamage(attacker, defender, skill);
    
    defender.stats.hp = Math.max(0, defender.stats.hp - damage);
    attacker.stats.mp -= (skill.mpCost || 0);

    // Set cooldown
    this.cooldowns.set(skillId, Date.now());

    // Visual effects
    this.createCombatEffect(attacker, defender, skill, damage, isCritical);

    // Check for death
    const targetDied = defender.stats.hp <= 0;
    if (targetDied) {
      this.handleDeath(defender, attacker);
    }

    return { success: true, damage, isCritical, targetDied };
  }

  createCombatEffect(attacker, defender, skill, damage, isCrit) {
    this.createDamageNumber(defender.position, damage, isCrit ? "#ff6b00" : "#ffffff");
    
    if (skill.particleEffect) {
      this.createParticleEffect(attacker.position, defender.position, skill.particleEffect);
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
    
    // Award XP
    const xpGain = victim.stats.level * 10;
    killer.stats.xp = (killer.stats.xp || 0) + xpGain;
    
    // Check level up
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
      console.log(`${killer.name} leveled up to ${killer.stats.level}!`);
    }
    
    // Hide victim (will respawn)
    if (victim.mesh && victim.mesh.root) {
      victim.mesh.root.setEnabled(false);
      setTimeout(() => {
        victim.stats.hp = victim.stats.maxHp;
        victim.mesh.root.setEnabled(true);
      }, 30000); // 30 second respawn
    }
  }
}

// ==================== NPC MANAGER ====================
class NPCManager {
  constructor(scene, supabase, combatSystem) {
    this.scene = scene;
    this.supabase = supabase;
    this.combat = combatSystem;
    this.npcs = new Map();
    this.enemies = new Map();
    this.aiUpdateInterval = 200;
    this.lastAIUpdate = 0;
    
    // Initialize asset loader if available
    if (typeof AssetLoader !== 'undefined' && !window.assetLoaderInstance) {
      window.assetLoaderInstance = new AssetLoader(scene);
    }
  }

  // Create a test enemy without database
  async createTestEnemy(id, position, name = "Test Wolf", level = 3) {
    const scene = this.scene;
    const root = new BABYLON.TransformNode(id, scene);
    
    let body, head;
    let animationGroups = [];
    
    // Try to load 3D model if asset loader is available
    if (window.assetLoaderInstance) {
      console.log('[NPC] Attempting to load enemy_wolf model for', id);
      try {
        const loadedAsset = await window.assetLoaderInstance.loadAsset('enemy_wolf', {
          position: new BABYLON.Vector3(0, 0, 0)
        });
        
        if (loadedAsset && loadedAsset.rootMesh) {
          // Use loaded 3D model
          loadedAsset.rootMesh.parent = root;
          body = loadedAsset.rootMesh;
          head = loadedAsset.rootMesh; // For shadow purposes
          animationGroups = loadedAsset.animationGroups || [];
          console.log('[NPC] ✓ Loaded real wolf model for', id, 'with', animationGroups.length, 'animations');
        }
      } catch (error) {
        console.log('[NPC] Failed to load wolf model, using procedural fallback:', error.message);
      }
    }
    
    // Fallback to procedural geometry if model didn't load
    if (!body) {
      body = BABYLON.MeshBuilder.CreateCapsule(id + "_body", {
        height: 2.4, radius: 0.5
      }, scene);
      body.parent = root;
      body.position.y = 1.2;

      head = BABYLON.MeshBuilder.CreateSphere(id + "_head", {
        diameter: 0.7
      }, scene);
      head.parent = root;
      head.position.y = 2.3;

      const mat = new BABYLON.StandardMaterial(id + "_mat", scene);
      mat.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.1);
      mat.emissiveColor = new BABYLON.Color3(0.1, 0, 0);
      body.material = mat;
      head.material = mat;
    }

    root.position = position.clone();

    if (scene.shadowGenerator) {
      scene.shadowGenerator.addShadowCaster(body);
      if (head !== body) scene.shadowGenerator.addShadowCaster(head);
    }

    const nameplate = this.createNameplate(root, name, level, "hostile");
    const healthBar = this.createHealthBar(root);

    const enemy = {
      id,
      name,
      level,
      faction: "hostile",
      type: "enemy",
      stats: {
        level,
        hp: 50 + level * 20,
        maxHp: 50 + level * 20,
        mp: 30,
        maxMp: 30,
        attack: 5 + level * 2,
        defense: 3 + level,
        speed: 0.08,
        attackRange: 2.5,
        xp: 0
      },
      position: root.position,
      ai: {
        state: "idle",
        target: null,
        homePosition: root.position.clone(),
        wanderRadius: 10,
        aggroRadius: 15,
        leashRadius: 30,
        lastAction: 0,
        actionCooldown: 1500
      },
      mesh: { root, body, head, nameplate, healthBar },
      animationGroups: animationGroups,
      currentAnimation: null
    };

    // Start idle animation if available
    if (animationGroups.length > 0) {
      this.playAnimation(enemy, 0, true);
    }

    this.enemies.set(id, enemy);
    return enemy;
  }
  
  playAnimation(enemy, animIndex, loop = true) {
    if (!enemy.animationGroups || enemy.animationGroups.length === 0) return;
    
    // Stop current animation
    if (enemy.currentAnimation) {
      enemy.currentAnimation.stop();
    }
    
    // Play new animation
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
    if (faction === "hostile") color = "#ff4444";
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

    // Update position reference
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
  combat: null,
  npcManager: null,
  currentTarget: null,
  targetRing: null,
  
  init: function(scene, supabase) {
    this.combat = new CombatSystem(scene, supabase);
    this.npcManager = new NPCManager(scene, supabase, this.combat);
    console.log("[HOSG] Game systems initialized");
  },
  
  spawnTestEnemies: async function(scene) {
    console.log('[HOSG] Spawning test enemies...');
    // Spawn 5 test wolves around the starting area
    const positions = [
      new BABYLON.Vector3(15, 0, 15),
      new BABYLON.Vector3(-20, 0, 10),
      new BABYLON.Vector3(10, 0, -15),
      new BABYLON.Vector3(-15, 0, -20),
      new BABYLON.Vector3(25, 0, 0)
    ];
    
    for (let i = 0; i < positions.length; i++) {
      await this.npcManager.createTestEnemy(`enemy_wolf_${i}`, positions[i], "Gray Wolf", 3);
      console.log(`[HOSG] Spawned wolf ${i + 1}/${positions.length}`);
    }
    
    console.log("[HOSG] ✓ Spawned 5 test enemies");
  }
};

console.log("[HOSG] Game systems loaded");
