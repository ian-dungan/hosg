class CombatSystem {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.attackCooldown = 0;
    this.attackRate = 1.0; // Attacks per second
    this.attackRange = 2.0;
    this.attackDamage = 10;
    this.criticalChance = 0.1;
    this.criticalMultiplier = 2.0;
    this.abilities = {};
    this.activeEffects = [];
    this.target = null;
  }
  
  init() {
    // Load abilities
    this.loadAbilities();
    
    // Set up input for attacking
    this.setupInput();
    
    debugLog('Combat system initialized');
  }
  
  loadAbilities() {
    // Basic attack
    this.abilities.basicAttack = {
      name: 'Basic Attack',
      cooldown: 1.0,
      range: this.attackRange,
      damage: this.attackDamage,
      manaCost: 0,
      onUse: (target) => this.performAttack(target)
    };
    
    // Fireball ability
    this.abilities.fireball = {
      name: 'Fireball',
      cooldown: 5.0,
      range: 10.0,
      damage: this.attackDamage * 2,
      manaCost: 20,
      cooldownRemaining: 0,
      onUse: (target) => this.castFireball(target)
    };
    
    // Add more abilities as needed
  }
  
  setupInput() {
    // Attack with left mouse button
    this.scene.onPointerDown = (evt, pickResult) => {
      if (evt.button !== 0) return; // Only left click
      
      if (pickResult.hit) {
        const hitMesh = pickResult.pickedMesh;
        
        // Check if we hit an enemy
        if (hitMesh && hitMesh.name.startsWith('enemy_')) {
          this.setTarget(hitMesh);
          this.useAbility('basicAttack', hitMesh);
        } else {
          // Just move to the clicked position
          this.moveTo(pickResult.pickedPoint);
        }
      }
    };
    
    // Ability hotkeys (1-9, 0)
    window.addEventListener('keydown', (e) => {
      if (e.key >= '1' && e.key <= '9') {
        const slot = parseInt(e.key);
        this.useAbilityBySlot(slot);
      } else if (e.key === '0') {
        this.useAbilityBySlot(10);
      } else if (e.key.toLowerCase() === 'f') {
        // Target enemy under cursor
        const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
        if (pickResult.hit && pickResult.pickedMesh.name.startsWith('enemy_')) {
          this.setTarget(pickResult.pickedMesh);
        }
      } else if (e.key.toLowerCase() === 'tab') {
        // Cycle through enemies
        this.cycleTargets();
      }
    });
  }
  
  update(deltaTime) {
    // Update cooldowns
    this.updateCooldowns(deltaTime);
    
    // Update active effects
    this.updateEffects(deltaTime);
    
    // Auto-attack if target is in range
    if (this.target && this.attackCooldown <= 0) {
      const distance = BABYLON.Vector3.Distance(
        this.game.player.mesh.position,
        this.target.position
      );
      
      if (distance <= this.attackRange) {
        this.useAbility('basicAttack', this.target);
      }
    }
  }
  
  updateCooldowns(deltaTime) {
    // Update attack cooldown
    if (this.attackCooldown > 0) {
      this.attackCooldown -= deltaTime;
    }
    
    // Update ability cooldowns
    for (const abilityId in this.abilities) {
      const ability = this.abilities[abilityId];
      if (ability.cooldownRemaining > 0) {
        ability.cooldownRemaining -= deltaTime;
      }
    }
  }
  
  updateEffects(deltaTime) {
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      effect.duration -= deltaTime;
      
      // Apply effect tick
      if (effect.onTick) {
        effect.onTick(deltaTime);
      }
      
      // Remove expired effects
      if (effect.duration <= 0) {
        if (effect.onEnd) {
          effect.onEnd();
        }
        this.activeEffects.splice(i, 1);
      }
    }
  }
  
  useAbility(abilityId, target) {
    const ability = this.abilities[abilityId];
    if (!ability) return false;
    
    // Check cooldown
    if (ability.cooldownRemaining > 0) return false;
    
    // Check range
    if (target) {
      const distance = BABYLON.Vector3.Distance(
        this.game.player.mesh.position,
        target.position
      );
      
      if (distance > ability.range) {
        this.game.ui.showNotification('Target is out of range');
        return false;
      }
    }
    
    // Check mana
    if (ability.manaCost > 0 && this.game.player.state.mana < ability.manaCost) {
      this.game.ui.showNotification('Not enough mana');
      return false;
    }
    
    // Use mana
    if (ability.manaCost > 0) {
      this.game.player.state.mana -= ability.manaCost;
    }
    
    // Set cooldown
    if (ability.cooldown) {
      ability.cooldownRemaining = ability.cooldown;
    }
    
    // Use the ability
    if (ability.onUse) {
      ability.onUse(target);
    }
    
    return true;
  }
  
  useAbilityBySlot(slot) {
    // In a real game, you would map slots to abilities
    // For now, just use basic attack for slot 1
    if (slot === 1 && this.target) {
      this.useAbility('basicAttack', this.target);
    } else if (slot === 2) {
      this.useAbility('fireball', this.target);
    }
  }
  
  performAttack(target) {
    if (this.attackCooldown > 0) return false;
    
    // Set cooldown
    this.attackCooldown = 1.0 / this.attackRate;
    
    // Play attack animation
    this.game.player.playAnimation('attack');
    
    // Check for critical hit
    const isCritical = Math.random() < this.criticalChance;
    let damage = this.attackDamage;
    
    if (isCritical) {
      damage = Math.floor(damage * this.criticalMultiplier);
      this.game.ui.showNotification('Critical hit!', 1500);
    }
    
    // Apply damage to target
    if (target && target.health !== undefined) {
      target.health -= damage;
      
      // Show damage numbers
      this.showDamageNumber(target.position, damage, isCritical);
      
      // Check if target is dead
      if (target.health <= 0) {
        this.onTargetDefeated(target);
      }
      
      return true;
    }
    
    return false;
  }
  
  castFireball(target) {
    if (!target) return false;
    
    // Create fireball
    const fireball = BABYLON.MeshBuilder.CreateSphere('fireball', {
      diameter: 0.5
    }, this.scene);
    
    // Position fireball at player's hand
    fireball.position = this.game.player.mesh.position.clone();
    fireball.position.y += 1.5; // Hand height
    
    // Create fire material
    const fireMaterial = new BABYLON.StandardMaterial('fireMaterial', this.scene);
    fireMaterial.diffuseColor = new BABYLON.Color3(1, 0.5, 0);
    fireMaterial.emissiveColor = new BABYLON.Color3(1, 0.3, 0);
    fireMaterial.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    fireMaterial.alpha = 0.8;
    fireMaterial.alphaMode = BABYLON.Engine.ALPHA_ADD;
    fireMaterial.backFaceCulling = false;
    fireMaterial.useEmissiveAsIllumination = true;
    
    // Add glow effect
    const glowLayer = new BABYLON.GlowLayer('glow', this.scene);
    glowLayer.addIncludedOnlyMesh(fireball);
    
    fireball.material = fireMaterial;
    
    // Animate fireball
    const startPos = fireball.position.clone();
    const endPos = target.position.clone();
    endPos.y += 1; // Aim for center of target
    
    const distance = BABYLON.Vector3.Distance(startPos, endPos);
    const speed = 20; // units per second
    const duration = distance / speed;
    
    // Create animation
    const animation = new BABYLON.Animation(
      'fireballAnimation',
      'position',
      30,
      BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    
    // Animation keys
    const keys = [];
    keys.push({ frame: 0, value: startPos });
    keys.push({ frame: 30 * duration, value: endPos });
    
    // Set keys
    animation.setKeys(keys);
    
    // Add animation to fireball
    fireball.animations = [animation];
    
    // Run animation
    this.scene.beginAnimation(fireball, 0, 30 * duration, false, 1, () => {
      // Animation complete
      fireball.dispose();
      
      // Create explosion effect
      this.createExplosion(endPos);
      
      // Apply damage to target
      if (target && target.health !== undefined) {
        target.health -= this.abilities.fireball.damage;
        
        // Show damage numbers
        this.showDamageNumber(
          endPos, 
          this.abilities.fireball.damage, 
          false,
          true
        );
        
        // Check if target is dead
        if (target.health <= 0) {
          this.onTargetDefeated(target);
        }
      }
    });
    
    return true;
  }
  
  createExplosion(position) {
    // Create explosion particle system
    const particleSystem = new BABYLON.ParticleSystem('explosion', 1000, this.scene);
    
    // Texture
    particleSystem.particleTexture = new BABYLON.Texture('assets/textures/particles/flare.png', this.scene);
    
    // Emitter
    particleSystem.emitter = position.clone();
    particleSystem.minEmitBox = new BABYLON.Vector3(-0.5, -0.5, -0.5);
    particleSystem.maxEmitBox = new BABYLON.Vector3(0.5, 0.5, 0.5);
    
    // Colors
    particleSystem.color1 = new BABYLON.Color4(1, 0.5, 0, 1);
    particleSystem.color2 = new BABYLON.Color4(1, 0.2, 0, 0.5);
    particleSystem.colorDead = new BABYLON.Color4(1, 0, 0, 0);
    
    // Sizes
    particleSystem.minSize = 0.5;
    particleSystem.maxSize = 1.5;
    
    // Lifetimes
    particleSystem.minLifeTime = 0.3;
    particleSystem.maxLifeTime = 0.8;
    
    // Emission
    particleSystem.emitRate = 1000;
    
    // Speed
    particleSystem.minEmitPower = 2;
    particleSystem.maxEmitPower = 5;
    particleSystem.updateSpeed = 0.02;
    
    // Direction
    particleSystem.direction1 = new BABYLON.Vector3(-1, -1, -1);
    particleSystem.direction2 = new BABYLON.Vector3(1, 1, 1);
    
    // Start the particle system
    particleSystem.start();
    
    // Stop after 1 second
    setTimeout(() => {
      particleSystem.stop();
      setTimeout(() => {
        particleSystem.dispose();
      }, 1000);
    }, 100);
  }
  
  showDamageNumber(position, amount, isCritical = false, isAbility = false) {
    // Create text plane
    const plane = BABYLON.MeshBuilder.CreatePlane('damageText', {
      size: 1
    }, this.scene);
    
    // Position above target
    plane.position = position.clone();
    plane.position.y += 2;
    
    // Always face camera
    plane.billboardMode = BABYLON.Mesh.BILLBO
