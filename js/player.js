class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.camera = null;
        this.inventory = new Inventory(CONFIG.PLAYER.INVENTORY_SIZE);
        this.velocity = new BABYLON.Vector3();
        this.isOnGround = false;
        this.health = CONFIG.PLAYER.HEALTH;
        this.maxHealth = CONFIG.PLAYER.HEALTH;
        this.moveSpeed = CONFIG.PLAYER.MOVE_SPEED;
        this.jumpForce = CONFIG.PLAYER.JUMP_FORCE;
        
        // Gamepad support
        this.gamepad = null;
        this.gamepadIndex = -1;
        this.lastJumpButton = false;
        
        // Animation
        this.walkCycle = 0;
        this.visualRoot = null;
        this.leftLeg = null;
        this.rightLeg = null;
        
        // Safety system for falling through world
        this.safeSpawnPosition = new BABYLON.Vector3(0, 5, 0);
        this.fallThroughThreshold = -10; // If below this Y, reset position
        this.spawnHeightSet = false;
        
        this.init();
    }

    init() {
        this.createPlayerMesh();
        this.setupCamera();
        this.setupInput();
    }

    // In the Player class, replace createPlayerMesh() with:
async createPlayerMesh() {
    // Physics body (invisible box)
    this.mesh = BABYLON.MeshBuilder.CreateBox('player', {
        width: CONFIG.PLAYER.WIDTH || 0.7,
        height: CONFIG.PLAYER.HEIGHT || 1.8,
        depth: CONFIG.PLAYER.DEPTH || 0.5
    }, this.scene);
    
    // Spawn at safe height (will drop to terrain)
    this.mesh.position.y = CONFIG.PLAYER.SPAWN_HEIGHT || 20;
    this.mesh.visibility = 0.3; // Make slightly visible for debugging
    
    // Try to load custom model, fall back to default if not found
    try {
        await this.loadCharacterModel();
        console.log('[Player] Custom character model loaded');
    } catch (error) {
        console.warn('[Player] Failed to load custom model, using default', error);
        this.createKnightModel();
    }
    
    // Enhanced physics with better values for smooth movement
    this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
        this.mesh,
        BABYLON.PhysicsImpostor.BoxImpostor,
        { 
            mass: CONFIG.PLAYER.MASS || 15,
            friction: CONFIG.PLAYER.FRICTION || 0.2,
            restitution: 0.0
        },
        this.scene
    );
    
    // Apply damping to prevent sliding
    this.mesh.physicsImpostor.physicsBody.linearDamping = CONFIG.PLAYER.LINEAR_DAMPING || 0.3;
    this.mesh.physicsImpostor.physicsBody.angularDamping = CONFIG.PLAYER.ANGULAR_DAMPING || 0.9;
}

// Add this new method to load the character model
async loadCharacterModel() {
    if (!window.AssetLoader || !ASSET_MANIFEST.PLAYER?.model) {
        throw new Error('AssetLoader not available or player model not configured');
    }

    const loader = new AssetLoader(this.scene);
    const playerConfig = ASSET_MANIFEST.PLAYER;
    
    // Load the model
    const model = await loader.loadModel(playerConfig.model, {
        scaling: new BABYLON.Vector3(
            playerConfig.scale || 1,
            playerConfig.scale || 1,
            playerConfig.scale || 1
        )
    });

    if (!model || !model.root) {
        throw new Error('Failed to load player model');
    }

    // Set up the model
    this.visualRoot = model.root;
    this.visualRoot.parent = this.mesh;
    this.visualRoot.position.y = -((playerConfig.height || 1.8) / 2); // Center vertically
    
    // Store animations if available
    if (model.animationGroups && model.animationGroups.length > 0) {
        this.animations = {};
        model.animationGroups.forEach(animGroup => {
            this.animations[animGroup.name.toLowerCase()] = animGroup;
        });
        console.log('[Player] Loaded animations:', Object.keys(this.animations));
    }

    // Set up animation properties
    this.currentAnimation = null;
    this.animationBlendSpeed = 0.1;
    
    // Play default idle animation if available
    this.playAnimation('idle', true);
}

// Add this method to handle animations
playAnimation(name, loop = true) {
    const animName = name.toLowerCase();
    
    // Don't restart the same animation
    if (this.currentAnimation === animName || !this.animations) return;
    
    // Stop current animation
    if (this.currentAnimation && this.animations[this.currentAnimation]) {
        this.animations[this.currentAnimation].stop();
    }
    
    // Start new animation
    if (this.animations[animName]) {
        const anim = this.animations[animName];
        anim.loopAnimation = loop;
        anim.start(true);
        this.currentAnimation = animName;
    } else {
        console.warn(`[Player] Animation not found: ${animName}`);
    }
}

// Update the update method to handle animations
update(deltaTime) {
    if (!this.mesh || !this.mesh.physicsImpostor) return;

    // Poll gamepad if available
    this.updateGamepadInput();

    // Get movement direction from camera
    const forward = this.camera.getFrontPosition(1).subtract(this.camera.position).normalize();
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    forward.y = 0;
    right.y = 0;
    forward.normalize();
    right.normalize();

    // Calculate movement vector
    const moveDirection = new BABYLON.Vector3();
    if (this.input.forward) moveDirection.addInPlace(forward);
    if (this.input.backward) moveDirection.subtractInPlace(forward);
    if (this.input.left) moveDirection.subtractInPlace(right);
    if (this.input.right) moveDirection.addInPlace(right);

    // Handle animations based on movement
    if (moveDirection.lengthSquared() > 0) {
        moveDirection.normalize();
        const isRunning = this.input.run && this.isOnGround;
        this.playAnimation(isRunning ? 'run' : 'walk');
    } else {
        this.playAnimation('idle');
    }

    // Rest of your existing update code...
    // ... (keep all the existing movement and physics code)
}
        
        // Start at safe height
        this.mesh.position = new BABYLON.Vector3(0, 50, 0);
        this.mesh.visibility = 0;
        
        // Create knight character as visual
        this.createKnightModel();
        
        console.log('[Player] Mesh created at y=50, waiting for terrain...');
        
        // Wait for terrain, then setup physics
        this.waitForTerrainAndSpawn();
    }
    
    waitForTerrainAndSpawn() {
        let attempts = 0;
        const maxAttempts = 200; // 20 seconds max
        
        const checkTerrain = () => {
            attempts++;
            
            // Try multiple ways to access terrain
            const world = this.scene.game?.world || window.gameWorld;
            const terrain = world?.terrain || this.scene.getMeshByName('terrain');
            
            if (terrain && terrain.isEnabled()) {
                console.log(`[Player] ✓ Terrain found after ${attempts} attempts`);
                
                // Use raycast to find EXACT ground position
                const spawnX = 0;
                const spawnZ = 0;
                const rayStart = new BABYLON.Vector3(spawnX, 200, spawnZ);
                const rayEnd = new BABYLON.Vector3(spawnX, -200, spawnZ);
                const ray = new BABYLON.Ray(rayStart, rayEnd.subtract(rayStart).normalize(), 400);
                
                const hit = this.scene.pickWithRay(ray, (mesh) => mesh === terrain);
                
                if (hit && hit.hit) {
                    const groundY = hit.pickedPoint.y;
                    
                    // Get water level to ensure we spawn above it
                    const waterLevel = (world?.options?.waterLevel || 0.2) * (world?.options?.maxHeight || 20);
                    
                    // Spawn at ground + 2.5, OR above water, whichever is higher
                    const minSpawnY = Math.max(groundY + 2.5, waterLevel + 1.5);
                    
                    // TELEPORT to exact position
                    this.mesh.position = new BABYLON.Vector3(spawnX, minSpawnY, spawnZ);
                    this.safeSpawnPosition.copyFrom(this.mesh.position);
                    
                    console.log(`[Player] ✓ Spawned at y=${minSpawnY.toFixed(2)} (ground=${groundY.toFixed(2)}, water=${waterLevel.toFixed(2)})`);
                    
                    // NOW create physics
                    this.createPhysicsImpostor();
                    
                    // Mark as successfully spawned
                    this.spawnHeightSet = true;
                    
                } else {
                    // Fallback - use world.getHeightAt
                    const groundY = world?.getHeightAt?.(spawnX, spawnZ) || 0;
                    const waterLevel = (world?.options?.waterLevel || 0.2) * (world?.options?.maxHeight || 20);
                    const minSpawnY = Math.max(groundY + 2.5, waterLevel + 1.5);
                    
                    this.mesh.position = new BABYLON.Vector3(spawnX, minSpawnY, spawnZ);
                    this.safeSpawnPosition.copyFrom(this.mesh.position);
                    
                    console.log(`[Player] ✓ Spawned at y=${minSpawnY.toFixed(2)} (fallback, water=${waterLevel.toFixed(2)})`);
                    
                    this.createPhysicsImpostor();
                    this.spawnHeightSet = true;
                }
                
            } else if (attempts < maxAttempts) {
                // Log progress
                if (attempts % 20 === 0) {
                    console.log(`[Player] Still waiting for terrain... (${attempts}/${maxAttempts})`);
                }
                setTimeout(checkTerrain, 100);
            } else {
                // Emergency fallback
                console.warn('[Player] ⚠️ Terrain wait timeout - emergency spawn at y=5');
                this.mesh.position = new BABYLON.Vector3(0, 5, 0);
                this.safeSpawnPosition.copyFrom(this.mesh.position);
                this.createPhysicsImpostor();
                this.spawnHeightSet = true;
            }
        };
        
        // Start checking immediately
        checkTerrain();
    }
    
    createPhysicsImpostor() {
        if (this.mesh.physicsImpostor) {
            console.warn('[Player] Physics impostor already exists!');
            return;
        }
        
        // Create physics with VERY aggressive settings
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { 
                mass: 20,           // Heavy to resist glitches
                friction: 0.5,      // Good ground grip
                restitution: 0.0    // No bouncing
            },
            this.scene
        );
        
        // Lock rotation so player doesn't tip over
        const body = this.mesh.physicsImpostor.physicsBody;
        if (body) {
            body.linearDamping = 0.2;
            body.angularDamping = 1.0;  // Max damping
            body.fixedRotation = true;   // Prevent tipping
            body.updateMassProperties();
            
            console.log('[Player] ✓ Physics impostor created');
            console.log(`[Player]   - Mass: ${body.mass}`);
            console.log(`[Player]   - Position: (${body.position.x.toFixed(1)}, ${body.position.y.toFixed(1)}, ${body.position.z.toFixed(1)})`);
            console.log(`[Player]   - Fixed rotation: ${body.fixedRotation}`);
        } else {
            console.error('[Player] ❌ Physics body is NULL!');
        }
    }
    
    setProperSpawnHeight() {
        // Legacy method - now handled by waitForTerrainAndSpawn()
        let attempts = 0;
        const maxAttempts = 100;
        
        const checkWorld = () => {
            attempts++;
            
            const world = this.scene.game?.world;
            
            if (world && world.terrain && typeof world.getHeightAt === 'function') {
                const groundHeight = world.getHeightAt(0, 0);
                
                // Place player just above ground (height 1.8 = player height, +0.5 = safety buffer)
                const spawnY = groundHeight + 2.3;
                
                // Set position FIRST
                this.mesh.position = new BABYLON.Vector3(0, spawnY, 0);
                
                // NOW create physics impostor at correct position
                this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                    this.mesh,
                    BABYLON.PhysicsImpostor.BoxImpostor,
                    { 
                        mass: 15,           // Heavier = more stable, less sliding
                        friction: 0.2,      // Ground friction
                        restitution: 0.0    // No bounce
                    },
                    this.scene
                );
                
                // Apply damping to prevent sliding
                this.mesh.physicsImpostor.physicsBody.linearDamping = 0.3;
                this.mesh.physicsImpostor.physicsBody.angularDamping = 0.9;
                
                // Store as safe spawn position for fall-through recovery
                this.safeSpawnPosition = new BABYLON.Vector3(0, spawnY, 0);
                this.spawnHeightSet = true;
                
                console.log(`[Player] ✓ Spawned at y=${spawnY.toFixed(2)} (ground=${groundHeight.toFixed(2)}) after ${attempts} attempts`);
            } else {
                // World not ready yet
                if (attempts < maxAttempts) {
                    if (attempts % 10 === 0) {
                        console.log(`[Player] Waiting for world... (attempt ${attempts}/${maxAttempts})`);
                    }
                    setTimeout(checkWorld, 100);
                } else {
                    // Fallback: spawn at safe default height
                    console.warn('[Player] World load timeout! Using fallback spawn at y=5');
                    this.mesh.position = new BABYLON.Vector3(0, 5, 0);
                    
                    // Create physics at fallback position
                    this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                        this.mesh,
                        BABYLON.PhysicsImpostor.BoxImpostor,
                        { mass: 15, friction: 0.2, restitution: 0.0 },
                        this.scene
                    );
                    this.mesh.physicsImpostor.physicsBody.linearDamping = 0.3;
                    this.mesh.physicsImpostor.physicsBody.angularDamping = 0.9;
                    
                    this.safeSpawnPosition = new BABYLON.Vector3(0, 5, 0);
                    this.spawnHeightSet = true;
                }
            }
        };
        
        checkWorld();
    }
    
    resetToSafePosition() {
        if (!this.mesh) return;
        
        // Reset position
        this.mesh.position.copyFrom(this.safeSpawnPosition);
        
        // Stop all velocity if physics exists
        if (this.mesh.physicsImpostor) {
            this.mesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
            this.mesh.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
        }
        
        console.log(`[Player] ✓ Reset to safe position (${this.safeSpawnPosition.y.toFixed(2)})`);
    }
    
    createKnightModel() {
        // Container for all visual parts
        const visualRoot = new BABYLON.TransformNode('knightVisual', this.scene);
        visualRoot.parent = this.mesh;
        visualRoot.position.y = -0.9; // Adjust to align with physics box
        this.visualRoot = visualRoot;
        
        // Materials
        const armorMat = new BABYLON.StandardMaterial('armorMat', this.scene);
        armorMat.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.65);
        armorMat.specularColor = new BABYLON.Color3(0.8, 0.8, 0.8);
        armorMat.specularPower = 64;
        
        const clothMat = new BABYLON.StandardMaterial('clothMat', this.scene);
        clothMat.diffuseColor = new BABYLON.Color3(0.5, 0.1, 0.1);
        
        const skinMat = new BABYLON.StandardMaterial('skinMat', this.scene);
        skinMat.diffuseColor = new BABYLON.Color3(0.9, 0.75, 0.65);
        
        // Torso (armored chest)
        const torso = BABYLON.MeshBuilder.CreateBox('torso', {
            width: 0.6, height: 0.8, depth: 0.4
        }, this.scene);
        torso.parent = visualRoot;
        torso.position.y = 1.0;
        torso.material = armorMat;
        
        // Head (helmet)
        const head = BABYLON.MeshBuilder.CreateSphere('head', {
            diameter: 0.4, segments: 8
        }, this.scene);
        head.parent = visualRoot;
        head.position.y = 1.6;
        head.material = armorMat;
        
        // Visor (face guard)
        const visor = BABYLON.MeshBuilder.CreateBox('visor', {
            width: 0.35, height: 0.15, depth: 0.25
        }, this.scene);
        visor.parent = head;
        visor.position = new BABYLON.Vector3(0, 0, 0.12);
        visor.material = armorMat;
        
        // Shoulders (pauldrons)
        const leftShoulder = BABYLON.MeshBuilder.CreateSphere('leftShoulder', {
            diameter: 0.35, segments: 8
        }, this.scene);
        leftShoulder.parent = visualRoot;
        leftShoulder.position = new BABYLON.Vector3(-0.4, 1.3, 0);
        leftShoulder.scaling.y = 0.7;
        leftShoulder.material = armorMat;
        
        const rightShoulder = leftShoulder.clone('rightShoulder');
        rightShoulder.parent = visualRoot;
        rightShoulder.position.x = 0.4;
        
        // Arms
        const leftArm = BABYLON.MeshBuilder.CreateCylinder('leftArm', {
            height: 0.7, diameter: 0.15
        }, this.scene);
        leftArm.parent = visualRoot;
        leftArm.position = new BABYLON.Vector3(-0.4, 0.75, 0);
        leftArm.material = clothMat;
        
        const rightArm = leftArm.clone('rightArm');
        rightArm.parent = visualRoot;
        rightArm.position.x = 0.4;
        
        // Hands (gauntlets)
        const leftHand = BABYLON.MeshBuilder.CreateBox('leftHand', {
            width: 0.15, height: 0.2, depth: 0.15
        }, this.scene);
        leftHand.parent = visualRoot;
        leftHand.position = new BABYLON.Vector3(-0.4, 0.35, 0);
        leftHand.material = armorMat;
        
        const rightHand = leftHand.clone('rightHand');
        rightHand.parent = visualRoot;
        rightHand.position.x = 0.4;
        
        // Belt
        const belt = BABYLON.MeshBuilder.CreateCylinder('belt', {
            height: 0.15, diameter: 0.65
        }, this.scene);
        belt.parent = visualRoot;
        belt.position.y = 0.55;
        belt.material = armorMat;
        
        // Legs (armored)
        const leftLeg = BABYLON.MeshBuilder.CreateCylinder('leftLeg', {
            height: 0.9, diameterTop: 0.18, diameterBottom: 0.15
        }, this.scene);
        leftLeg.parent = visualRoot;
        leftLeg.position = new BABYLON.Vector3(-0.15, 0, 0);
        leftLeg.material = armorMat;
        this.leftLeg = leftLeg;
        
        const rightLeg = leftLeg.clone('rightLeg');
        rightLeg.parent = visualRoot;
        rightLeg.position.x = 0.15;
        this.rightLeg = rightLeg;
        
        // Feet (armored boots)
        const leftFoot = BABYLON.MeshBuilder.CreateBox('leftFoot', {
            width: 0.2, height: 0.15, depth: 0.3
        }, this.scene);
        leftFoot.parent = visualRoot;
        leftFoot.position = new BABYLON.Vector3(-0.15, -0.5, 0.05);
        leftFoot.material = armorMat;
        
        const rightFoot = leftFoot.clone('rightFoot');
        rightFoot.parent = visualRoot;
        rightFoot.position.x = 0.15;
        
        // Cape
        const cape = BABYLON.MeshBuilder.CreatePlane('cape', {
            width: 0.5, height: 0.8
        }, this.scene);
        cape.parent = visualRoot;
        cape.position = new BABYLON.Vector3(0, 0.8, -0.25);
        cape.material = clothMat;
        
        console.log('[Player] Knight character model created');
    }

    setupCamera() {
        this.camera = new BABYLON.FollowCamera('playerCam', 
            new BABYLON.Vector3(0, 1.6, -5), 
            this.scene, 
            this.mesh
        );
        this.camera.radius = 5;
        this.camera.heightOffset = 1.6;
        this.scene.activeCamera = this.camera;
    }

    setupInput() {
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            run: false
        };

        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (key === 'w' || key === 'arrowup') this.input.forward = true;
            if (key === 's' || key === 'arrowdown') this.input.backward = true;
            if (key === 'a' || key === 'arrowleft') this.input.left = true;
            if (key === 'd' || key === 'arrowright') this.input.right = true;
            if (key === ' ') this.input.jump = true;
            if (key === 'shift') this.input.run = true;
        });

        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (key === 'w' || key === 'arrowup') this.input.forward = false;
            if (key === 's' || key === 'arrowdown') this.input.backward = false;
            if (key === 'a' || key === 'arrowleft') this.input.left = false;
            if (key === 'd' || key === 'arrowright') this.input.right = false;
            if (key === ' ') this.input.jump = false;
            if (key === 'shift') this.input.run = false;
        });
    }

    update(deltaTime) {
        if (!this.mesh) {
            console.warn('[Player] Update called but mesh is null!');
            return;
        }
        
        if (!this.mesh.physicsImpostor) {
            if (!this._loggedNoPhysics) {
                console.warn('[Player] Update called but physics impostor not ready yet');
                this._loggedNoPhysics = true;
            }
            return;
        }

        // Poll gamepad if available
        this.updateGamepadInput();
        
        // DEBUG: Log input state once when movement is attempted
        if (!this._loggedInput && (this.input.forward || this.input.backward || this.input.left || this.input.right)) {
            console.log('[Player] Input detected:', this.input);
            console.log('[Player] Physics ready:', !!this.mesh.physicsImpostor);
            console.log('[Player] Position:', this.mesh.position.y.toFixed(2));
            this._loggedInput = true;
        }

        // Get movement direction from camera
        const forward = this.camera.getFrontPosition(1).subtract(this.camera.position).normalize();
        const right = this.camera.getDirection(BABYLON.Vector3.Right());
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();

        // Calculate movement vector (supports both keyboard and gamepad)
        const moveDirection = new BABYLON.Vector3();
        if (this.input.forward) moveDirection.addInPlace(forward);
        if (this.input.backward) moveDirection.subtractInPlace(forward);
        if (this.input.left) moveDirection.subtractInPlace(right);
        if (this.input.right) moveDirection.addInPlace(right);

        // Apply movement with improved physics
        if (moveDirection.lengthSquared() > 0) {
            moveDirection.normalize();
            
            // Speed based on running state
            const speed = this.input.run ? 
                this.moveSpeed * CONFIG.PLAYER.RUN_MULTIPLIER : 
                this.moveSpeed;
            
            // Smooth acceleration
            const velocity = moveDirection.scale(speed * deltaTime * 60);
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            
            // Apply velocity (preserve vertical component for gravity/jumping)
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    velocity.x,
                    currentVelocity.y,
                    velocity.z
                )
            );
            
            // Rotate character to face movement direction
            const targetAngle = Math.atan2(moveDirection.x, moveDirection.z);
            const currentAngle = this.mesh.rotation.y;
            
            // Smooth rotation interpolation
            let angleDiff = targetAngle - currentAngle;
            // Normalize angle difference to -PI to PI
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            
            this.mesh.rotation.y += angleDiff * 0.15; // Smooth turn speed
            
            // Animate legs while moving
            this.animateWalking(deltaTime, this.input.run);
        } else {
            // Stop movement smoothly when no input
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    currentVelocity.x * 0.85,  // Deceleration
                    currentVelocity.y,
                    currentVelocity.z * 0.85
                )
            );
            
            // Reset leg positions when standing still
            this.resetLegPositions();
        }

        // Handle jumping with improved physics
        if (this.input.jump && this.isOnGround) {
            this.jump();
        }
        
        // Ground detection
        this.checkGroundContact();
        
        // Safety check: reset if fallen through world
        this.checkFallThrough();
    }
    
    animateWalking(deltaTime, isRunning) {
        if (!this.leftLeg || !this.rightLeg) return;
        
        // Walking animation speed
        const animSpeed = isRunning ? 15 : 10;
        this.walkCycle = (this.walkCycle || 0) + deltaTime * animSpeed;
        
        // Leg swing using sine wave
        const swing = Math.sin(this.walkCycle);
        const maxSwing = isRunning ? 0.3 : 0.2;
        
        this.leftLeg.rotation.x = swing * maxSwing;
        this.rightLeg.rotation.x = -swing * maxSwing;
    }
    
    resetLegPositions() {
        if (!this.leftLeg || !this.rightLeg) return;
        
        // Smoothly return legs to neutral position
        this.leftLeg.rotation.x *= 0.9;
        this.rightLeg.rotation.x *= 0.9;
    }
    
    checkGroundContact() {
        // Raycast downward to detect ground
        const origin = this.mesh.position.clone();
        const direction = new BABYLON.Vector3(0, -1, 0);
        const length = 1.0; // Check 1 unit below
        
        const ray = new BABYLON.Ray(origin, direction, length);
        const hit = this.scene.pickWithRay(ray, (mesh) => {
            return mesh.name === 'terrain' || mesh.checkCollisions;
        });
        
        // Consider grounded if hit within threshold
        this.isOnGround = hit && hit.hit && hit.distance < 0.95;
    }
    
    checkFallThrough() {
        // AGGRESSIVE safety system - multiple checks
        if (!this.mesh) return;
        
        const y = this.mesh.position.y;
        
        // CHECK 1: Below world (most critical)
        if (y < -5) {
            console.error(`[Player] 🚨 FELL THROUGH WORLD at y=${y.toFixed(2)}! EMERGENCY TELEPORT!`);
            this.emergencyTeleport();
            return;
        }
        
        // CHECK 2: Stuck underground (y < 0.5 = probably in ground)
        if (this.spawnHeightSet && y < 0.5) {
            console.warn(`[Player] ⚠️ Stuck underground at y=${y.toFixed(2)}! Teleporting...`);
            this.emergencyTeleport();
            return;
        }
        
        // CHECK 3: Falling too fast
        if (this.mesh.physicsImpostor) {
            const velocity = this.mesh.physicsImpostor.getLinearVelocity();
            if (velocity.y < -30) {
                console.warn(`[Player] ⚠️ Excessive fall speed (${velocity.y.toFixed(1)})! Emergency stop!`);
                this.emergencyTeleport();
                return;
            }
        }
        
        // CHECK 4: Stuck detection (not moving for several frames while trying to move)
        if (!this.lastPosition) {
            this.lastPosition = this.mesh.position.clone();
            this.stuckFrames = 0;
        } else {
            const moved = BABYLON.Vector3.Distance(this.mesh.position, this.lastPosition);
            if (moved < 0.01 && this.velocity.length() > 0.1) {
                this.stuckFrames = (this.stuckFrames || 0) + 1;
                if (this.stuckFrames > 60) { // Stuck for 1 second
                    console.warn(`[Player] ⚠️ Player stuck! Teleporting to safe position...`);
                    this.emergencyTeleport();
                    this.stuckFrames = 0;
                }
            } else {
                this.stuckFrames = 0;
            }
            this.lastPosition.copyFrom(this.mesh.position);
        }
    }
    
    emergencyTeleport() {
        if (!this.mesh) return;
        
        console.log('[Player] 🆘 EMERGENCY TELEPORT TO SAFE POSITION');
        
        // IMMEDIATE position change (no interpolation)
        this.mesh.position.copyFrom(this.safeSpawnPosition);
        
        // STOP all physics movement
        if (this.mesh.physicsImpostor) {
            this.mesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
            this.mesh.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
            
            // Reset physics body to ensure clean state
            const body = this.mesh.physicsImpostor.physicsBody;
            if (body) {
                body.position.set(
                    this.safeSpawnPosition.x,
                    this.safeSpawnPosition.y,
                    this.safeSpawnPosition.z
                );
                body.velocity.set(0, 0, 0);
                body.angularVelocity.set(0, 0, 0);
                body.force.set(0, 0, 0);
                body.torque.set(0, 0, 0);
            }
        }
        
        // Reset internal velocity
        this.velocity.set(0, 0, 0);
        
        console.log(`[Player] ✓ Teleported to safe position (${this.safeSpawnPosition.y.toFixed(2)})`);
    }

    jump() {
        if (this.isOnGround && this.mesh?.physicsImpostor) {
            const velocity = this.mesh.physicsImpostor.getLinearVelocity();
            // Stronger, more responsive jump
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(velocity.x, this.jumpForce * 12, velocity.z)
            );
            this.isOnGround = false;
            console.log('[Player] Jump!');
        }
    }

    updateGamepadInput() {
        // Check for connected gamepads
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        
        if (!this.gamepad || this.gamepadIndex === -1) {
            // Find first connected gamepad
            for (let i = 0; i < gamepads.length; i++) {
                if (gamepads[i]) {
                    this.gamepad = gamepads[i];
                    this.gamepadIndex = i;
                    console.log('[Player] Gamepad connected:', this.gamepad.id);
                    break;
                }
            }
        } else {
            // Update existing gamepad reference
            this.gamepad = gamepads[this.gamepadIndex];
        }
        
        if (!this.gamepad) return;
        
        const deadzone = CONFIG.CONTROLS.GAMEPAD.DEADZONE;
        
        // Left stick - movement (axes 0 and 1)
        const leftX = Math.abs(this.gamepad.axes[0]) > deadzone ? this.gamepad.axes[0] : 0;
        const leftY = Math.abs(this.gamepad.axes[1]) > deadzone ? this.gamepad.axes[1] : 0;
        
        // Map analog stick to digital input
        if (leftY < -deadzone) this.input.forward = true;
        else if (!this.input.forward) this.input.forward = false;
        
        if (leftY > deadzone) this.input.backward = true;
        else if (!this.input.backward) this.input.backward = false;
        
        if (leftX < -deadzone) this.input.left = true;
        else if (!this.input.left) this.input.left = false;
        
        if (leftX > deadzone) this.input.right = true;
        else if (!this.input.right) this.input.right = false;
        
        // A button (0) - jump
        const jumpButton = this.gamepad.buttons[0] && this.gamepad.buttons[0].pressed;
        if (jumpButton && !this.lastJumpButton) {
            this.input.jump = true;
        } else {
            this.input.jump = false;
        }
        this.lastJumpButton = jumpButton;
        
        // Right trigger (7) or Right bumper (5) - run
        const runButton = (this.gamepad.buttons[7] && this.gamepad.buttons[7].pressed) ||
                         (this.gamepad.buttons[5] && this.gamepad.buttons[5].pressed);
        this.input.run = runButton;
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        console.log('Player died');
        // Handle player death
    }

    dispose() {
        this.mesh?.dispose();
        this.camera?.dispose();
    }
}

class Inventory {
    constructor(size) {
        this.size = size;
        this.items = [];
        this.equippedItem = null;
        this.gold = 0;
    }

    addGold(amount) {
        if (typeof amount === "number" && !isNaN(amount)) {
            this.gold += amount;
        }
    }

    addItem(item) {
        if (this.items.length < this.size) {
            this.items.push(item);
            return true;
        }
        return false;
    }

    removeItem(index) {
        if (index >= 0 && index < this.items.length) {
            return this.items.splice(index, 1)[0];
        }
        return null;
    }

    equipItem(index) {
        if (index >= 0 && index < this.items.length) {
            this.equippedItem = this.items[index];
            return true;
        }
        return false;
    }

    useEquippedItem() {
        if (this.equippedItem) {
            // Use the equipped item
            return true;
        }
        return false;
    }
}
