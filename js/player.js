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
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, this.colliderHeight / 2, 0);

        this.physicsReady = true; // Allow update to run immediately

        console.log(`[Player] ✓ Player collider created at (${this.mesh.position.x}, ${this.mesh.position.y.toFixed(2)}, ${this.mesh.position.z})`);
    }
    
    async loadCharacterModel() {
        if (!window.ASSET_MANIFEST || !window.ASSET_MANIFEST.CHARACTERS) {
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
            
            // CRITICAL: Position character model to align with physics box
            // Knight model needs to be centered and at the right height
            const offset = characterConfig.offset || { x: 0, y: -0.9, z: 0 };
            this.characterModel.position = new BABYLON.Vector3(offset.x, offset.y, offset.z);
            
            // NOTE: Don't rotate character model here - we rotate the parent mesh instead
            // If your model faces backward by default, add Math.PI to mesh rotation in update()
            
            // Apply scale from config
            const scale = characterConfig.scale || 1.0;
            this.characterModel.scaling = new BABYLON.Vector3(scale, scale, scale);
            
            // Make sure ALL child meshes are visible and don't have physics
            result.meshes.forEach((mesh, index) => {
                if (index > 0) { // Skip root
                    mesh.isVisible = true;
                    mesh.visibility = 1;
                    mesh.checkCollisions = false; // No collision on visual mesh
                    mesh.isPickable = false;      // Don't interfere with raycasts
                    
                    // Remove any physics impostors from model parts
                    if (mesh.physicsImpostor) {
                        mesh.physicsImpostor.dispose();
                        mesh.physicsImpostor = null;
                    }
                }
            });
            
            // Store animations
            if (result.animationGroups && result.animationGroups.length > 0) {
                console.log(`[Player] Found ${result.animationGroups.length} animations`);
                
                const animConfig = characterConfig.animations || {};
                
                // Map animations
                result.animationGroups.forEach(anim => {
                    const name = anim.name.toLowerCase();
                    if (name.includes('idle') || name.includes(animConfig.idle?.toLowerCase())) {
                        this.animations.idle = anim;
                    } else if (name.includes('walk') || name.includes(animConfig.walk?.toLowerCase())) {
                        this.animations.walk = anim;
                    } else if (name.includes('run') || name.includes(animConfig.run?.toLowerCase())) {
                        this.animations.run = anim;
                    } else if (name.includes('jump') || name.includes(animConfig.jump?.toLowerCase())) {
                        this.animations.jump = anim;
                    }
                });
                
                // Start idle animation
                if (this.animations.idle) {
                    this.animations.idle.start(true);
                    this.currentAnimation = this.animations.idle;
                    console.log('[Player] ✓ Playing idle animation');
                }
            }
            
        } catch (error) {
            console.warn('[Player] Failed to load character model:', error.message);
            console.log('[Player] Continuing with invisible collision box');
        }
    }
    
    playAnimation(animName) {
        const anim = this.animations[animName];
        if (anim && anim !== this.currentAnimation) {
            if (this.currentAnimation) {
                this.currentAnimation.stop();
            }
            anim.start(true);
            this.currentAnimation = anim;
        }
    }
    
    setupCamera() {
        // Create arc rotate camera
        this.camera = new BABYLON.ArcRotateCamera(
            'playerCamera',
            -Math.PI / 2, // Start facing forward
            Math.PI / 3,  // 60 degrees down
            10,           // 10 units away
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
        
        // Mouse/pointer targeting
        this.scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                this.handlePointerDown(pointerInfo.pickInfo);
            }
        });
        
            console.log('[Player] ✓ Input setup complete');

    // Mobile touch controls (iPhone/iPad/Android)
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        this.setupTouchControls(canvas);
    }
}

    
    
setupTouchControls(canvas) {
    console.log('[Player] ✓ Touch controls enabled (mobile)');

    let joystickTouchId = null;
    let joystickStartX = 0;
    let joystickStartY = 0;

    const DEADZONE = 20;
    const RUNZONE  = 80;

    const resetDirections = () => {
        this.input.forward  = false;
        this.input.backward = false;
        this.input.left     = false;
        this.input.right    = false;
        this.input.run      = false;
    };

    const updateFromTouch = (x, y) => {
        const dx = x - joystickStartX;
        const dy = y - joystickStartY;

        resetDirections();

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (absDy > DEADZONE) {
            if (dy < 0) this.input.forward = true;
            else        this.input.backward = true;
        }

        if (absDx > DEADZONE) {
            if (dx < 0) this.input.left = true;
            else        this.input.right = true;
        }

        const dist = Math.sqrt(dx * dx + dy * dy);
        this.input.run = dist > RUNZONE;
    };

    const onTouchStart = (evt) => {
        if (!evt.changedTouches || evt.changedTouches.length === 0) return;

        for (let i = 0; i < evt.changedTouches.length; i++) {
            const t = evt.changedTouches[i];
            const x = t.clientX;
            const y = t.clientY;

            if (x < window.innerWidth * 0.5) {
                if (joystickTouchId === null) {
                    joystickTouchId = t.identifier;
                    joystickStartX = x;
                    joystickStartY = y;
                    updateFromTouch(x, y);
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
            }
        }

        evt.preventDefault();
    };

    const onTouchEnd = (evt) => {
        if (!evt.changedTouches) return;

        for (let i = 0; i < evt.changedTouches.length; i++) {
            const t = evt.changedTouches[i];
            if (t.identifier === joystickTouchId) {
                joystickTouchId = null;
                resetDirections();
                break;
            }
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
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gamepad = gamepads[0];
        
        if (!gamepad) {
            this.gamepad.connected = false;
            return;
        }
        
        this.gamepad.connected = true;
        
        // Left stick - movement
        const deadzone = 0.15;
        this.gamepad.moveX = Math.abs(gamepad.axes[0]) > deadzone ? gamepad.axes[0] : 0;
        this.gamepad.moveY = Math.abs(gamepad.axes[1]) > deadzone ? gamepad.axes[1] : 0;
        
        // Right stick - camera (optional, camera is mouse-controlled)
        this.gamepad.lookX = Math.abs(gamepad.axes[2]) > deadzone ? gamepad.axes[2] : 0;
        this.gamepad.lookY = Math.abs(gamepad.axes[3]) > deadzone ? gamepad.axes[3] : 0;
        
        // Buttons
        // A button (0) - Jump
        if (gamepad.buttons[0] && gamepad.buttons[0].pressed) {
            this.input.jump = true;
        }
        
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
    }
    
    update(deltaTime) {
        // Debug logging (first 5 updates)
        if (!this._updateLogCount) this._updateLogCount = 0;
        if (this._updateLogCount < 5) {
            console.log(`[Player] Update #${this._updateLogCount + 1}: mesh=${!!this.mesh}, physicsReady=${this.physicsReady}, deltaTime=${deltaTime.toFixed(3)}`);
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

        const hasMovement = moveDir.lengthSquared() > 0;
        if (hasMovement) {
            moveDir.normalize();
        }

        // Animation selection
        if (hasMovement) {
            if (this.input.run && this.animations.run) {
                this.playAnimation('run');
            } else if (this.animations.walk) {
                this.playAnimation('walk');
            }
        } else if (this.animations.idle) {
            this.playAnimation('idle');
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
            if (this.mesh.position.y <= groundY + this.groundOffset + 0.01) {
                this.mesh.position.y = groundY + this.groundOffset;
                this.onGround = true;
                this.isOnGround = true; // For UI
                this.verticalVelocity = 0;
            } else if (this.mesh.position.y === prevY) {
                // moveWithCollisions stopped us, assume ground contact
                this.onGround = true;
                this.isOnGround = true;
                this.verticalVelocity = 0;
                this.mesh.position.y = groundY + this.groundOffset;
            } else {
                this.onGround = false;
                this.isOnGround = false; // For UI
            }

            // If we're hovering just above the ground without upward velocity, lock down to the surface
            const desiredY = groundY + this.groundOffset;
            if (this.mesh.position.y > desiredY + 0.05 && this.verticalVelocity <= 0.01) {
                this.mesh.position.y = desiredY;
            }
        } else {
            // Fallback: assume flat ground at y=0
            if (this.mesh.position.y <= this.groundOffset) {
                this.mesh.position.y = this.groundOffset;
                this.onGround = true;
                this.isOnGround = true; // For UI
                this.verticalVelocity = 0;
            } else if (this.mesh.position.y === prevY) {
                this.onGround = true;
                this.isOnGround = true;
                this.verticalVelocity = 0;
                this.mesh.position.y = this.groundOffset;
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
            const lookSpeed = 0.75;

            if (Math.abs(this.gamepad.lookX) > 0.001) {
                // Horizontal orbit (left/right) - INVERTED
                this.camera.alpha -= this.gamepad.lookX * lookSpeed * dt;
            }

            if (Math.abs(this.gamepad.lookY) > 0.001) {
                // Vertical orbit (up/down) - INVERTED
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
                this.mesh.position.y = groundY + this.groundOffset;
            } else {
                // Fallback to safe height
                this.mesh.position.y = this.groundOffset + 0.2;
            }

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
            this.onGround = true;
            this.isOnGround = true; // For UI
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
    }
    
    // ============================================================
    // TARGETING SYSTEM
    // ============================================================
    
    targetNext() {
        // Get all targetable entities (enemies/NPCs) in the scene
        const targetables = this.scene.meshes.filter(m => 
            m.metadata && (m.metadata.isEnemy || m.metadata.isNPC) && 
            m.metadata.health > 0
        );
        
        if (targetables.length === 0) {
            console.log('[Player] No targets available');
            this.clearTarget();
            return;
        }
        
        // Find current target index
        let currentIndex = -1;
        if (this.currentTarget) {
            currentIndex = targetables.findIndex(m => m === this.currentTarget);
        }
        
        // Get next target (cycle through)
        const nextIndex = (currentIndex + 1) % targetables.length;
        this.setTarget(targetables[nextIndex]);
    }
    
    setTarget(mesh) {
        if (!mesh) {
            this.clearTarget();
            return;
        }
        
        this.currentTarget = mesh;
        console.log('[Player] Targeted:', mesh.name);
        
        // Create/update target highlight
        this.updateTargetHighlight();
        
        // Show in UI if available
        if (this.scene.ui && typeof this.scene.ui.showTargetInfo === 'function') {
            const metadata = mesh.metadata || {};
            this.scene.ui.showTargetInfo(
                mesh.name,
                metadata.health || 0,
                metadata.maxHealth || 100
            );
        }
    }
    
    clearTarget() {
        this.currentTarget = null;
        
        // Remove highlight
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
            this.targetHighlight = null;
        }
        
        // Hide UI
        if (this.scene.ui && typeof this.scene.ui.hideTargetInfo === 'function') {
            this.scene.ui.hideTargetInfo();
        }
        
        console.log('[Player] Target cleared');
    }
    
    updateTargetHighlight() {
        // Remove old highlight
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
        }
        
        if (!this.currentTarget) return;
        
        // Create ring around target
        this.targetHighlight = BABYLON.MeshBuilder.CreateTorus('targetHighlight', {
            diameter: 3,
            thickness: 0.1,
            tessellation: 32
        }, this.scene);
        
        this.targetHighlight.position = this.currentTarget.position.clone();
        this.targetHighlight.position.y = 0.1; // Just above ground
        this.targetHighlight.rotation.x = Math.PI / 2;
        
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
    }
}

// Export for use in game.js
window.Player = Player;
console.log('[Player] Player class loaded');
