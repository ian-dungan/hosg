// ============================================================================
// HEROES OF SHADY GROVE - COMBAT SYSTEM
// Deep RPG-style combat with targeting, abilities, stats, and AI
// ============================================================================

class CombatSystem {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        
        // Combat state
        this.inCombat = false;
        this.currentTarget = null;
        this.autoAttackInterval = null;
        this.globalCooldown = 0; // Global cooldown timer
        
        // Combat configuration
        this.config = {
            AUTO_ATTACK_INTERVAL: 1500, // ms between auto attacks
            GLOBAL_COOLDOWN: 1000, // ms after any ability
            MELEE_RANGE: 3.0,
            RANGED_RANGE: 25.0,
            MAX_TARGET_DISTANCE: 50.0,
            AGGRO_RANGE: 15.0,
            LEASH_RANGE: 40.0,
            COMBAT_TIMEOUT: 5000 // Exit combat if no damage for 5s
        };
        
        // Damage numbers display
        this.damageNumbers = [];
        
        // Combat log
        this.combatLog = [];
        this.maxLogEntries = 50;
        
        console.log('[Combat] System initialized');
    }
    
    // ========================================================================
    // TARGETING SYSTEM
    // ========================================================================
    
    setTarget(entity) {
        if (this.currentTarget === entity) return;
        
        // Clear old target highlight
        if (this.currentTarget && this.currentTarget.targetHighlight) {
            this.currentTarget.targetHighlight.dispose();
            this.currentTarget.targetHighlight = null;
        }
        
        this.currentTarget = entity;
        
        if (entity) {
            // Create target highlight (different color for NPCs vs enemies)
            this.createTargetHighlight(entity);
            
            // Check if entity is an enemy or NPC
            if (entity.isEnemy) {
                this.logCombat(`Targeted: ${entity.name} (Enemy)`);
                // Enter combat only for enemies
                this.enterCombat();
            } else {
                this.logCombat(`Targeted: ${entity.name} (NPC - Cannot Attack)`);
                // Don't enter combat for NPCs
                this.inCombat = false;
            }
            
            // Update target frame UI
            if (this.game.ui && this.game.ui.updateTargetFrame) {
                this.game.ui.updateTargetFrame(entity);
            }
        } else {
            this.logCombat('Target cleared');
        }
    }
    
    createTargetHighlight(entity) {
        if (!entity.mesh) return;
        
        // Create highlight ring under target (red for enemies, green for NPCs)
        const highlight = BABYLON.MeshBuilder.CreateTorus('targetHighlight', {
            diameter: 2,
            thickness: 0.1,
            tessellation: 32
        }, this.scene);
        
        highlight.position = entity.mesh.position.clone();
        highlight.position.y = 0.1;
        highlight.rotation.x = Math.PI / 2;
        
        const mat = new BABYLON.StandardMaterial('targetMat', this.scene);
        // Red for enemies, green for NPCs
        if (entity.isEnemy) {
            mat.emissiveColor = new BABYLON.Color3(1, 0, 0); // Red
        } else {
            mat.emissiveColor = new BABYLON.Color3(0, 1, 0); // Green
        }
        mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        mat.alpha = 0.8;
        highlight.material = mat;
        
        entity.targetHighlight = highlight;
        
        // Animate highlight
        this.scene.registerBeforeRender(() => {
            if (highlight && !highlight.isDisposed()) {
                highlight.position.copyFrom(entity.mesh.position);
                highlight.position.y = 0.1;
                highlight.rotation.y += 0.02;
            }
        });
    }
    
    findNearestEnemy(maxDistance = this.config.MAX_TARGET_DISTANCE) {
        if (!this.game.player || !this.game.world) return null;
        
        let nearest = null;
        let nearestDist = maxDistance;
        
        const playerPos = this.game.player.mesh.position;
        
        for (const enemy of this.game.world.enemies) {
            if (!enemy.mesh || enemy.isDead) continue;
            
            const dist = BABYLON.Vector3.Distance(playerPos, enemy.mesh.position);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = enemy;
            }
        }
        
        return nearest;
    }
    
    // ========================================================================
    // COMBAT STATE MANAGEMENT
    // ========================================================================
    
    enterCombat() {
        if (this.inCombat) return;
        
        this.inCombat = true;
        this.lastCombatAction = Date.now();
        
        // Start auto-attack
        this.startAutoAttack();
        
        this.logCombat('⚔️ Entered combat!');
        
        // Update UI
        if (this.game.ui) {
            this.game.ui.showCombatUI(true);
        }
    }
    
    exitCombat() {
        if (!this.inCombat) return;
        
        this.inCombat = false;
        
        // Stop auto-attack
        this.stopAutoAttack();
        
        // Clear target
        this.setTarget(null);
        
        this.logCombat('Combat ended');
        
        // Update UI
        if (this.game.ui) {
            this.game.ui.showCombatUI(false);
        }
    }
    
    checkCombatTimeout() {
        if (!this.inCombat) return;
        
        const timeSinceLastAction = Date.now() - this.lastCombatAction;
        if (timeSinceLastAction > this.config.COMBAT_TIMEOUT) {
            this.exitCombat();
        }
    }
    
    // ========================================================================
    // AUTO-ATTACK SYSTEM
    // ========================================================================
    
    startAutoAttack() {
        if (this.autoAttackInterval) return;
        
        this.autoAttackInterval = setInterval(() => {
            this.performAutoAttack();
        }, this.config.AUTO_ATTACK_INTERVAL);
    }
    
    stopAutoAttack() {
        if (this.autoAttackInterval) {
            clearInterval(this.autoAttackInterval);
            this.autoAttackInterval = null;
        }
    }
    
    performAutoAttack() {
        if (!this.currentTarget || !this.game.player) return;
        if (this.currentTarget.isDead) {
            this.setTarget(null);
            return;
        }
        
        // CRITICAL: Only attack enemies, not NPCs
        if (!this.currentTarget.isEnemy) {
            return; // Can't attack NPCs
        }
        
        // Check range
        const distance = BABYLON.Vector3.Distance(
            this.game.player.mesh.position,
            this.currentTarget.mesh.position
        );
        
        if (distance > this.config.MELEE_RANGE) {
            this.logCombat('Target out of range');
            return;
        }
        
        // Perform attack
        const damage = this.calculateDamage(this.game.player, this.currentTarget);
        this.applyDamage(this.currentTarget, damage, this.game.player);
        
        this.lastCombatAction = Date.now();
    }
    
    // ========================================================================
    // DAMAGE CALCULATION
    // ========================================================================
    
    calculateDamage(attacker, defender) {
        const stats = attacker.stats || this.getDefaultStats(attacker);
        const defenderStats = defender.stats || this.getDefaultStats(defender);
        
        // Base damage from weapon + strength
        let baseDamage = stats.weaponDamage || 10;
        const strBonus = (stats.strength - 10) * 0.5; // +0.5 damage per point over 10
        baseDamage += strBonus;
        
        // Apply defender's armor
        const armorReduction = defenderStats.armor / (defenderStats.armor + 100);
        const damageAfterArmor = baseDamage * (1 - armorReduction);
        
        // Critical hit chance
        const critChance = stats.critChance || 0.05;
        const isCrit = Math.random() < critChance;
        const critMultiplier = isCrit ? (stats.critMultiplier || 2.0) : 1.0;
        
        // Final damage
        let finalDamage = Math.floor(damageAfterArmor * critMultiplier);
        
        // Variance (±10%)
        const variance = 0.9 + Math.random() * 0.2;
        finalDamage = Math.floor(finalDamage * variance);
        
        return {
            amount: Math.max(1, finalDamage),
            isCrit: isCrit,
            type: 'physical'
        };
    }
    
    calculateAbilityDamage(attacker, defender, ability) {
        const stats = attacker.stats || this.getDefaultStats(attacker);
        const defenderStats = defender.stats || this.getDefaultStats(defender);
        
        let baseDamage = ability.baseDamage || 20;
        
        // Scale with appropriate stat
        if (ability.damageType === 'physical') {
            const strBonus = (stats.strength - 10) * ability.scaling;
            baseDamage += strBonus;
            
            // Apply armor
            const armorReduction = defenderStats.armor / (defenderStats.armor + 100);
            baseDamage *= (1 - armorReduction);
        } else if (ability.damageType === 'magical') {
            const intBonus = (stats.intelligence - 10) * ability.scaling;
            baseDamage += intBonus;
            
            // Apply magic resist
            const resistReduction = defenderStats.magicResist / (defenderStats.magicResist + 100);
            baseDamage *= (1 - resistReduction);
        }
        
        return {
            amount: Math.floor(baseDamage),
            isCrit: false,
            type: ability.damageType
        };
    }
    
    // ========================================================================
    // DAMAGE APPLICATION
    // ========================================================================
    
    applyDamage(target, damageInfo, attacker) {
        if (!target || target.isDead) return;
        
        const damage = damageInfo.amount;
        
        // Reduce HP
        target.stats = target.stats || this.getDefaultStats(target);
        target.stats.currentHP = Math.max(0, target.stats.currentHP - damage);
        
        // Show damage number
        this.showDamageNumber(target, damage, damageInfo.isCrit, damageInfo.type);
        
        // Update target frame
        if (this.game.ui && this.game.ui.updateTargetFrame) {
            this.game.ui.updateTargetFrame(target);
        }
        
        // Log
        const attackerName = attacker === this.game.player ? 'You' : attacker.name;
        const critText = damageInfo.isCrit ? ' (CRIT!)' : '';
        this.logCombat(`${attackerName} hit ${target.name} for ${damage}${critText}`);
        
        // Check death
        if (target.stats.currentHP <= 0) {
            this.handleDeath(target, attacker);
        } else {
            // Enemy retaliates (aggro)
            if (target.isEnemy && !target.inCombat) {
                target.enterCombat(attacker);
            }
        }
        
        this.lastCombatAction = Date.now();
    }
    
    handleDeath(target, killer) {
        target.isDead = true;
        target.stats.currentHP = 0;
        
        // Log
        const killerName = killer === this.game.player ? 'You' : killer.name;
        this.logCombat(`💀 ${killerName} defeated ${target.name}!`);
        
        // Award XP if player killed enemy
        if (killer === this.game.player && target.isEnemy) {
            const xp = target.stats.xpValue || 50;
            this.awardExperience(killer, xp);
            
            // Drop loot
            this.dropLoot(target);
        }
        
        // Play death animation/effects
        if (target.mesh) {
            // Fade out and remove
            const fadeSpeed = 0.02;
            const fadeInterval = setInterval(() => {
                if (target.mesh && target.mesh.material) {
                    target.mesh.material.alpha -= fadeSpeed;
                    if (target.mesh.material.alpha <= 0) {
                        clearInterval(fadeInterval);
                        target.dispose();
                    }
                }
            }, 16);
        }
        
        // Clear target if it was our target
        if (this.currentTarget === target) {
            this.setTarget(null);
        }
    }
    
    // ========================================================================
    // EXPERIENCE & LEVELING
    // ========================================================================
    
    awardExperience(player, amount) {
        if (!player.stats) return;
        
        player.stats.currentXP += amount;
        this.logCombat(`+${amount} XP`);
        
        // Check level up
        const xpNeeded = this.getXPForLevel(player.stats.level + 1);
        if (player.stats.currentXP >= xpNeeded) {
            this.levelUp(player);
        }
        
        // Update UI
        if (this.game.ui) {
            this.game.ui.updateXPBar();
        }
    }
    
    getXPForLevel(level) {
        // Exponential curve: 100 * level^1.5
        return Math.floor(100 * Math.pow(level, 1.5));
    }
    
    levelUp(player) {
        player.stats.level++;
        player.stats.currentXP = 0;
        
        // Stat increases
        player.stats.maxHP += 20;
        player.stats.currentHP = player.stats.maxHP;
        player.stats.maxMana += 10;
        player.stats.currentMana = player.stats.maxMana;
        player.stats.strength += 2;
        player.stats.armor += 1;
        
        this.logCombat(`🎉 LEVEL UP! You are now level ${player.stats.level}!`);
        
        // Visual effect
        this.showLevelUpEffect(player);
        
        // Update UI
        if (this.game.ui) {
            this.game.ui.updatePlayerStats();
        }
    }
    
    showLevelUpEffect(player) {
        if (!player.mesh) return;
        
        // Create particle burst
        const particleSystem = new BABYLON.ParticleSystem('levelUp', 500, this.scene);
        particleSystem.particleTexture = new BABYLON.Texture('https://www.babylonjs-playground.com/textures/flare.png', this.scene);
        
        particleSystem.emitter = player.mesh.position;
        particleSystem.minEmitBox = new BABYLON.Vector3(-0.5, 0, -0.5);
        particleSystem.maxEmitBox = new BABYLON.Vector3(0.5, 2, 0.5);
        
        particleSystem.color1 = new BABYLON.Color4(1, 1, 0, 1);
        particleSystem.color2 = new BABYLON.Color4(1, 0.5, 0, 1);
        particleSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0);
        
        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.5;
        particleSystem.minLifeTime = 0.5;
        particleSystem.maxLifeTime = 1.5;
        particleSystem.emitRate = 500;
        
        particleSystem.gravity = new BABYLON.Vector3(0, 9.8, 0);
        particleSystem.direction1 = new BABYLON.Vector3(-1, 1, -1);
        particleSystem.direction2 = new BABYLON.Vector3(1, 1, 1);
        
        particleSystem.minEmitPower = 5;
        particleSystem.maxEmitPower = 10;
        particleSystem.updateSpeed = 0.01;
        
        particleSystem.start();
        
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => particleSystem.dispose(), 2000);
        }, 500);
    }
    
    // ========================================================================
    // ABILITY SYSTEM
    // ========================================================================
    
    useAbility(attacker, abilityKey) {
        const ability = this.getAbility(abilityKey);
        if (!ability) return false;
        
        // Check cooldown
        const now = Date.now();
        if (ability.lastUsed && (now - ability.lastUsed) < ability.cooldown) {
            const remaining = Math.ceil((ability.cooldown - (now - ability.lastUsed)) / 1000);
            this.logCombat(`${ability.name} on cooldown (${remaining}s)`);
            return false;
        }
        
        // Check global cooldown
        if (this.globalCooldown > now) {
            return false;
        }
        
        // Check mana
        const stats = attacker.stats || this.getDefaultStats(attacker);
        if (stats.currentMana < ability.manaCost) {
            this.logCombat('Not enough mana');
            return false;
        }
        
        // Check target if needed
        if (ability.requiresTarget && !this.currentTarget) {
            this.logCombat('No target selected');
            return false;
        }
        
        // Check range
        if (ability.requiresTarget) {
            const distance = BABYLON.Vector3.Distance(
                attacker.mesh.position,
                this.currentTarget.mesh.position
            );
            if (distance > ability.range) {
                this.logCombat('Target out of range');
                return false;
            }
        }
        
        // Use ability
        stats.currentMana -= ability.manaCost;
        ability.lastUsed = now;
        this.globalCooldown = now + this.config.GLOBAL_COOLDOWN;
        
        // Show cooldown in UI
        if (this.game.ui && this.game.ui.showAbilityCooldown && ability.hotkey) {
            this.game.ui.showAbilityCooldown(ability.hotkey, ability.cooldown);
        }
        
        // Execute ability effect
        this.executeAbility(attacker, ability);
        
        this.logCombat(`Used ${ability.name}`);
        this.lastCombatAction = now;
        
        return true;
    }
    
    executeAbility(attacker, ability) {
        switch (ability.type) {
            case 'damage':
                // CRITICAL: Only damage enemies, not NPCs
                if (!this.currentTarget || !this.currentTarget.isEnemy) {
                    this.logCombat('Cannot attack NPCs');
                    return;
                }
                
                const damage = this.calculateAbilityDamage(attacker, this.currentTarget, ability);
                this.applyDamage(this.currentTarget, damage, attacker);
                
                // Visual effect
                this.showAbilityEffect(attacker, this.currentTarget, ability);
                break;
                
            case 'heal':
                this.applyHealing(attacker, ability.healAmount);
                break;
                
            case 'buff':
                this.applyBuff(attacker, ability);
                break;
                
            case 'aoe':
                this.performAOEAttack(attacker, ability);
                break;
        }
    }
    
    applyHealing(target, amount) {
        if (!target.stats) return;
        
        const healAmount = Math.min(amount, target.stats.maxHP - target.stats.currentHP);
        target.stats.currentHP += healAmount;
        
        this.showDamageNumber(target, healAmount, false, 'heal');
        this.logCombat(`Healed for ${healAmount}`);
    }
    
    performAOEAttack(attacker, ability) {
        const pos = attacker.mesh.position;
        
        for (const enemy of this.game.world.enemies) {
            if (enemy.isDead || !enemy.mesh) continue;
            
            const dist = BABYLON.Vector3.Distance(pos, enemy.mesh.position);
            if (dist <= ability.radius) {
                const damage = this.calculateAbilityDamage(attacker, enemy, ability);
                this.applyDamage(enemy, damage, attacker);
            }
        }
        
        // Visual effect
        this.showAOEEffect(attacker, ability);
    }
    
    // ========================================================================
    // VISUAL EFFECTS
    // ========================================================================
    
    showDamageNumber(target, amount, isCrit, type) {
        if (!target.mesh) return;
        
        const damageText = this.createDamageText(amount, isCrit, type);
        damageText.position = target.mesh.position.clone();
        damageText.position.y += 2;
        
        // Animate upward
        let time = 0;
        const duration = 1.5;
        const interval = setInterval(() => {
            time += 0.016;
            damageText.position.y += 0.02;
            
            if (time >= duration) {
                clearInterval(interval);
                damageText.dispose();
            }
        }, 16);
    }
    
    createDamageText(amount, isCrit, type) {
        const plane = BABYLON.MeshBuilder.CreatePlane('damage', { size: 1 }, this.scene);
        
        const texture = new BABYLON.DynamicTexture('damageTexture', 256, this.scene);
        const mat = new BABYLON.StandardMaterial('damageMat', this.scene);
        mat.diffuseTexture = texture;
        mat.emissiveTexture = texture;
        mat.opacityTexture = texture;
        mat.backFaceCulling = false;
        plane.material = mat;
        
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        
        // Draw text
        const ctx = texture.getContext();
        const text = String(amount);
        
        let color = 'white';
        let fontSize = isCrit ? 80 : 60;
        if (type === 'heal') color = 'lightgreen';
        if (isCrit) color = 'yellow';
        
        ctx.fillStyle = color;
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(text, 128, 128);
        texture.update();
        
        return plane;
    }
    
    showAbilityEffect(attacker, target, ability) {
        // Simple projectile effect
        const projectile = BABYLON.MeshBuilder.CreateSphere('projectile', { diameter: 0.3 }, this.scene);
        projectile.position = attacker.mesh.position.clone();
        projectile.position.y += 1;
        
        const mat = new BABYLON.StandardMaterial('projMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(1, 0.5, 0);
        projectile.material = mat;
        
        // Move to target
        const startPos = projectile.position.clone();
        const endPos = target.mesh.position.clone();
        endPos.y += 1;
        
        let t = 0;
        const speed = 0.05;
        const interval = setInterval(() => {
            t += speed;
            projectile.position = BABYLON.Vector3.Lerp(startPos, endPos, t);
            
            if (t >= 1) {
                clearInterval(interval);
                projectile.dispose();
            }
        }, 16);
    }
    
    showAOEEffect(attacker, ability) {
        const aoe = BABYLON.MeshBuilder.CreateDisc('aoe', { radius: ability.radius }, this.scene);
        aoe.position = attacker.mesh.position.clone();
        aoe.position.y = 0.1;
        aoe.rotation.x = Math.PI / 2;
        
        const mat = new BABYLON.StandardMaterial('aoeMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        mat.alpha = 0.5;
        aoe.material = mat;
        
        // Fade out
        let alpha = 0.5;
        const interval = setInterval(() => {
            alpha -= 0.05;
            mat.alpha = alpha;
            
            if (alpha <= 0) {
                clearInterval(interval);
                aoe.dispose();
            }
        }, 50);
    }
    
    // ========================================================================
    // COMBAT LOG
    // ========================================================================
    
    logCombat(message) {
        const timestamp = new Date().toLocaleTimeString();
        const entry = `[${timestamp}] ${message}`;
        
        this.combatLog.push(entry);
        if (this.combatLog.length > this.maxLogEntries) {
            this.combatLog.shift();
        }
        
        console.log(`[Combat] ${message}`);
        
        // Update UI
        if (this.game.ui && this.game.ui.updateCombatLog) {
            this.game.ui.updateCombatLog(entry);
        }
    }
    
    // ========================================================================
    // ABILITIES DATABASE
    // ========================================================================
    
    getAbility(key) {
        const abilities = {
            // Warrior abilities
            powerStrike: {
                name: 'Power Strike',
                key: 'powerStrike',
                type: 'damage',
                damageType: 'physical',
                baseDamage: 30,
                scaling: 1.5,
                manaCost: 15,
                cooldown: 3000,
                range: 3,
                requiresTarget: true,
                hotkey: '1'
            },
            
            cleave: {
                name: 'Cleave',
                key: 'cleave',
                type: 'aoe',
                damageType: 'physical',
                baseDamage: 20,
                scaling: 1.0,
                manaCost: 25,
                cooldown: 6000,
                radius: 5,
                requiresTarget: false,
                hotkey: '2'
            },
            
            // Mage abilities
            fireball: {
                name: 'Fireball',
                key: 'fireball',
                type: 'damage',
                damageType: 'magical',
                baseDamage: 40,
                scaling: 2.0,
                manaCost: 30,
                cooldown: 4000,
                range: 25,
                requiresTarget: true,
                hotkey: '1'
            },
            
            // Healing
            heal: {
                name: 'Heal',
                key: 'heal',
                type: 'heal',
                healAmount: 50,
                manaCost: 20,
                cooldown: 8000,
                requiresTarget: false,
                hotkey: '3'
            }
        };
        
        return abilities[key];
    }
    
    // ========================================================================
    // STATS & DEFAULTS
    // ========================================================================
    
    getDefaultStats(entity) {
        if (entity === this.game.player) {
            return {
                level: 1,
                currentXP: 0,
                maxHP: 100,
                currentHP: 100,
                maxMana: 100,
                currentMana: 100,
                strength: 10,
                intelligence: 10,
                armor: 10,
                magicResist: 10,
                weaponDamage: 10,
                critChance: 0.05,
                critMultiplier: 2.0
            };
        } else if (entity.isEnemy) {
            return {
                maxHP: 50,
                currentHP: 50,
                strength: 8,
                armor: 5,
                magicResist: 5,
                weaponDamage: 8,  // Added for enemy attacks
                xpValue: 50
            };
        }
        
        return {
            maxHP: 100,
            currentHP: 100,
            strength: 10,
            armor: 5,
            weaponDamage: 5
        };
    }
    
    // ========================================================================
    // LOOT SYSTEM
    // ========================================================================
    
    dropLoot(enemy) {
        if (!enemy.mesh || !this.game.world) return;
        
        const lootTable = this.getLootTable(enemy.type || 'wolf');
        
        // Roll for each loot item
        for (const lootEntry of lootTable) {
            const roll = Math.random();
            if (roll <= lootEntry.chance) {
                // Drop this item
                const quantity = Math.floor(
                    lootEntry.minQuantity + Math.random() * (lootEntry.maxQuantity - lootEntry.minQuantity + 1)
                );
                
                const itemData = {
                    ...lootEntry.item,
                    quantity: quantity
                };
                
                // Create world item at enemy position
                const dropPosition = enemy.mesh.position.clone();
                dropPosition.x += (Math.random() - 0.5) * 2; // Spread items
                dropPosition.z += (Math.random() - 0.5) * 2;
                
                const worldItem = new WorldItem(this.scene, dropPosition, itemData);
                this.game.world.worldItems.push(worldItem);
                
                console.log(`[Combat] ${enemy.name} dropped ${quantity}x ${itemData.name}`);
            }
        }
        
        // Always drop some gold
        const goldAmount = Math.floor(5 + Math.random() * 15);
        if (this.game.player && this.game.player.inventory) {
            this.game.player.inventory.gold += goldAmount;
            this.game.player.inventory.updateUI();
            this.logCombat(`+${goldAmount} gold`);
        }
    }
    
    getLootTable(enemyType) {
        // Define loot tables for different enemy types
        const tables = {
            wolf: [
                {
                    item: {
                        id: 'wolf_pelt',
                        name: 'Wolf Pelt',
                        icon: '🐺',
                        type: 'material',
                        rarity: 'common',
                        description: 'A thick wolf pelt. Used in crafting.',
                        value: 5,
                        stackable: true
                    },
                    chance: 0.6, // 60%
                    minQuantity: 1,
                    maxQuantity: 2
                },
                {
                    item: {
                        id: 'wolf_fang',
                        name: 'Wolf Fang',
                        icon: '🦷',
                        type: 'material',
                        rarity: 'uncommon',
                        description: 'A sharp wolf fang.',
                        value: 10,
                        stackable: true
                    },
                    chance: 0.3, // 30%
                    minQuantity: 1,
                    maxQuantity: 1
                },
                {
                    item: {
                        id: 'health_potion',
                        name: 'Health Potion',
                        icon: '🧪',
                        type: 'consumable',
                        rarity: 'common',
                        description: 'Restores 50 HP.',
                        value: 15,
                        stackable: true,
                        effect: 'heal',
                        healAmount: 50
                    },
                    chance: 0.2, // 20%
                    minQuantity: 1,
                    maxQuantity: 1
                }
            ],
            goblin: [
                {
                    item: {
                        id: 'rusty_dagger',
                        name: 'Rusty Dagger',
                        icon: '🗡️',
                        type: 'weapon',
                        equipSlot: 'weapon',
                        rarity: 'common',
                        description: 'A worn dagger.',
                        value: 20,
                        stackable: false,
                        stats: {
                            weaponDamage: 5,
                            strength: 2
                        }
                    },
                    chance: 0.15, // 15%
                    minQuantity: 1,
                    maxQuantity: 1
                },
                {
                    item: {
                        id: 'leather_cap',
                        name: 'Leather Cap',
                        icon: '🧢',
                        type: 'armor',
                        equipSlot: 'head',
                        rarity: 'common',
                        description: 'Simple leather headwear.',
                        value: 25,
                        stackable: false,
                        stats: {
                            armor: 3,
                            maxHP: 10
                        }
                    },
                    chance: 0.1, // 10%
                    minQuantity: 1,
                    maxQuantity: 1
                },
                {
                    item: {
                        id: 'goblin_ear',
                        name: 'Goblin Ear',
                        icon: '👂',
                        type: 'material',
                        rarity: 'common',
                        description: 'Proof of a goblin kill.',
                        value: 3,
                        stackable: true
                    },
                    chance: 0.7, // 70%
                    minQuantity: 1,
                    maxQuantity: 1
                }
            ]
        };
        
        return tables[enemyType] || tables.wolf;
    }
    
    // ========================================================================
    // UPDATE LOOP
    // ========================================================================
    
    update(deltaTime) {
        // Check combat timeout
        this.checkCombatTimeout();
        
        // Update target highlight position
        if (this.currentTarget && this.currentTarget.targetHighlight) {
            this.currentTarget.targetHighlight.position.copyFrom(this.currentTarget.mesh.position);
            this.currentTarget.targetHighlight.position.y = 0.1;
        }
    }
}

// Export for use in game
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CombatSystem;
}
