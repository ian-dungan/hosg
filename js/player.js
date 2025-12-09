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
        
        // ADDED: Swimming Movement Speeds (START)
        this.swimSpeed = 2.5;          // Base swim speed
        this.swimUpForce = 7.0;        // Force to swim up (for jump button)
        this.swimDownForce = -4.0;     // Force to swim down (for crouch/run button)
        // ADDED: Swimming Movement Speeds (END)
        
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
        
        // ADDED: Swimming state (START)
        this.isSwimming = false;
        this.swimBoostCooldown = 0.0;
        this.swimCooldownDuration = 0.5; // Cooldown time for directional swim boost (in seconds)
        // ADDED: Swimming state (END)
        
        // Internal flags
        this._waitingLogged = false;
        
        console.log('[Player] Player created');
    }

    // MODIFIED METHOD: Only queue jump if player is on the ground (Fix #2)
    queueJump() {
        if (this.jumpHeld) return;
        
        // FIX: Only queue jump if player is on the ground
        if (this.onGround) {
            this.jumpQueued = true;
        }
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
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0, 0);

        // Add to shadow generator
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(this.mesh);
        }

        this.physicsReady = true;
        console.log('[Player] ✓ Physics collider mesh created');
    }

    async loadCharacterModel() {
        if (typeof window.ASSET_MANIFEST === 'undefined') {
            console.warn('[Player] Asset manifest not found, skipping character model');
            return;
        }

        const characterConfig = window.ASSET_MANIFEST.CHARACTERS.PLAYER.knight;
        if (!characterConfig) {
            console.warn('[Player] Knight character config not found');
            return;
        }

        const modelPath = window.ASSET_MANIFEST.BASE_PATH + characterConfig.model;
        console.log(`[Player] Loading character model: ${modelPath}`);

        try {
            const result = await BABYLON.SceneLoader.ImportMeshAsync(
                "",
                modelPath.substring(0, modelPath.lastIndexOf('/') + 1),
                modelPath.substring(modelPath.lastIndexOf('/') + 1),
                this.scene
            );

            console.log(`[Player] ✓ Character model loaded (${result.meshes.length} meshes)`);

            // Get root mesh and parent it to the visual root (keeps physics independent)
            this.characterModel = result.meshes[0];
            this.characterModel.parent = this.visualRoot || this.mesh;
            
            // Set position and scale based on config
            this.characterModel.position = new BABYLON.Vector3(
                characterConfig.offset.x,
                characterConfig.offset.y + (this.colliderHeight / 2), // Adjust for collider center
                characterConfig.offset.z
            );
            this.characterModel.scaling.scaleInPlace(characterConfig.scale);

            // Hide the placeholder collision mesh
            this.mesh.isVisible = false;

            // Load animations
            const anims = characterConfig.animations;
            result.animationGroups.forEach(group => {
                const name = group.name;
                for (const animName in anims) {
                    if (anims[animName] === name) {
                        this.animations[animName] = group;
                    }
                }
            });

            // Play initial animation
            this.playAnimation('idle');

        } catch (error) {
            console.error('[Player] FAILED to load character model:', error);
        }
    }
    
    playAnimation(name) {
        if (!this.characterModel || this.currentAnimation === name) return;

        // Stop current
        if (this.currentAnimation && this.animations[this.currentAnimation]) {
            this.animations[this.currentAnimation].stop();
        }

        // Play new
        const animation = this.animations[name];
        if (animation) {
            animation.play(true);
            this.currentAnimation = name;
        } else {
            console.warn(`[Player] Animation '${name}' not found.`);
        }
    }

    // NEW METHOD: Handles animation switching based on state (Fix #1: Walk/Run Animation)
    updateAnimation(hasMovement, isRunning) {
        if (!this.characterModel) return;

        // Priority 1: Combat/Attack animations would go here
        // ...

        if (!this.onGround && !this.isSwimming) {
            // Priority 2: In the air
            this.playAnimation('jump');
        } else if (this.isSwimming) {
            // Priority 3: Swimming (using walk/idle for movement/treading water)
            this.playAnimation(hasMovement ? 'walk' : 'idle');
        } else if (hasMovement) {
            // Priority 4: Moving on the ground
            if (isRunning) {
                this.playAnimation('run'); // Plays 'run' animation when running
            } else {
                this.playAnimation('walk');
            }
        } else {
            // Priority 5: Idle
            this.playAnimation('idle');
        }
    }
    
    // Smooth angle interpolation helper
    lerpAngle(a, b, t) {
        let diff = b - a;
        if (diff > Math.PI) diff -= (Math.PI * 2);
        if (diff < -Math.PI) diff += (Math.PI * 2);
        return a + diff * t;
    }
    
    setupCamera() {
        // Create arc rotate camera
        this.camera = new BABYLON.ArcRotateCamera(
            'playerCamera',
            -Math.PI / 2, // Start facing forward
            Math.PI / 3, // 60 degrees down
            10, // 10 units away
            this.mesh.position,
            this.scene
        );

        this.camera.lowerRadiusLimit = 3;
        this.camera.upperRadiusLimit = 20;
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
        
        // Make camera follow player
        this.camera.lockedTarget = this.mesh;
        this.scene.activeCamera = this.camera;
        console.log('[Player] ✓ Camera setup complete');
    }

    setupInput() {
        const canvas = this.scene.getEngine().getRenderingCanvas();
        // PATCH: Prevent mobile scrolling
        if (canvas) {
            canvas.style.touchAction = "none";
        }
        
        this.scene.actionManager = new BABYLON.ActionManager(this.scene);
        
        const map = {}; // Key map for inputs
        this.scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, (evt) => {
            map[evt.sourceEvent.key] = evt.sourceEvent.type === "keydown";
            
            // Movement
            this.input.forward = map['w'] || map['W'] || map['ArrowUp'];
            this.input.backward = map['s'] || map['S'] || map['ArrowDown'];
            this.input.left = map['a'] || map['A'] || map['ArrowLeft'];
            this.input.right = map['d'] || map['D'] || map['ArrowRight'];

            // Actions
            this.input.run = map['Shift'] || map['shift'];
            
            if (map[' ']) {
                this.queueJump(); // Handle jump key down
            }
        }));

        this.scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, (evt) => {
            map[evt.sourceEvent.key] = evt.sourceEvent.type === "keydown";
            
            // Movement
            this.input.forward = map['w'] || map['W'] || map['ArrowUp'];
            this.input.backward = map['s'] || map['S'] || map['ArrowDown'];
            this.input.left = map['a'] || map['A'] || map['ArrowLeft'];
            this.input.right = map['d'] || map['D'] || map['ArrowRight'];

            // Actions
            this.input.run = map['Shift'] || map['shift'];
            
            if (evt.sourceEvent.key === ' ') {
                this.releaseJump(); // Handle jump key up
            }
            
            // Targeting key (T)
            if (evt.sourceEvent.key === 't' || evt.sourceEvent.key === 'T') {
                this.targetNext();
            }
        }));
        
        // Mouse click for targeting
        this.scene.onPointerDown = (evt, pickInfo) => {
            if (evt.button === 0) { // Left mouse button
                this.handlePointerDown(pickInfo);
            }
        };
        
        console.log('[Player] ✓ Input setup complete');
    }

    setupGamepad() {
        const gamepads = new BABYLON.GamepadManager(this.scene);

        gamepads.onGamepadConnectedObservable.add((gamepad, state) => {
            this.gamepad.connected = true;
            console.log('[Player] Gamepad connected:', gamepad.id);

            if (gamepad.type === BABYLON.Gamepad.GamepadType.XBox) {
                const xboxpad = gamepad;
                
                // Left stick for movement
                xboxpad.onLeftStickChanged((values) => {
                    this.gamepad.moveX = values.x;
                    this.gamepad.moveY = values.y;
                    
                    const DEADZONE = 0.1;
                    const RUNZONE = 0.8;
                    
                    // Convert stick input to binary input for animation/logic simplicity
                    this.input.forward = values.y > DEADZONE;
                    this.input.backward = values.y < -DEADZONE;
                    this.input.right = values.x > DEADZONE;
                    this.input.left = values.x < -DEADZONE;
                    
                    // Treat high stick displacement as run
                    const dist = Math.sqrt(values.x * values.x + values.y * values.y);
                    this.input.run = dist > RUNZONE;
                });
                
                // Right stick for camera look
                xboxpad.onRightStickChanged((values) => {
                    this.gamepad.lookX = values.x;
                    this.gamepad.lookY = values.y;
                });
                
                // A button (0) - Jump
                xboxpad.onButtonDown(0, () => {
                    this.queueJump();
                });
                xboxpad.onButtonUp(0, () => {
                    this.releaseJump();
                });
                
                // B button (1) - Run/Action (We'll use it to activate swim down if aquatic)
                xboxpad.onButtonDown(1, () => {
                    this.input.run = true;
                });
                xboxpad.onButtonUp(1, () => {
                    this.input.run = false;
                });
                
                // X button (2) - Target next enemy (with debounce)
                xboxpad.onButtonDown(2, () => {
                    if (!this.gamepad.targetButtonWasPressed) {
                        this.targetNext();
                        this.gamepad.targetButtonWasPressed = true;
                    }
                });
                xboxpad.onButtonUp(2, () => {
                    this.gamepad.targetButtonWasPressed = false;
                });
                
            } else {
                // Generic gamepad setup (simplified)
                gamepad.onAxisChangedObservable.add((axis, value) => {
                    const DEADZONE = 0.1;
                    const RUNZONE = 0.8;
                    
                    // Left Stick (Axis 0, 1)
                    if (axis === 0) this.gamepad.moveX = value;
                    if (axis === 1) this.gamepad.moveY = value;
                    
                    // Right Stick (Axis 2, 3)
                    if (axis === 2) this.gamepad.lookX = value;
                    if (axis === 3) this.gamepad.lookY = value;

                    // Update binary input from stick
                    if (axis === 0 || axis === 1) {
                        const moveX = this.gamepad.moveX;
                        const moveY = this.gamepad.moveY;
                        this.input.forward = moveY > DEADZONE;
                        this.input.backward = moveY < -DEADZONE;
                        this.input.right = moveX > DEADZONE;
                        this.input.left = moveX < -DEADZONE;
                        const dist = Math.sqrt(moveX * moveX + moveY * moveY);
                        this.input.run = dist > RUNZONE;
                    }
                });
                
                // Generic button mapping (assuming button 0 is jump, 1 is action)
                gamepad.onButtonDownObservable.add((button) => {
                    if (button === 0) this.queueJump(); // Jump
                    if (button === 1) this.input.run = true; // Run/Action
                    if (button === 2) this.targetNext(); // Target
                });
                gamepad.onButtonUpObservable.add((button) => {
                    if (button === 0) this.releaseJump(); // Jump
                    if (button === 1) this.input.run = false; // Run/Action
                });
            }
        });

        gamepads.onGamepadDisconnectedObservable.add((gamepad) => {
            this.gamepad.connected = false;
            console.log('[Player] Gamepad disconnected:', gamepad.id);
        });
    }

    // MODIFIED METHOD: Main Update loop incorporating swimming, new animation, and jump fix (Fix #1, #2, #3)
    update(dt) {
        if (!this.mesh || !this.physicsReady) {
            if (!this._waitingLogged) {
                console.log('[Player] Waiting for physics to be ready...');
                this._waitingLogged = true;
            }
            return;
        }

        // 1. Get Environment State (Requires world.js change)
        const world = this.scene.game?.world;
        // Use a safe fallback water level if world isn't ready or method doesn't exist
        const waterLevel = world && typeof world.getWaterLevel === 'function' ? world.getWaterLevel() : -100;
        this.isSwimming = this.mesh.position.y <= waterLevel;

        // 2. Movement Vector Calculation
        let moveX = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0) + this.gamepad.moveX;
        let moveZ = (this.input.backward ? 1 : 0) - (this.input.forward ? 1 : 0) + this.gamepad.moveY;

        let moveDir = new BABYLON.Vector3(moveX, 0, moveZ);
        if (moveDir.lengthSquared() > 1) {
            moveDir = moveDir.normalize();
        }
        const hasMovement = moveDir.lengthSquared() > 0.0001;

        // 3. Speed & Running State
        let speed;
        // isRunning is true only on ground and when input is active
        const isRunning = this.input.run && hasMovement && !this.isSwimming;
        
        if (this.isSwimming) {
            speed = this.swimSpeed; // Use swim speed
        } else {
            speed = this.speed;
            if (isRunning) {
                speed *= this.runMultiplier;
            }
        }

        // 4. Vertical Velocity & Jump/Swim Logic
        this.swimBoostCooldown = Math.max(0, this.swimBoostCooldown - dt);
        this.isOnGround = this.onGround; // Update UI flag

        if (this.isSwimming) {
            // FIX: Swimming Physics
            // Apply buoyancy/dampening
            this.verticalVelocity *= 0.7; // Dampen vertical velocity for control
            this.onGround = false; // Cannot be on ground when swimming

            if (this.input.jump && this.swimBoostCooldown === 0) {
                // Swim up
                this.verticalVelocity = this.swimUpForce;
                this.swimBoostCooldown = this.swimCooldownDuration;
            } else if (this.input.run && this.swimBoostCooldown === 0) {
                // Swim down (using run/crouch button for underwater descent)
                this.verticalVelocity = this.swimDownForce;
                this.swimBoostCooldown = this.swimCooldownDuration;
            }
        } else if (this.onGround) {
            this.verticalVelocity = 0; // Reset velocity when on ground

            // Jump Execution (Checks for both input and queued jump)
            if (this.input.jump || this.jumpQueued) {
                this.verticalVelocity = this.jumpForce;
                this.onGround = false;
                this.jumpQueued = false; // Consume the queued jump
                this.input.jump = false; // Consume keyboard input
                this.jumpHeld = true; // For gamepad tracking
            }
        } else {
            // Apply gravity if not on ground and not swimming
            this.verticalVelocity += this.gravity * dt;
        }

        // 5. Apply Displacement & Collisions
        let displacement = hasMovement ? moveDir.scale(speed * dt) : BABYLON.Vector3.Zero();
        
        // Vertical displacement
        displacement.y = this.verticalVelocity * dt;
        
        // Adjust horizontal movement dampening when swimming (optional but useful)
        if (this.isSwimming) {
            displacement.x *= 0.8;
            displacement.z *= 0.8;
        }

        const previousPosition = this.mesh.position.clone();
        this.mesh.moveWithCollisions(displacement);

        // 6. Update Facing
        const moved = this.mesh.position.subtract(previousPosition);
        const flatMovement = new BABYLON.Vector3(moved.x, 0, moved.z);

        if (flatMovement.lengthSquared() > 0.0001) {
            const targetRotation = Math.atan2(flatMovement.x, flatMovement.z) + Math.PI; // Adjust angle for Babylon coordinates
            const currentRotation = this.visualRoot.rotation.y;
            this.visualRoot.rotation.y = this.lerpAngle(currentRotation, targetRotation, this.rotationSpeed);
            this.lastFacing = this.visualRoot.rotation.y;
        }

        // 7. Update Animation
        this.updateAnimation(hasMovement, isRunning);

        // Update camera position
        this.updateCamera(dt);
        this.updateTargeting();
    }
    
    // Simple camera update to keep camera fixed to player
    updateCamera(dt) {
        if (this.camera && this.mesh) {
            // Smoothly move the camera target to the mesh position
            const target = this.camera.lockedTarget;
            target.x = BABYLON.Scalar.Lerp(target.x, this.mesh.position.x, 0.5);
            target.y = BABYLON.Scalar.Lerp(target.y, this.mesh.position.y + 1, 0.5); // Lift target slightly
            target.z = BABYLON.Scalar.Lerp(target.z, this.mesh.position.z, 0.5);
            
            // Handle gamepad look input
            const lookSpeed = 2.0;
            if (Math.abs(this.gamepad.lookX) > 0.1) {
                this.camera.alpha -= this.gamepad.lookX * lookSpeed * dt;
            }
            if (Math.abs(this.gamepad.lookY) > 0.1) {
                // Vertical orbit (up/down) - INVERTED
                this.camera.beta -= this.gamepad.lookY * lookSpeed * dt;
                const minBeta = 0.2;
                const maxBeta = Math.PI - 0.2;
                if (this.camera.beta < minBeta) this.camera.beta = minBeta;
                if (this.camera.beta > maxBeta) this.camera.beta = maxBeta;
            }
        }
    }
    
    // Target nearby entities (simplified implementation)
    updateTargeting() {
        if (!this.currentTarget || this.currentTarget._isDisposed) {
            this.currentTarget = null;
            if (this.targetHighlight) {
                this.targetHighlight.dispose();
                this.targetHighlight = null;
            }
            return;
        }
        
        // Ensure highlight is present
        if (!this.targetHighlight) {
            this.createTargetHighlight();
        }
    }
    
    // Find and set the next target (cycling through enemies)
    targetNext() {
        const enemies = this.scene.game?.world?.enemies || [];
        if (enemies.length === 0) return;
        
        let targetIndex = -1;
        
        if (this.currentTarget) {
            // Find current target index
            targetIndex = enemies.findIndex(e => e.mesh === this.currentTarget);
        }
        
        // Cycle to next enemy
        targetIndex = (targetIndex + 1) % enemies.length;
        
        const nextEnemy = enemies[targetIndex];
        if (nextEnemy && nextEnemy.mesh) {
            this.setTarget(nextEnemy.mesh);
        }
    }

    setTarget(mesh) {
        // Assume mesh has a parent Entity object with a position property
        this.currentTarget = mesh; 
        console.log(`[Player] Target set to ${mesh.name}`);
        this.createTargetHighlight();
    }
    
    createTargetHighlight() {
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
        }
        
        // Create ring around target
        this.targetHighlight = BABYLON.MeshBuilder.CreateTorus('targetHighlight', { diameter: 3, thickness: 0.1, tessellation: 32 }, this.scene);
        this.targetHighlight.rotation.x = Math.PI / 2; // Lay flat
        this.targetHighlight.position.y = this.currentTarget.position.y + 0.02; // Slight lift
        this.targetHighlight.parent = this.currentTarget; // Parent to the current target mesh
        
        // Red glow material
        const mat = new BABYLON.StandardMaterial('targetMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        mat.disableLighting = true;
        this.targetHighlight.material = mat;
        
        // Animate highlight
        const startTime = Date.now();
        this.scene.onBeforeRenderObservable.add(() => {
            if (!this.targetHighlight || !this.currentTarget) return;
            
            const time = (Date.now() - startTime) / 1000;
            
            // Pulse scale
            this.targetHighlight.scaling.setAll(1 + Math.sin(time * 3) * 0.1);
            
            // Follow target
            this.targetHighlight.position.x = this.currentTarget.position.x;
            this.targetHighlight.position.z = this.currentTarget.position.z;
        });
    }
    
    // Handle mouse click targeting
    handlePointerDown(pickInfo) {
        if (!pickInfo.hit) return;
        
        const mesh = pickInfo.pickedMesh;
        if (!mesh || !mesh.metadata) return;
        
        // Check if clicked mesh is targetable
        if (mesh.metadata.isEnemy || mesh.metadata.isNPC) {
            this.setTarget(mesh);
        }
    }
    
    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
        }
        if (this.camera) {
            this.camera.dispose();
        }
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
        }
        // Cleanup gamepad manager and input listeners would be ideal here too
        console.log('[Player] Disposed');
    }
}
