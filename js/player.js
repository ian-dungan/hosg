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
        this.gravity = -24;            // Gravity acceleration (units/second^2)
        this.rotationSpeed = 0.1;

        // Collider dimensions (used for physics + ground detection)
        this.colliderHeight = 1.8;
        this.colliderRadius = 0.4;
        this.groundOffset = this.colliderHeight / 2; // Distance from center to feet
        this.footPadding = 0.05; // Small lift above the terrain when snapping
        
        // Input state
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            run: false,
            jump: false,
            attack: false,
            targetNext: false,
            targetPrev: false,
            interact: false
        };
        
        // Gamepad button state
        this.gamepadButtons = {
            jump: false,
            run: false,
            attack: false
        };
        
        // Targeting
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
        
        // Movement state for animation
        this.isMoving = false;
        this.isRunning = false;
        this.isJumping = false;
        this.isAttacking = false;
        
        // Animation state
        this.currentAnimation = null;
        this.animations = {};
        
        // For debugging
        this.debug = {
            showCollider: false
        };
        
        // Initialize
        this.init();
    }

    queueJump() {
        if (this.jumpHeld) return;
        this.jumpQueued = true;
    }

    releaseJump() {
        this.jumpHeld = false;
    }
    
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
        const world = this.scene.game && this.scene.game.world;
        let spawnY = this.footPadding; // Fallback if world not ready (feet level)
        
        if (world && typeof world.getTerrainHeight === 'function') {
            const groundY = world.getTerrainHeight(0, 0);
            spawnY = groundY + this.footPadding; // Feet sit right on top of the grass
            console.log(`[Player] Ground at y=${groundY.toFixed(2)}, spawning feet at y=${spawnY.toFixed(2)}`);
        } else {
            console.warn('[Player] Could not get terrain height, using fallback center spawn');
        }
        
        this.mesh.isPickable = false;
        this.mesh.checkCollisions = true;
        this.mesh.ellipsoid = new BABYLON.Vector3(0.5, capsuleHeight / 2, 0.5);
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, capsuleHeight / 2, 0);
        
        if (!this.debug.showCollider) {
            this.mesh.visibility = 0;
        }
        
        // Setup physics
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.CapsuleImpostor,
            {
                mass: 80,
                friction: 0.9,
                restitution: 0.0
            },
            this.scene
        );
        
        // Load character model
        await this.loadCharacterModel();
        
        // Setup camera
        this.setupCamera();
        
        // Setup input
        this.setupInput();
        
        // FORCE initial ground snap
        setTimeout(() => {
            if (this.scene.world && typeof this.scene.world.getTerrainHeight === 'function') {
                const groundY = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
                this.mesh.position.y = groundY + this.footPadding;
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
            const terrain = this.scene.getMeshByName('terrain');
            
            if (terrain && terrain.isEnabled() && terrain.physicsImpostor) {
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

        // Spawn at feet position (small pad above terrain)
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
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, this.colliderHeight / 2, 0);

        this.physicsReady = true; // Allow update to run immediately

        console.log(`[Player] ✓ Player collider created at (${this.mesh.position.x}, ${this.mesh.position.y.toFixed(2)}, ${this.mesh.position.z})`);
    }
    
    async loadCharacterModel() {
        try {
            const modelPath = CONFIG.PLAYER.MODEL || "assets/models/characters/hero.glb";
            
            const result = await BABYLON.SceneLoader.ImportMeshAsync(
                "",
                "",
                modelPath,
                this.scene
            );
            
            console.log(`[Player] ✓ Character model loaded (${result.meshes.length} meshes)`);
            
            // Get root mesh and parent it to the visual root (keeps physics independent)
            this.characterModel = result.meshes[0];
            this.characterModel.parent = this.visualRoot || this.mesh;
            
            // CRITICAL: Position character model to align with physics box
            // Knight model needs to be centered and at the right height
            const offset = characterConfig.offset || { x: 0, y: -0.9, z: 0 };
            this.characterModel.position = new BABYLON.Vector3(offset.x, offset.y, offset.z);
            
            // NOTE: Don't rotate character model here - we rotate the parent mesh instead
            // If your model faces backward by default, add Math.PI to mesh rotation in update()
            
            // Create a visual root that we can rotate around
            this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
            this.visualRoot.position = new BABYLON.Vector3(0, -this.groundOffset, 0);
            this.visualRoot.parent = this.mesh;
            
            // Attach model to visual root
            this.characterModel = result.meshes[0];
            this.characterModel.parent = this.visualRoot;
            this.characterModel.position = BABYLON.Vector3.Zero();
            this.characterModel.rotationQuaternion = null;
            this.characterModel.scaling = new BABYLON.Vector3(1.0, 1.0, 1.0);
            
            // Store animations
            if (result.animationGroups && result.animationGroups.length > 0) {
                console.log(`[Player] Found ${result.animationGroups.length} animations`);
                
                const animConfig = characterConfig.animations || {};
                
                // Map animations
                result.animationGroups.forEach(anim => {
                    const name = anim.name.toLowerCase();
                    if (name.includes('idle') || (animConfig.idle && name.includes(animConfig.idle.toLowerCase()))) {
                        this.animations.idle = anim;
                    } else if (name.includes('walk') || (animConfig.walk && name.includes(animConfig.walk.toLowerCase()))) {
                        this.animations.walk = anim;
                    } else if (name.includes('run') || (animConfig.run && name.includes(animConfig.run.toLowerCase()))) {
                        this.animations.run = anim;
                    } else if (name.includes('jump') || (animConfig.jump && name.includes(animConfig.jump.toLowerCase()))) {
                        this.animations.jump = anim;
                    }
                });
            }
            
            // Setup animations
            this.setupAnimations(result.animationGroups);
            
            console.log('[Player] Character model loaded');
            
        } catch (err) {
            console.error('[Player] Failed to load character model:', err);
        }
    }
    
    setupAnimations(animationGroups) {
        if (!animationGroups || animationGroups.length === 0) return;
        
        animationGroups.forEach(group => {
            const name = group.name.toLowerCase();
            if (name.includes("idle")) {
                this.animations.idle = group;
            } else if (name.includes("walk")) {
                this.animations.walk = group;
            } else if (name.includes("run")) {
                this.animations.run = group;
            } else if (name.includes("jump")) {
                this.animations.jump = group;
            } else if (name.includes("attack")) {
                this.animations.attack = group;
            }
        });
        
        this.playAnimation("idle");
    }
    
    playAnimation(name) {
        if (!this.animations[name]) return;
        
        if (this.currentAnimation === this.animations[name]) return;
        
        if (this.currentAnimation) {
            this.currentAnimation.stop();
        }
        
        this.currentAnimation = this.animations[name];
        this.currentAnimation.start(true, 1.0, this.currentAnimation.from, this.currentAnimation.to, false);
    }
    
    setupCamera() {
        const camera = new BABYLON.ArcRotateCamera(
            "playerCamera",
            Math.PI / 2,
            Math.PI / 3,
            8,
            this.mesh.position,
            this.scene
        );
        
        camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
        
        camera.lowerRadiusLimit = 4;
        camera.upperRadiusLimit = 40;
        
        camera.wheelDeltaPercentage = 0.01;
        
        camera.checkCollisions = true;
        camera.collisionRadius = new BABYLON.Vector3(0.5, 0.5, 0.5);
        camera.useAutoRotationBehavior = false;
        
        this.camera = camera;
        
        console.log('[Player] Camera setup complete');
    }
    
    setupInput() {
    const canvas = this.scene.getEngine().getRenderingCanvas();

// Keyboard input
        this.scene.onKeyboardObservable.add((kbInfo) => {
            const key = kbInfo.event.key.toLowerCase();
            const isDown = (kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN);
            
            // Debug logging (first 10 key presses)
            if (!this._keyPressCount) this._keyPressCount = 0;
            if (this._keyPressCount < 10 && isDown) {
                console.log(`[Player] Key pressed: ${key}`);
                this._keyPressCount++;
            }
            
            switch(key) {
                // WASD keys
                case 'w': this.input.forward = isDown; break;
                case 's': this.input.backward = isDown; break;
                case 'a': this.input.left = isDown; break;
                case 'd': this.input.right = isDown; break;
                
                // Arrow keys (FIXED - not inverted)
                case 'arrowup': this.input.forward = isDown; break;
                case 'arrowdown': this.input.backward = isDown; break;
                case 'arrowleft': this.input.left = isDown; break;
                case 'arrowright': this.input.right = isDown; break;
                
                // Other controls
                case 'shift': this.input.run = isDown; break;
                case ' ':
                    if (isDown) {
                        if (!this.jumpHeld) {
                            this.queueJump();
                            console.log('[Player] JUMP pressed! onGround=' + this.onGround);
                        }
                        this.jumpHeld = true;
                    } else {
                        this.releaseJump();
                    }
                    break;
                
                // Tab key for targeting
                case 'tab':
                    if (isDown) {
                        this.targetNext();
                        kbInfo.event.preventDefault(); // Don't switch browser tabs
                    }
                    break;
            }
        });
        
        this.scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                if (pointerInfo.event.button === 0) {
                    this.input.attack = true;
                }
            }
        });
        
        const gamepadManager = new BABYLON.GamepadManager();
gamepadManager.onGamepadConnectedObservable.add((gamepad) => {
    // Some Babylon builds don’t expose BABYLON.XboxGamepad as a constructor,
    // so don’t use instanceof against it. Just accept any gamepad.
    this.gamepad.connected = true;
    this.gamepad.pad = gamepad;
    console.log('[Player] Gamepad connected:', gamepad.id || gamepad.type || 'unknown');
});

gamepadManager.onGamepadDisconnectedObservable.add((gamepad) => {
    if (this.gamepad.pad === gamepad) {
        this.gamepad.connected = false;
        this.gamepad.pad = null;
        console.log('[Player] Gamepad disconnected');
    }
});
        
        console.log('[Player] Input setup complete');
    }
    
    handleKey(event, isDown) {
        const key = event.key.toLowerCase();
        
        switch (key) {
            case "w":
            case "arrowup":
                this.input.forward = isDown;
                break;
            case "s":
            case "arrowdown":
                this.input.backward = isDown;
                break;
            case "a":
            case "arrowleft":
                this.input.left = isDown;
                break;
            case "d":
            case "arrowright":
                this.input.right = isDown;
                break;
            case "shift":
                this.input.run = isDown;
                break;
            case " ":
                this.input.jump = isDown;
                if (isDown) {
                    this.jumpQueued = true;
                    this.jumpBufferTimer = this.jumpBufferTime;
                }
            } else {
                if (!this.jumpHeld) {
                    this.queueJump();
                    this.jumpHeld = true;
                }
            }
        }

        evt.preventDefault();
    };

    const onTouchMove = (evt) => {
        if (joystickTouchId === null) return;
        if (!evt.changedTouches) return;

        for (let i = 0; i < evt.changedTouches.length; i++) {
            const t = evt.changedTouches[i];
            if (t.identifier === joystickTouchId) {
                updateFromTouch(t.clientX, t.clientY);
                break;
            case "tab":
                if (isDown) {
                    this.input.targetNext = true;
                    this.targetNext();
                }
                break;
            case "e":
                if (isDown) {
                    this.input.interact = true;
                    this.interact();
                }
                break;
        }

        this.releaseJump();

        evt.preventDefault();
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: false });
    canvas.addEventListener('touchcancel',onTouchEnd,   { passive: false });
}

setupGamepad() {
        // Gamepad connection events
        window.addEventListener('gamepadconnected', (e) => {
            console.log('[Player] Gamepad connected:', e.gamepad.id);
            this.gamepad.connected = true;
        });
        
        window.addEventListener('gamepaddisconnected', (e) => {
            console.log('[Player] Gamepad disconnected');
            this.gamepad.connected = false;
        });
        
        console.log('[Player] ✓ Gamepad support enabled');
    }
    
    updateGamepad() {
        if (!this.gamepad.connected || !this.gamepad.pad) return;
        
        const pad = this.gamepad.pad;
        
        this.gamepad.moveX = pad.leftStick.x;
        this.gamepad.moveY = pad.leftStick.y;
        
        this.gamepad.lookX = pad.rightStick.x;
        this.gamepad.lookY = pad.rightStick.y;
        
        const deadzone = 0.15;
        if (Math.abs(this.gamepad.moveX) < deadzone) this.gamepad.moveX = 0;
        if (Math.abs(this.gamepad.moveY) < deadzone) this.gamepad.moveY = 0;
        if (Math.abs(this.gamepad.lookX) < deadzone) this.gamepad.lookX = 0;
        if (Math.abs(this.gamepad.lookY) < deadzone) this.gamepad.lookY = 0;
        
        const isRunPressed = pad.buttonA; // A for run
        const isJumpPressed = pad.buttonB; // B for jump
        
        this.input.run = isRunPressed;
        
        // B button (1) or triggers - Run
        const runPressed = (gamepad.buttons[1] && gamepad.buttons[1].pressed) ||
                          (gamepad.buttons[6] && gamepad.buttons[6].pressed) ||
                          (gamepad.buttons[7] && gamepad.buttons[7].pressed);
        this.input.run = runPressed;

        // Track jump press/release so jump must be re-pressed after landing
        const jumpPressed = gamepad.buttons[0] && gamepad.buttons[0].pressed;
        if (jumpPressed) {
            if (!this.jumpHeld) {
                this.queueJump();
            }
            this.jumpHeld = true;
        } else {
            this.releaseJump();
        }
        
        // X button (2) - Target next enemy (with debounce)
        if (gamepad.buttons[2] && gamepad.buttons[2].pressed) {
            if (!this.gamepad.targetButtonWasPressed) {
                this.targetNext();
                this.gamepad.targetButtonWasPressed = true;
            }
        } else {
            this.gamepad.targetButtonWasPressed = false;
        }
        
        this.gamepadButtons.jump = isJumpPressed;
    }
    
    update(deltaTime) {
        // Debug logging (first 5 updates)
        if (!this._updateLogCount) this._updateLogCount = 0;
        if (this._updateLogCount < 5) {
            console.log(`[Player] Update #${this._updateLogCount} | meshReady=${!!this.mesh} | physicsReady=${this.physicsReady}, deltaTime=${deltaTime.toFixed(3)}`);
            this._updateLogCount++;
        }

        if (!this.mesh || !this.physicsReady) return;

        // Update gamepad state
        this.updateGamepad();

        const dt = deltaTime; // deltaTime already in seconds
        const walkSpeed = this.speed;
        const runSpeed = walkSpeed * this.runMultiplier;
        const jumpSpeed = this.jumpForce;

        // Get camera forward/right directions
        const forward = this.camera.getDirection(BABYLON.Axis.Z);
        forward.y = 0;
        forward.normalize();

        const right = this.camera.getDirection(BABYLON.Axis.X);
        right.y = 0;
        right.normalize();

        // Calculate movement direction
        let moveDir = BABYLON.Vector3.Zero();

        // Keyboard input
        if (this.input.forward) moveDir.addInPlace(forward);
        if (this.input.backward) moveDir.subtractInPlace(forward);
        if (this.input.right) moveDir.addInPlace(right);
        if (this.input.left) moveDir.subtractInPlace(right);

        // Debug logging (first 10 movements)
        if (!this._moveLogCount) this._moveLogCount = 0;
        if (this._moveLogCount < 10 && moveDir.lengthSquared() > 0) {
            console.log(`[Player] Moving! forward=${this.input.forward}, back=${this.input.backward}, left=${this.input.left}, right=${this.input.right}`);
            this._moveLogCount++;
        }

        // Gamepad input
        if (this.gamepad.connected) {
            const gamepadMove = forward.scale(-this.gamepad.moveY).add(right.scale(this.gamepad.moveX));
            moveDir.addInPlace(gamepadMove);
        }

        // Apply gravity
        this.verticalVelocity += this.gravity * dt;

        // Prevent excessive falling speed
        const terminalVelocity = -50;
        if (this.verticalVelocity < terminalVelocity) {
            this.verticalVelocity = terminalVelocity;
        }

        // Determine ground height
        let groundY = 0;
        if (this.scene.world && typeof this.scene.world.getTerrainHeight === "function") {
            groundY = this.scene.world.getTerrainHeight(
                this.mesh.position.x,
                this.mesh.position.z
            );
        }

        // GRAVITY (apply before movement so vertical velocity is included in displacement)
        if (!this.onGround) {
            this.verticalVelocity += this.gravity * dt;
        } else {
            this.verticalVelocity = 0;
            this._gravityLogCount = 0; // Reset counter when on ground
        }

        // JUMP (must release and press again to queue another jump)
        if (this.jumpQueued && this.onGround) {
            this.verticalVelocity = jumpSpeed;
            this.onGround = false;
            this.isOnGround = false; // For UI
            this.jumpQueued = false;
            console.log('[Player] JUMP! verticalVel=' + this.verticalVelocity);
        }

        // Combine horizontal + vertical displacement into one collision move for stability
        const speed = this.input.run ? runSpeed : walkSpeed;
        const displacement = hasMovement ? moveDir.scale(speed * dt) : BABYLON.Vector3.Zero();
        displacement.y = this.verticalVelocity * dt;

        const previousPosition = this.mesh.position.clone();
        this.mesh.moveWithCollisions(displacement);

        // Update facing from ACTUAL movement to avoid stale rotation when sliding/blocked
        const moved = this.mesh.position.subtract(previousPosition);
        const flatMovement = new BABYLON.Vector3(moved.x, 0, moved.z);
        if (flatMovement.lengthSquared() > 0.0001) {
            const targetRotation = Math.atan2(flatMovement.x, flatMovement.z) + Math.PI;
            this.lastFacing = targetRotation;
            if (this.visualRoot) {
                this.visualRoot.rotation.y = targetRotation;
            } else if (this.characterModel) {
                this.characterModel.rotation.y = targetRotation;
            }
        } else if (this.visualRoot) {
            this.visualRoot.rotation.y = this.lastFacing;
        }

        // Debug logging (first 10 frames in air)
        if (!this.onGround && (!this._gravityLogCount || this._gravityLogCount < 10)) {
            if (!this._gravityLogCount) this._gravityLogCount = 0;
            console.log(`[Player] IN AIR: verticalVel=${this.verticalVelocity.toFixed(3)}, y=${this.mesh.position.y.toFixed(2)}`);
            this._gravityLogCount++;
        }

        // GROUND CHECK - Direct terrain height query (NO RAYCASTING!)
        let groundY = 0;
        const prevY = previousPosition.y;

        if (this.scene.world && typeof this.scene.world.getTerrainHeight === 'function') {
            // Get exact terrain height at player's x,z position
            groundY = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);

            // If below or at ground level, snap to it
            if (this.mesh.position.y <= groundY + this.footPadding + 0.01) {
                this.mesh.position.y = groundY + this.footPadding;
                this.onGround = true;
                this.isOnGround = true; // For UI
                this.verticalVelocity = 0;
            } else if (this.mesh.position.y === prevY) {
                // moveWithCollisions stopped us, assume ground contact
                this.onGround = true;
                this.isOnGround = true;
                this.verticalVelocity = 0;
                this.mesh.position.y = groundY + this.footPadding;
            } else {
                this.onGround = false;
                this.isOnGround = false; // For UI
            }

            // If we're hovering just above the ground without upward velocity, lock down to the surface
            const desiredY = groundY + this.footPadding;
            if (this.mesh.position.y > desiredY + 0.05 && this.verticalVelocity <= 0.01) {
                this.mesh.position.y = desiredY;
            }
        } else {
            // Fallback: assume flat ground at y=0
            if (this.mesh.position.y <= this.footPadding) {
                this.mesh.position.y = this.footPadding;
                this.onGround = true;
                this.isOnGround = true; // For UI
                this.verticalVelocity = 0;
            } else if (this.mesh.position.y === prevY) {
                this.onGround = true;
                this.isOnGround = true;
                this.verticalVelocity = 0;
                this.mesh.position.y = this.footPadding;
            } else {
                this.onGround = false;
                this.isOnGround = false; // For UI
            }
        }

        if (this.onGround && this.verticalVelocity > 0) {
            this.verticalVelocity = 0; // prevent rebounds on landing
        }

        // Gamepad camera control (right stick) - INVERTED
        if (this.camera && this.gamepad.connected) {
            const lookSpeed = 0.08;

            if (Math.abs(this.gamepad.lookX) > 0.001) {
                this.camera.alpha -= this.gamepad.lookX * lookSpeed * dt;
            }

            if (Math.abs(this.gamepad.lookY) > 0.001) {
                this.camera.beta -= this.gamepad.lookY * lookSpeed * dt;

                const minBeta = 0.2;
                const maxBeta = Math.PI - 0.2;
                if (this.camera.beta < minBeta) this.camera.beta = minBeta;
                if (this.camera.beta > maxBeta) this.camera.beta = maxBeta;
            }
        }

        // ============================================================
        // SAFETY CHECKS - Collision floor right below terrain surface
        // ============================================================
        
        // Layer 1: Collision floor detection (y < -0.05)
        // Floor is at y=-0.1, so this catches ANY clipping through terrain
        if (this.mesh.position.y < -0.05) {
            console.warn('[Player] Clipping detected! Snapping to terrain...');

            // Get accurate terrain height at current position
            if (this.scene.world && typeof this.scene.world.getTerrainHeight === 'function') {
                const groundY = this.scene.world.getTerrainHeight(
                    this.mesh.position.x,
                    this.mesh.position.z
                );
                this.mesh.position.y = groundY + this.footPadding;
            } else {
                // Fallback to safe height
                this.mesh.position.y = this.footPadding + 0.2;
            }
        }

        // Update animations based on state
        if (this.isAttacking) {
            this.playAnimation("attack");
        } else if (this.isJumping) {
            this.playAnimation("jump");
        } else if (this.isMoving) {
            if (this.isRunning) {
                this.playAnimation("run");
            } else {
                this.playAnimation("walk");
            }
        } else {
            this.playAnimation("idle");
        }

        // Layer 2: Emergency reset (y < -1)
        // If somehow fell completely through everything
        if (this.mesh.position.y < -1) {
            console.warn('[Player] Emergency reset!');
            this.mesh.position.y = 20;

            if (this.mesh.physicsImpostor) {
                this.mesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
                this.mesh.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());

                if (this.mesh.physicsImpostor.physicsBody) {
                    const body = this.mesh.physicsImpostor.physicsBody;
                    body.position.set(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);
                    body.velocity.set(0, 0, 0);
                    body.angularVelocity.set(0, 0, 0);
                }
            }

            this.verticalVelocity = 0;
            this.onGround = false;
            this.isOnGround = false; // For UI
        }
        // ===== FINAL TERRAIN CLAMP - absolutely never under the grass =====
        const worldForClamp = this.scene.world || (this.scene.game && this.scene.game.world);
        if (worldForClamp && this.mesh) {
            let groundY = 0;

            // Prefer the exact ray-based height function if available
            if (typeof worldForClamp.getHeightAt === 'function') {
                groundY = worldForClamp.getHeightAt(this.mesh.position.x, this.mesh.position.z);
            } else if (typeof worldForClamp.getTerrainHeight === 'function') {
                groundY = worldForClamp.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
            }

            const clampY = groundY + this.groundOffset;

            // If we've ended up even slightly under the terrain surface, snap back up
            if (this.mesh.position.y < clampY) {
                this.mesh.position.y = clampY;

                // Kill any downward velocity so we don't immediately sink again
                if (this.verticalVelocity < 0) {
                    this.verticalVelocity = 0;
                }

                this.onGround = true;
                this.isOnGround = true;
            }
        }
        // ===== END FINAL TERRAIN CLAMP =====
    }
    
    // ============================================================
    // TARGETING SYSTEM
    // ============================================================
    
    targetNext() {
        // Get all targetable entities (enemies/NPCs) in the scene
        const targetable = this.getTargetableEntities();
        
        if (targetable.length === 0) {
            this.clearTarget();
            return;
        }
        
        if (!this.currentTarget) {
            this.setTarget(targetable[0]);
            return;
        }
        
        const index = targetable.indexOf(this.currentTarget);
        const nextIndex = (index + 1) % targetable.length;
        this.setTarget(targetable[nextIndex]);
    }
    
    targetPrevious() {
        const targetable = this.getTargetableEntities();
        
        if (targetable.length === 0) {
            this.clearTarget();
            return;
        }
        
        if (!this.currentTarget) {
            this.setTarget(targetable[targetable.length - 1]);
            return;
        }
        
        const index = targetable.indexOf(this.currentTarget);
        const prevIndex = (index - 1 + targetable.length) % targetable.length;
        this.setTarget(targetable[prevIndex]);
    }
    
    getTargetableEntities() {
        const targetable = [];
        
        if (this.scene.world) {
            if (this.scene.world.enemies) {
                targetable.push(...this.scene.world.enemies);
            }
            if (this.scene.world.npcs) {
                targetable.push(...this.scene.world.npcs);
            }
        }
        
        const playerPos = this.mesh.position;
        targetable.sort((a, b) => {
            const da = BABYLON.Vector3.DistanceSquared(playerPos, a.position || a.mesh.position);
            const db = BABYLON.Vector3.DistanceSquared(playerPos, b.position || b.mesh.position);
            return da - db;
        });
        
        return targetable;
    }
    
    setTarget(entity) {
        if (this.currentTarget === entity) return;
        
        this.currentTarget = entity;
        
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
        }
        
        if (!entity || !entity.mesh) return;
        
        this.targetHighlight = new BABYLON.HighlightLayer("targetHighlight", this.scene);
        this.targetHighlight.addMesh(entity.mesh, new BABYLON.Color3(1, 0, 0));
        
        console.log('[Player] Target set:', entity);
    }
    
    clearTarget() {
        this.currentTarget = null;
        
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
            this.targetHighlight = null;
        }
        
        console.log('[Player] Target cleared');
    }
    
    interact() {
        console.log('[Player] Interact pressed');
    }
    
    takeDamage(amount, source) {
        this.health = Math.max(0, this.health - amount);
        
        console.log(`[Player] Took ${amount} damage from`, source);
        
        if (this.health <= 0) {
            this.die();
        }
    }
    
    die() {
        console.log('[Player] Died');
        this.health = this.maxHealth;
        this.mesh.position = new BABYLON.Vector3(0, 10, 0);
    }
}

// Export Player class if using modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Player;
}
