// ===========================================================
// HEROES OF SHADY GROVE - ABILITY CLASS v1.0.1 (COOLDOWN FIX)
// Fix: Implemented the getCooldownRatio() method for UI.
// ===========================================================

class Ability {
    constructor(template) {
        if (!template || !template.id) {
            throw new Error('Ability template must be provided and have an ID.');
        }

        this.id = template.id;
        this.code = template.code;
        this.name = template.name;
        this.type = template.skill_type; 
        this.resourceCost = template.resource_cost || { mana: 0, stamina: 0 }; 
        this.cooldownDuration = (template.cooldown_ms || 0) / 1000; 
        this.effectData = template.effect || {}; 
        this.currentCooldown = 0; 
    }

    execute(caster, target) {
        // TODO: Resource check (mana/stamina)

        // --- 1. Calculate Damage/Effect ---
        if (this.effectData.type === 'damage') {
            const baseDamage = this.effectData.base_value || 0;
            const magicScaling = this.effectData.magic_scaling || 0;
            const physicalScaling = this.effectData.physical_scaling || 0;
            
            const damage = baseDamage + 
                           (caster.stats.magicPower * magicScaling) + 
                           (caster.stats.attackPower * physicalScaling);
            
            if (target && target.takeDamage) {
                target.takeDamage(damage, caster);
                const messageType = caster.isPlayer ? 'enemyDamage' : 'playerDamage';
                caster.scene.game.ui.showMessage(`${this.name} hits ${target.name} for ${damage.toFixed(0)}!`, 1500, messageType);
            } else {
                caster.scene.game.ui.showMessage(`[${this.name}] Requires a target.`, 1500, 'error');
                return false;
            }
        } else if (this.effectData.type === 'heal') {
            const healAmount = this.effectData.base_value || 0;
            caster.health = Math.min(caster.stats.maxHealth, caster.health + healAmount);
            caster.scene.game.ui.showMessage(`Healed for ${healAmount}!`, 1500, 'heal');
        } else {
            caster.scene.game.ui.showMessage(`[${this.name}] Effect activated.`, 1500, 'info');
        }
        
        // --- 2. Start Cooldown ---
        this.currentCooldown = this.cooldownDuration;
        return true;
    }

    isReady() {
        return this.currentCooldown <= 0;
    }

    update(deltaTime) {
        if (this.currentCooldown > 0) {
            this.currentCooldown -= deltaTime;
        }
    }
    
    // Returns a ratio (0.0 to 1.0) of how much cooldown is remaining. 
    // Used for UI visual feedback. 1.0 means full cooldown, 0.0 means ready.
    getCooldownRatio() {
        if (this.cooldownDuration <= 0) return 0;
        // If currentCooldown is 5, and duration is 10, ratio is 0.5 (halfway through cooldown)
        return Math.min(1.0, this.currentCooldown / this.cooldownDuration);
    }
}

window.Ability = Ability;
