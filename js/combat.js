// Basic combat system implementation
class CombatSystem {
    constructor() {
        this.players = new Map();
        this.npcs = new Map();
    }

    addPlayer(playerId, playerData) {
        this.players.set(playerId, {
            ...playerData,
            health: playerData.health || 100,
            maxHealth: playerData.maxHealth || 100,
            attack: playerData.attack || 10,
            defense: playerData.defense || 5
        });
    }

    addNpc(npcId, npcData) {
        this.npcs.set(npcId, {
            ...npcData,
            health: npcData.health || 50,
            maxHealth: npcData.maxHealth || 50,
            attack: npcData.attack || 5,
            defense: npcData.defense || 2
        });
    }

    calculateDamage(attackerId, targetId, isPlayerAttacking) {
        const attackers = isPlayerAttacking ? this.players : this.npcs;
        const targets = isPlayerAttacking ? this.npcs : this.players;
        
        const attacker = attackers.get(attackerId);
        const target = targets.get(targetId);

        if (!attacker || !target) {
            console.error('Attacker or target not found');
            return 0;
        }

        const baseDamage = Math.max(1, attacker.attack - (target.defense / 2));
        const damage = Math.floor(Math.random() * baseDamage) + 1;
        
        target.health = Math.max(0, target.health - damage);
        
        if (target.health <= 0) {
            if (isPlayerAttacking) {
                this.npcs.delete(targetId);
            } else {
                this.players.delete(targetId);
            }
            return { damage, defeated: true };
        }
        
        return { damage, defeated: false };
    }

    getHealth(id, isPlayer) {
        const combatants = isPlayer ? this.players : this.npcs;
        const combatant = combatants.get(id);
        return combatant ? { 
            current: combatant.health, 
            max: combatant.maxHealth 
        } : null;
    }
}

// Create a global combat system instance if it doesn't exist
if (typeof window.combatSystem === 'undefined') {
    window.combatSystem = new CombatSystem();
}

export { CombatSystem };
