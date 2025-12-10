// ============================================================
// HEROES OF SHADY GROVE - ABILITY CLASS (ES5 SAFE)
// Handles resource costs and cooldowns without class syntax so
// legacy browsers can parse the file before player.js executes.
// ============================================================

function Ability(template) {
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

Ability.prototype.execute = function (caster, target) {
    // --- 1. Calculate Damage/Effect ---
    if (this.effectData.type === 'damage') {
        var baseDamage = this.effectData.base_value || 0;
        var magicScaling = this.effectData.magic_scaling || 0;
        var physicalScaling = this.effectData.physical_scaling || 0;

        var damage = baseDamage +
            (caster.stats.magicPower * magicScaling) +
            (caster.stats.attackPower * physicalScaling);

        if (target && target.takeDamage) {
            var messageType = caster.isPlayer ? 'enemyDamage' : 'playerDamage';
            target.takeDamage(damage, caster);
            caster.scene.game.ui.showMessage(this.name + ' hits ' + target.name + ' for ' + damage.toFixed(0) + '!', 1500, messageType);
        } else {
            caster.scene.game.ui.showMessage('[' + this.name + '] Requires a target.', 1500, 'error');
            return false;
        }
    } else if (this.effectData.type === 'heal') {
        var healAmount = this.effectData.base_value || 0;
        caster.health = Math.min(caster.stats.maxHealth, caster.health + healAmount);
        caster.scene.game.ui.showMessage('Healed for ' + healAmount + '!', 1500, 'heal');
    } else {
        caster.scene.game.ui.showMessage('[' + this.name + '] Effect activated.', 1500, 'info');
    }

    // --- 2. Start Cooldown ---
    this.currentCooldown = this.cooldownDuration;
    return true;
};

Ability.prototype.isReady = function () {
    return this.currentCooldown <= 0;
};

Ability.prototype.update = function (deltaTime) {
    if (this.currentCooldown > 0) {
        this.currentCooldown -= deltaTime;
    }
};

Ability.prototype.getCooldownRatio = function () {
    return Math.min(1, Math.max(0, this.currentCooldown / this.cooldownDuration));
};

window.Ability = Ability;
