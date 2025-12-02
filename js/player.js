// Player class - CLEAN REWRITE
class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.camera = null;
        this.characterModel = null;
        
        // Movement speeds (normalized to target FPS for physics velocity)
        this.speed = 0.4;              // Base walk speed (per-frame value @ target FPS)
        this.runMultiplier = 2.5;      // Run multiplier
        this.jumpForce = 0.5;          // Jump initial velocity (per-frame value @ target FPS)
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
        
        // Internal flags
        this._waitingLogged = false;
        
        console.log('[Player] Player created');
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

        // Enable physics if available so we collide with the terrain
        if (this.scene.getPhysicsEngine()) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh,
                BABYLON.PhysicsImpostor.BoxImpostor,
                {
                    mass: 80,
                    friction: 0.9,
                    restitution: 0
                },
                this.scene
            );

            // Stabilize body (no unwanted tipping over)
            this.mesh.physicsImpostor.setLinearDamping(0.15);
            this.mesh.physicsImpostor.setAngularDamping(0.9);
            if (this.mesh.physicsImpostor.physicsBody && this.mesh.physicsImpostor.physicsBody.fixedRotation !== undefined) {
                this.mesh.physicsImpostor.physicsBody.fixedRotation = true;
                this.mesh.physicsImpostor.physicsBody.updateMassProperties();
            }

            console.log('[Player] ✓ Physics body created for player');
        } else {
            console.warn('[Player] Physics engine not available - using kinematic fallback');
        }

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
            
            // Get root mesh and parent it to invisible physics box
            this.characterModel = result.meshes[0];
            this.characterModel.parent = this.mesh;
            
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
                    if (isDown && !this.input.jump) {
                        this.input.jump = true;
                        console.log('[Player] JUMP pressed! onGround=' + this.onGround);
                    } else if (!isDown) {
                        this.input.jump = false;
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
                this.input.jump = true;
                setTimeout(() => { this.input.jump = false; }, 100);
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
        
        // deltaTime comes in as SECONDS from game.js; convert to a frame-normalized value
        const targetFps =
            (window.CONFIG && window.CONFIG.GAME && window.CONFIG.GAME.FPS)
                ? window.CONFIG.GAME.FPS
                : 60;
        const dt = deltaTime * targetFps;
        const baseSpeed = this.speed * targetFps;
        const runSpeed = baseSpeed * this.runMultiplier;
        const jumpVelocity = this.jumpForce * targetFps;
        
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

            // Rotate to face movement direction
            const targetRotation = Math.atan2(moveDir.x, moveDir.z) + Math.PI;
            this.mesh.rotation.y = targetRotation;

            // Play walk/run animation
            if (this.input.run && this.animations.run) {
                this.playAnimation('run');
            } else if (this.animations.walk) {
                this.playAnimation('walk');
            }
        } else {
            // Play idle animation
            if (this.animations.idle) {
                this.playAnimation('idle');
            }
        }

        const usingPhysics = !!(this.mesh.physicsImpostor && this.scene.getPhysicsEngine());

        if (usingPhysics) {
            const impostor = this.mesh.physicsImpostor;
            const currentVel = impostor.getLinearVelocity() || BABYLON.Vector3.Zero();

            // Horizontal velocity target
            let desiredVelocity = BABYLON.Vector3.Zero();
            if (hasMovement) {
                const speed = this.input.run ? runSpeed : baseSpeed;
                desiredVelocity = moveDir.scale(speed);
            }

            const newVelocity = new BABYLON.Vector3(desiredVelocity.x, currentVel.y, desiredVelocity.z);
            impostor.setLinearVelocity(newVelocity);

            // Grounded check using terrain height
            let groundY = 0;
            if (this.scene.world && typeof this.scene.world.getTerrainHeight === 'function') {
                groundY = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
            }
            const feetY = this.mesh.position.y - this.groundOffset;
            const grounded = (feetY <= groundY + 0.1) && currentVel.y <= 0.5;
            this.onGround = grounded;
            this.isOnGround = grounded;

            // Jump
            if (this.input.jump && this.onGround) {
                const jumpVel = new BABYLON.Vector3(newVelocity.x, jumpVelocity, newVelocity.z);
                impostor.setLinearVelocity(jumpVel);
                this.onGround = false;
                this.isOnGround = false;
                this.input.jump = false;
                console.log('[Player] JUMP (physics) vY=' + jumpVelocity.toFixed(2));
            }
        } else {
            // Kinematic fallback (legacy behavior)
            if (hasMovement) {
                const speed = this.input.run ? this.speed * this.runMultiplier : this.speed;
                const velocity = moveDir.scale(speed * dt);
                this.mesh.position.addInPlace(velocity);
            }

            // GRAVITY - Apply downward force
            if (!this.onGround) {
                this.verticalVelocity -= 0.8 * dt; // Gravity acceleration

                // Debug logging (first 10 frames in air)
                if (!this._gravityLogCount) this._gravityLogCount = 0;
                if (this._gravityLogCount < 10) {
                    console.log(`[Player] IN AIR: verticalVel=${this.verticalVelocity.toFixed(3)}, y=${this.mesh.position.y.toFixed(2)}`);
                    this._gravityLogCount++;
                }
            } else {
                this.verticalVelocity = 0;
                this._gravityLogCount = 0; // Reset counter when on ground
            }

            // Apply vertical velocity
            this.mesh.position.y += this.verticalVelocity * dt;

            // JUMP
            if (this.input.jump && this.onGround) {
                this.verticalVelocity = this.jumpForce;
                this.onGround = false;
                this.isOnGround = false; // For UI
                this.input.jump = false;
                console.log('[Player] JUMP! verticalVel=' + this.verticalVelocity);
            }

            // GROUND CHECK - Direct terrain height query (NO RAYCASTING!)
            // This is how real games do it - query the heightmap directly
            let groundY = 0;

            if (this.scene.world && typeof this.scene.world.getTerrainHeight === 'function') {
                // Get exact terrain height at player's x,z position
                groundY = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);

                // Debug log first few frames
                if (!this._groundCheckCount) this._groundCheckCount = 0;
                this._groundCheckCount++;
                if (this._groundCheckCount <= 5) {
                    console.log(`[Player] Ground check #${this._groundCheckCount}: pos.y=${this.mesh.position.y.toFixed(2)}, groundY=${groundY.toFixed(2)}, diff=${(this.mesh.position.y - groundY).toFixed(2)}`);
                }

                // If below or at ground level, snap to it
                if (this.mesh.position.y <= groundY + this.groundOffset) {
                    this.mesh.position.y = groundY + this.groundOffset;
                    this.onGround = true;
                    this.isOnGround = true; // For UI
                    this.verticalVelocity = 0;
                } else {
                    this.onGround = false;
                    this.isOnGround = false; // For UI
                }
            } else {
                // Fallback: assume flat ground at y=0
                if (this._groundCheckCount === undefined) {
                    console.warn('[Player] World.getTerrainHeight not available, using y=0 fallback');
                    this._groundCheckCount = 0;
                }

                if (this.mesh.position.y <= this.groundOffset) {
                    this.mesh.position.y = this.groundOffset;
                    this.onGround = true;
                    this.isOnGround = true; // For UI
                    this.verticalVelocity = 0;
                } else {
                    this.onGround = false;
                    this.isOnGround = false; // For UI
                }
            }
        }
        
        // Gamepad camera control (right stick) - INVERTED
        if (this.camera && this.gamepad.connected) {
            const lookSpeed = 0.03;
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
        } // FIXED: Added missing closing brace
        
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
