// ============================================================================
// HEROES OF SHADY GROVE - ENEMY AI SYSTEM
// Complete behavior system for hostile NPCs
// ============================================================================

class EnemyAI {
    constructor(enemy) {
        this.enemy = enemy;
        this.scene = enemy.scene;
        
        // AI States
        this.state = 'idle'; // idle, patrol, chase, attack, return
        this.previousState = 'idle';
        
        // Spawn point (for returning)
        this.spawnPoint = enemy.mesh ? enemy.mesh.position.clone() : new BABYLON.Vector3(0, 0, 0);
        this.spawnRadius = enemy.spawnRadius || 15;
        
        // Stats from template
        this.aggroRange = (enemy.stats && enemy.stats.aggro_range) || 15;
        this.attackRange = 2.5;
        this.chaseRange = this.aggroRange * 2; // Stop chasing if player gets this far
        this.returnSpeed = (enemy.stats && enemy.stats.speed) || 1.0;
        this.attackCooldown = 1.5; // Seconds between attacks
        this.lastAttackTime = 0;
        
        // Patrol behavior
        this.patrolPoints = [];
        this.currentPatrolIndex = 0;
        this.patrolWaitTime = 3; // Seconds to wait at each point
        this.patrolTimer = 0;
        this.generatePatrolPoints();
        
        // Target tracking
        this.target = null;
        this.lastKnownTargetPosition = null;
        
        // Movement
        this.moveSpeed = this.returnSpeed * 0.08; // Adjusted for game scale
        this.rotationSpeed = 0.1;
        
        // Timers
        this.stateTimer = 0;
        this.aggroCheckInterval = 0.5; // Check for aggro every 0.5 seconds
        this.aggroCheckTimer = 0;
        
        console.log(`[AI] ${enemy.name} initialized - aggro range: ${this.aggroRange}`);
    }
    
    generatePatrolPoints() {
        // Create 3-5 patrol points around spawn
        const numPoints = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < numPoints; i++) {
            const angle = (Math.PI * 2 / numPoints) * i + (Math.random() * 0.5);
            const distance = (this.spawnRadius * 0.5) + (Math.random() * this.spawnRadius * 0.5);
            
            const x = this.spawnPoint.x + Math.cos(angle) * distance;
            const z = this.spawnPoint.z + Math.sin(angle) * distance;
            
            // Get terrain height if world is available
            let y = this.spawnPoint.y;
            if (this.scene.game && this.scene.game.world) {
                y = this.scene.game.world.getHeightAt(x, z) + 1;
            }
            
            this.patrolPoints.push(new BABYLON.Vector3(x, y, z));
        }
    }
    
    update(deltaTime) {
        if (!this.enemy.mesh || !this.enemy.isAlive) return;
        
        // Update timers
        this.stateTimer += deltaTime;
        this.aggroCheckTimer += deltaTime;
        
        // State machine
        switch (this.state) {
            case 'idle':
                this.updateIdle(deltaTime);
                break;
            case 'patrol':
                this.updatePatrol(deltaTime);
                break;
            case 'chase':
                this.updateChase(deltaTime);
                break;
            case 'attack':
                this.updateAttack(deltaTime);
                break;
            case 'return':
                this.updateReturn(deltaTime);
                break;
        }
        
        // Check for aggro periodically (not every frame)
        if (this.aggroCheckTimer >= this.aggroCheckInterval) {
            this.aggroCheckTimer = 0;
            this.checkForAggro();
        }
    }
    
    // ==================== IDLE STATE ====================
    
    updateIdle(deltaTime) {
        // Wait for a bit, then start patrolling
        if (this.stateTimer > 2 + Math.random() * 3) {
            this.setState('patrol');
        }
    }
    
    // ==================== PATROL STATE ====================
    
    updatePatrol(deltaTime) {
        if (this.patrolPoints.length === 0) {
            this.setState('idle');
            return;
        }
        
        const targetPoint = this.patrolPoints[this.currentPatrolIndex];
        const distance = BABYLON.Vector3.Distance(this.enemy.mesh.position, targetPoint);
        
        if (distance < 2) {
            // Reached patrol point, wait a bit
            this.patrolTimer += deltaTime;
            if (this.patrolTimer >= this.patrolWaitTime) {
                this.patrolTimer = 0;
                this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolPoints.length;
            }
        } else {
            // Move toward patrol point
            this.moveToward(targetPoint, this.moveSpeed * 0.6, deltaTime); // Slower patrol speed
        }
    }
    
    // ==================== CHASE STATE ====================
    
    updateChase(deltaTime) {
        if (!this.target || !this.target.mesh || !this.target.isAlive) {
            this.setState('return');
            return;
        }
        
        const distanceToTarget = BABYLON.Vector3.Distance(
            this.enemy.mesh.position,
            this.target.mesh.position
        );
        
        // Check if target escaped
        if (distanceToTarget > this.chaseRange) {
            console.log(`[AI] ${this.enemy.name} lost target (too far)`);
            this.setState('return');
            return;
        }
        
        // Check if in attack range
        if (distanceToTarget <= this.attackRange) {
            this.setState('attack');
            return;
        }
        
        // Chase the target
        this.lastKnownTargetPosition = this.target.mesh.position.clone();
        this.moveToward(this.target.mesh.position, this.moveSpeed, deltaTime);
    }
    
    // ==================== ATTACK STATE ====================
    
    updateAttack(deltaTime) {
        if (!this.target || !this.target.mesh || !this.target.isAlive) {
            this.setState('return');
            return;
        }
        
        const distanceToTarget = BABYLON.Vector3.Distance(
            this.enemy.mesh.position,
            this.target.mesh.position
        );
        
        // Target moved out of range
        if (distanceToTarget > this.attackRange * 1.5) {
            this.setState('chase');
            return;
        }
        
        // Face the target
        this.faceTarget(this.target.mesh.position, deltaTime);
        
        // Attack if cooldown is ready
        const now = performance.now() / 1000;
        if (now - this.lastAttackTime >= this.attackCooldown) {
            this.performAttack();
            this.lastAttackTime = now;
        }
    }
    
    performAttack() {
        if (!this.target || !this.scene.game || !this.scene.game.combat) return;
        
        // Use combat system to handle attack
        const damage = this.enemy.damage || (this.enemy.stats && this.enemy.stats.attack) || 10;
        
        console.log(`[AI] ${this.enemy.name} attacks ${this.target.name} for ${damage} damage`);
        
        // Apply damage through combat system
        if (this.scene.game.combat && this.scene.game.combat.dealDamage) {
            this.scene.game.combat.dealDamage(this.enemy, this.target, damage);
        } else if (this.target.takeDamage) {
            this.target.takeDamage(damage, this.enemy);
        }
        
        // Play attack animation if available
        if (this.enemy.playAnimation) {
            this.enemy.playAnimation('attack');
        }
    }
    
    // ==================== RETURN STATE ====================
    
    updateReturn(deltaTime) {
        const distanceToSpawn = BABYLON.Vector3.Distance(
            this.enemy.mesh.position,
            this.spawnPoint
        );
        
        // Reached spawn point
        if (distanceToSpawn < 3) {
            // Reset health when returning to spawn
            if (this.enemy.maxHealth) {
                this.enemy.health = this.enemy.maxHealth;
            }
            
            this.target = null;
            this.setState('idle');
            console.log(`[AI] ${this.enemy.name} returned to spawn point`);
            return;
        }
        
        // Move toward spawn
        this.moveToward(this.spawnPoint, this.moveSpeed * 1.2, deltaTime); // Faster return
    }
    
    // ==================== AGGRO DETECTION ====================
    
    checkForAggro() {
        // Don't check for aggro if already engaged or returning
        if (this.state === 'chase' || this.state === 'attack') return;
        
        // Find player
        const player = this.scene.game && this.scene.game.player;
        if (!player || !player.mesh || !player.isAlive) return;
        
        // Check if player is in aggro range
        const distanceToPlayer = BABYLON.Vector3.Distance(
            this.enemy.mesh.position,
            player.mesh.position
        );
        
        if (distanceToPlayer <= this.aggroRange) {
            console.log(`[AI] ${this.enemy.name} aggroed on player at distance ${distanceToPlayer.toFixed(1)}`);
            this.target = player;
            this.setState('chase');
        }
    }
    
    // ==================== MOVEMENT HELPERS ====================
    
    moveToward(targetPosition, speed, deltaTime) {
        if (!this.enemy.mesh) return;
        
        const direction = targetPosition.subtract(this.enemy.mesh.position);
        direction.y = 0; // Move only on XZ plane
        
        const distance = direction.length();
        if (distance < 0.1) return;
        
        direction.normalize();
        
        // Move toward target
        const movement = direction.scale(speed * deltaTime);
        this.enemy.mesh.position.addInPlace(movement);
        
        // Adjust Y to terrain height
        if (this.scene.game && this.scene.game.world) {
            const terrainY = this.scene.game.world.getHeightAt(
                this.enemy.mesh.position.x,
                this.enemy.mesh.position.z
            );
            this.enemy.mesh.position.y = terrainY + 0.9; // Half height of enemy
        }
        
        // Rotate to face movement direction
        this.faceTarget(targetPosition, deltaTime);
        
        // Play walk animation if available
        if (this.enemy.playAnimation && this.enemy.currentAnimation !== 'walk') {
            this.enemy.playAnimation('walk');
        }
    }
    
    faceTarget(targetPosition, deltaTime) {
        if (!this.enemy.mesh) return;
        
        const direction = targetPosition.subtract(this.enemy.mesh.position);
        direction.y = 0;
        
        if (direction.length() < 0.1) return;
        
        const targetRotation = Math.atan2(direction.x, direction.z);
        const currentRotation = this.enemy.mesh.rotation.y;
        
        // Smooth rotation
        let rotationDiff = targetRotation - currentRotation;
        
        // Normalize to -PI to PI
        while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
        while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;
        
        this.enemy.mesh.rotation.y += rotationDiff * this.rotationSpeed;
    }
    
    // ==================== STATE MANAGEMENT ====================
    
    setState(newState) {
        if (this.state === newState) return;
        
        console.log(`[AI] ${this.enemy.name} ${this.state} -> ${newState}`);
        
        this.previousState = this.state;
        this.state = newState;
        this.stateTimer = 0;
        
        // State-specific setup
        switch (newState) {
            case 'idle':
                if (this.enemy.playAnimation) {
                    this.enemy.playAnimation('idle');
                }
                break;
                
            case 'patrol':
                this.patrolTimer = 0;
                break;
                
            case 'chase':
                if (this.enemy.playAnimation) {
                    this.enemy.playAnimation('run');
                }
                break;
                
            case 'attack':
                if (this.enemy.playAnimation) {
                    this.enemy.playAnimation('attack');
                }
                break;
                
            case 'return':
                this.target = null;
                break;
        }
    }
    
    // ==================== UTILITY ====================
    
    forceAggro(target) {
        this.target = target;
        this.setState('chase');
    }
    
    reset() {
        this.target = null;
        this.setState('idle');
        if (this.enemy.mesh) {
            this.enemy.mesh.position.copyFrom(this.spawnPoint);
        }
    }
    
    dispose() {
        this.target = null;
        this.enemy = null;
        this.scene = null;
    }
}

// Export
window.EnemyAI = EnemyAI;
console.log('[AI] EnemyAI system loaded');
