// Player class - CLEAN REWRITE
class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.visualRoot = null; // Rotated visuals attached to collider
        this.camera = null;
        this.characterModel = null;
        
        // Movement speeds (units per second)
        this.speed = 5.5;              // Base walk speed
        this.runMultiplier = 1.8;      // Run multiplier
        this.jumpForce = 8.5;          // Jump initial velocity (units/second)
        this.gravity = -18;            // Gravity acceleration (units/second^2)
        this.rotationSpeed = 0.1;

        // Collider dimensions (used for physics + ground detection)
        this.colliderHeight = 1.8;
        this.colliderRadius = 0.4;
        this.groundOffset = this.colliderHeight / 2; // Distance from center to feet
        
        // Input state
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            run: false,
            jump: false
        };
        
        // Gamepad state
        this.gamepad = {
            connected: false,
            moveX: 0,
            moveY: 0,
            lookX: 0,
            lookY: 0
        };
        
        // Animation state
        this.animations = {
            idle: null,
            walk: null,
            run: null,
            jump: null
        };
        this.currentAnimation = null;
        
        // Combat & targeting
        this.currentTarget = null;
        this.targetHighlight = null;
        
        // Player stats
        this.health = CONFIG.PLAYER.HEALTH || 100;
        this.maxHealth = CONFIG.PLAYER.HEALTH || 100;
        this.stamina = CONFIG.PLAYER.STAMINA || 100;
        this.maxStamina = CONFIG.PLAYER.STAMINA || 100;
        this.mana = 100;
        this.maxMana = 100;
        this.isOnGround = true; // For UI
        
        // Physics ready flag
        this.physicsReady = false;
        this.onGround = true;
        this.verticalVelocity = 0; // For gravity simulation
        this.lastFacing = 0; // Preserve facing between frames
        this.jumpQueued = false; // Requires release before next jump
        this.jumpHeld = false;
        
        // Internal flags
        this._waitingLogged = false;
        
        console.log('[Player] Player created');
    }

    queueJump() {
        if (this.jumpHeld) return;
        this.jumpQueued = true;
    }

    releaseJump() {
        this.jumpHeld = false;
    }
    
    // Wait for terrain physics to be ready, then create player
    async init() {
        console.log('[Player] Waiting for terrain to be ready...');
        
        // Wait for terrain with timeout
        const terrain = await this.waitForTerrain(100); // 10 seconds
        if (!terrain) {
            console.error('[Player] TERRAIN TIMEOUT - Creating player anyway at y=10');
            this.createPlayerMesh(10);
            await this.loadCharacterModel();
            this.setupCamera();
            this.setupInput();
            this.setupGamepad();
            return;
        }
        
        console.log('[Player] ✓ Terrain ready, creating player...');
        
        // Get spawn height from terrain - spawn ON the ground!
        const world = this.scene.game?.world;
        let spawnY = this.groundOffset + 0.5; // Fallback if world not ready (center position)
        
        if (world && typeof world.getTerrainHeight === 'function') {
            const groundY = world.getTerrainHeight(0, 0);
            spawnY = groundY + this.groundOffset + 0.2; // Centered on collider with slight lift
            console.log(`[Player] Ground at y=${groundY.toFixed(2)}, spawning at y=${spawnY.toFixed(2)}`);
        } else {
            console.warn('[Player] Could not get terrain height, using fallback center spawn');
        }
        
        // Create player mesh (spawns directly at spawnY, no extra offset)
        this.createPlayerMesh(spawnY);
        
        // Load character model
        await this.loadCharacterModel();
        
        // Setup camera
        this.setupCamera();
        
        // Setup input (keyboard + gamepad)
        this.setupInput();
        this.setupGamepad();
        
        // FORCE initial ground snap
        setTimeout(() => {
            if (this.scene.world && typeof this.scene.world.getTerrainHeight === 'function') {
                const groundY = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
                this.mesh.position.y = groundY + this.groundOffset;
                this.onGround = true;
                this.isOnGround = true; // For UI
                this.verticalVelocity = 0;
                console.log(`[Player] ✓ Snapped to ground at y=${this.mesh.position.y.toFixed(2)}, onGround=true`);
            }
        }, 100);
        
        console.log('[Player] ✓ Player initialized and ready');
    }
    
    // Called by world when it's fully ready
    // Hook for future physics implementation
    startAfterWorldReady() {
        console.log('[Player] ✓ World ready signal received');
        // TODO: Re-enable physics here when reimplemented
    }
    
    async waitForTerrain(maxAttempts) {
        for (let i = 0; i < maxAttempts; i++) {
            // PATCH: Checking for 'terrain' mesh specifically
            const terrain = this.scene.getMeshByName('terrain');
            
            if (terrain && terrain.isEnabled() && terrain.checkCollisions) {
                console.log(`[Player] Found terrain after ${i + 1} attempts`);
                return terrain;
            }
            
            if (i % 10 === 0 && i > 0) {
                console.log(`[Player] Still waiting... (${i}/${maxAttempts})`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        return null;
    }
    
    createPlayerMesh(spawnY) {
        // Create an invisible capsule-like box collider for the player
        this.mesh = BABYLON.MeshBuilder.CreateBox('player', {
            width: this.colliderRadius * 2,
            height: this.colliderHeight,
            depth: this.colliderRadius * 2
        }, this.scene);

        // Spawn at center position (feet at spawnY - groundOffset)
        this.mesh.position = new BABYLON.Vector3(0, spawnY, 0);

        // MAKE MOSTLY INVISIBLE
        this.mesh.visibility = 0;
        this.mesh.isVisible = false;
        this.mesh.isPickable = false;
        this.mesh.renderingGroupId = -1; // Don't render at all

        // Visual root used for rotation without affecting physics body
        this.visualRoot = new BABYLON.TransformNode('playerVisualRoot', this.scene);
        this.visualRoot.parent = this.mesh;
        this.visualRoot.position = BABYLON.Vector3.Zero();

        // Use Babylon's built-in collision system instead of physics for stability
        this.mesh.checkCollisions = true;
        this.mesh.ellipsoid = new BABYLON.Vector3(this.colliderRadius, this.colliderHeight / 2, this.colliderRadius);
        // FIX: The SyntaxError was here (missing closing parenthesis on Vector3 constructor)
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, this.groundOffset, 0); 
        this.mesh.position = BABYLON.Vector3.Zero();
    }
    
    // ... (rest of Player class methods: loadCharacterModel, setupAnimations, etc.)
}
