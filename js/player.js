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
        // PATCH: The file was truncated here, causing a SyntaxError. Cleanly close the function.
    } // PATCH END

    async loadCharacterModel() {
        if (typeof window.ASSET_MANIFEST === 'undefined' || !window.ASSET_MANIFEST.CHARACTERS.PLAYER) {
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
            
            // Apply scale and offset from config
            const scale = characterConfig.scale || 1.0;
            const offset = characterConfig.offset || { x: 0, y: 0, z: 0 };
            
            this.characterModel.scaling.setAll(scale);
            this.characterModel.position.set(offset.x, offset.y, offset.z);
            
            // Enable shadows for the character model
            this.characterModel.receiveShadows = true;
            if (this.scene.shadowGenerator) {
                this.scene.shadowGenerator.addShadowCaster(this.characterModel);
            }
            
            // Setup animations if available
            this.setupAnimations(result.animationGroups, characterConfig.animations);

        } catch (error) {
            console.error('[Player] Failed to load character model:', error);
            // Fallback: If model fails, at least the collider exists
        }
    }
    
    setupAnimations(animationGroups, config) {
        if (!animationGroups || animationGroups.length === 0) {
            console.warn('[Player] No animation groups found');
            return;
        }

        const map = {};
        animationGroups.forEach(group => {
            map[group.name] = group;
        });

        // Map config names to loaded animation groups
        this.animations.idle = map[config.idle];
        this.animations.walk = map[config.walk];
        this.animations.run = map[config.run];
        this.animations.jump = map[config.jump];
        this.animations.attack = map[config.attack];
        
        if (this.animations.idle) {
            this.playAnimation('idle');
        }
    }
    
    playAnimation(name) {
        const anim = this.animations[name];
        if (anim && anim !== this.currentAnimation) {
            if (this.currentAnimation) {
                this.currentAnimation.stop();
            }
            // All movement animations should loop
            anim.start(true);
            this.currentAnimation = anim;
        }
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
            canvas.addEventListener('contextmenu', (e) => e.preventDefault());
            canvas.addEventListener('touchmove', (e) => {
                // Only prevent default if it's the main 3D canvas
                e.preventDefault();
            }, { passive: false });
        }

        // Keyboard input
        const map = {};
        this.scene.actionManager = new BABYLON.ActionManager(this.scene);
        
        this.scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, (evt) => {
            map[evt.sourceEvent.key.toLowerCase()] = evt.sourceEvent.type === "keydown";
        }));
        
        this.scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, (evt) => {
            map[evt.sourceEvent.key.toLowerCase()] = evt.sourceEvent.type === "keydown";
        }));
        
        this.scene.onBeforeRenderObservable.add(() => {
            // Update movement state
            this.input.forward = map['w'] || map['arrowup'];
            this.input.backward = map['s'] || map['arrowdown'];
            this.input.left = map['a'] || map['arrowleft'];
            this.input.right = map['d'] || map['arrowright'];
            this.input.run = map['shift'];

            // Update jump state (queue jump on press, release on up)
            if (map[' ']) {
                if (!this.jumpHeld) {
                    this.queueJump();
                }
                this.jumpHeld = true;
            } else {
                this.releaseJump();
            }
            
            // Targeting key (T)
            if (map['t'] && !this.input._tWasPressed) {
                this.targetNext();
                this.input._tWasPressed = true;
            } else if (!map['t']) {
                this.input._tWasPressed = false;
            }
            
            // Attack key (E)
            if (map['e']) {
                // TODO: Attack logic
            }

            // Execute physics/movement update
            this.update(this.scene.getEngine().getDeltaTime() / 1000);
        });
        
        // Mouse click for targeting
        this.scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                const pickInfo = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
                this.handlePointerDown(pickInfo);
            }
        });
        
        // Simple touch joystick/controls implementation for mobile
        let joystickTouchId = null;
        let joystickStartX = 0;
        let joystickStartY = 0;
        
        const DEADZONE = 20;
        const RUNZONE = 80;

        const updateFromTouch = (x, y) => {
            const dx = x - joystickStartX;
            const dy = y - joystickStartY;

            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            // Reset input
            this.input.forward = this.input.backward = this.input.left = this.input.right = false;

            // Determine direction based on largest axis change
            if (absDy > DEADZONE) {
                if (dy < 0) this.input.forward = true;
                else this.input.backward = true;
            }

            if (absDx > DEADZONE) {
                if (dx < 0) this.input.left = true;
                else this.input.right = true;
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
                
                // Left half of screen controls movement
                if (x < window.innerWidth * 0.5) {
                    if (joystickTouchId === null) {
                        joystickTouchId = t.identifier;
                        joystickStartX = x;
                        joystickStartY = y;
                        updateFromTouch(x, y);
                    }
                } else {
                    // Right half controls camera (ArcRotateCamera)
                    // The camera already handles this via attachControl
                }
                
                // Simple jump button simulation (e.g., small area in bottom right)
                if (x > window.innerWidth * 0.8 && y > window.innerHeight * 0.8) {
                    this.queueJump();
                }
            }
        };

        const onTouchMove = (evt) => {
            if (joystickTouchId === null) return;
            
            for (let i = 0; i < evt.changedTouches.length; i++) {
                const t = evt.changedTouches[i];
                if (t.identifier === joystickTouchId) {
                    updateFromTouch(t.clientX, t.clientY);
                    return;
                }
            }
        };

        const onTouchEnd = (evt) => {
            for (let i = 0; i < evt.changedTouches.length; i++) {
                const t = evt.changedTouches[i];
                if (t.identifier === joystickTouchId) {
                    // Reset input and joystick
                    this.input.forward = this.input.backward = this.input.left = this.input.right = false;
                    this.input.run = false;
                    this.releaseJump(); // Also release jump on touch end
                    joystickTouchId = null;
                    return;
                }
            }
        };

        canvas.addEventListener('touchstart', onTouchStart, false);
        canvas.addEventListener('touchmove', onTouchMove, false);
        canvas.addEventListener('touchend', onTouchEnd, false);
    }
    
    setupGamepad() {
        if (!navigator.getGamepads) return;

        this.scene.onBeforeRenderObservable.add(() => {
            const gamepads = navigator.getGamepads();
            const gamepad = gamepads[0]; // Assuming player uses first connected gamepad

            if (!gamepad) {
                this.gamepad.connected = false;
                return;
            }

            this.gamepad.connected = true;

            // ==================
            // LEFT STICK (Movement)
            // ==================
            const LEFT_STICK_DEADZONE = 0.2;
            this.gamepad.moveX = gamepad.axes[0];
            this.gamepad.moveY = gamepad.axes[1];

            // Reset keyboard/touch-based input, as gamepad takes precedence
            this.input.forward = this.input.backward = this.input.left = this.input.right = false;

            if (Math.abs(this.gamepad.moveY) > LEFT_STICK_DEADZONE) {
                if (this.gamepad.moveY < 0) this.input.forward = true;
                else this.input.backward = true;
            }
            if (Math.abs(this.gamepad.moveX) > LEFT_STICK_DEADZONE) {
                if (this.gamepad.moveX < 0) this.input.left = true;
                else this.input.right = true;
            }

            // ==================
            // RIGHT STICK (Camera Look)
            // ==================
            const RIGHT_STICK_DEADZONE = 0.1;
            this.gamepad.lookX = Math.abs(gamepad.axes[2]) > RIGHT_STICK_DEADZONE ? gamepad.axes[2] : 0;
            this.gamepad.lookY = Math.abs(gamepad.axes[3]) > RIGHT_STICK_DEADZONE ? gamepad.axes[3] : 0;

            // ==================
            // BUTTONS
            // ==================
            
            // R-Trigger/Bumper (R1/RB) - Run
            const runPressed = (gamepad.buttons[1] && gamepad.buttons[1].pressed) || // B button (XBox)
                               (gamepad.buttons[6] && gamepad.buttons[6].pressed) || // L-Trigger
                               (gamepad.buttons[7] && gamepad.buttons[7].pressed); // R-Trigger
            this.input.run = runPressed;

            // A button (0) - Jump
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
            
            // Y button (3) - Attack/Action
            if (gamepad.buttons[3] && gamepad.buttons[3].pressed) {
                // TODO: Attack logic
            }
        });
    }

    update(dt) {
        this.updateMovement(dt);
        this.updateCamera(dt);
        // TODO: Update combat, UI, etc.
    }

    updateMovement(dt) {
        // Apply rotation from input/gamepad
        let targetRotation = this.lastFacing;
        let hasMovement = false;
        
        // Calculate raw movement vector based on camera direction
        const cameraForward = this.camera.getForwardRay(1).direction;
        cameraForward.y = 0;
        cameraForward.normalize();

        const cameraRight = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), cameraForward);
        
        let moveDir = BABYLON.Vector3.Zero();

        if (this.input.forward) {
            moveDir.addInPlace(cameraForward);
            hasMovement = true;
        }
        if (this.input.backward) {
            moveDir.subtractInPlace(cameraForward);
            hasMovement = true;
        }
        if (this.input.right) {
            moveDir.addInPlace(cameraRight);
            hasMovement = true;
        }
        if (this.input.left) {
            moveDir.subtractInPlace(cameraRight);
            hasMovement = true;
        }
        
        if (hasMovement) {
            moveDir.normalize();
            targetRotation = Math.atan2(moveDir.x, moveDir.z) + Math.PI;
        }
        
        // Apply smooth rotation
        if (this.visualRoot) {
            // Apply rotation only when there's movement, otherwise preserve last rotation
            if (hasMovement) {
                // Smooth rotation using lerp
                let currentRotation = this.visualRoot.rotation.y;
                let deltaAngle = targetRotation - currentRotation;
                
                // Handle wrap-around
                if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
                if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
                
                this.visualRoot.rotation.y += deltaAngle * this.rotationSpeed;
                this.lastFacing = this.visualRoot.rotation.y;
            } else {
                // No movement, enforce last facing
                this.visualRoot.rotation.y = this.lastFacing;
            }
        }
        
        // ============================================================
        // JUMP AND GRAVITY LOGIC (Kinematic/Collision-based Movement)
        // ============================================================
        
        // 1. Ground detection (Raycast downwards)
        const groundRay = new BABYLON.Ray(
            this.mesh.position.add(new BABYLON.Vector3(0, -this.groundOffset + 0.01, 0)),
            BABYLON.Vector3.Down(),
            0.1
        );
        const hit = this.scene.pickWithRay(groundRay, (mesh) => {
            return mesh.checkCollisions && mesh.name === 'terrainCollisionBarrier';
        });

        const wasOnGround = this.onGround;
        this.onGround = hit.hit;
        this.isOnGround = this.onGround; // For UI
        
        // If just landed, reset vertical velocity and force snap to ground
        if (!wasOnGround && this.onGround) {
            this.verticalVelocity = 0;
            this.mesh.position.y = hit.pickedPoint.y + this.groundOffset;
            this.jumpHeld = false; // Reset jump hold
            this.playAnimation('idle'); // Change animation to idle/walk
        }
        
        // 2. Jumping
        if (this.jumpQueued && this.onGround) {
            this.verticalVelocity = this.jumpForce;
            this.onGround = false;
            this.jumpQueued = false; // Consume the queued jump
            this.playAnimation('jump'); // Change animation to jump
        }
        this.jumpQueued = false; // Clear queue if jump didn't happen
        
        // 3. Gravity
        if (!this.onGround) {
            this.verticalVelocity += this.gravity * dt;
            
            // Clamp terminal velocity (to prevent falling through small gaps)
            if (this.verticalVelocity < -50) {
                this.verticalVelocity = -50;
            }
        }

        // 4. Calculate displacement
        let speed = this.speed;
        if (this.input.run) {
            speed *= this.runMultiplier;
            this.playAnimation(hasMovement ? 'run' : 'idle');
        } else {
            this.playAnimation(hasMovement ? 'walk' : 'idle');
        }
        
        const horizontalVelocity = hasMovement ? moveDir.scale(speed) : BABYLON.Vector3.Zero();
        
        let displacement = horizontalVelocity.scale(dt);
        displacement.y = this.verticalVelocity * dt;

        const previousPosition = this.mesh.position.clone();

        // 5. Move with collisions (Babylon's built-in system)
        this.mesh.moveWithCollisions(displacement);
        
        // Update facing from ACTUAL movement to avoid stale rotation when sliding/blocked
        const moved = this.mesh.position.subtract(previousPosition);
        const flatMovement = new BABYLON.Vector3(moved.x, 0, moved.z);

        if (flatMovement.lengthSquared() > 0.0001) {
            // Only update lastFacing when there is actual horizontal movement
            const actualRotation = Math.atan2(flatMovement.x, flatMovement.z) + Math.PI;
            this.lastFacing = actualRotation;
            if (this.visualRoot) {
                this.visualRoot.rotation.y = actualRotation;
            } else if (this.characterModel) {
                this.characterModel.rotation.y = actualRotation;
            }
        } else if (this.visualRoot) {
            // If no movement, enforce the last calculated facing for the visual root
            this.visualRoot.rotation.y = this.lastFacing;
        }
        
        // Re-check collision after movement for potential downward collision fixes (steps, etc.)
        if (this.mesh.position.y < previousPosition.y && !this.onGround) {
             // If we moved down but were in the air, do an immediate ground check snap
             const postMoveGroundRay = new BABYLON.Ray(
                this.mesh.position.add(new BABYLON.Vector3(0, -this.groundOffset + 0.01, 0)),
                BABYLON.Vector3.Down(),
                0.1
            );
            const postMoveHit = this.scene.pickWithRay(postMoveGroundRay, (mesh) => {
                return mesh.checkCollisions && mesh.name === 'terrainCollisionBarrier';
            });
            
            if (postMoveHit.hit) {
                this.mesh.position.y = postMoveHit.pickedPoint.y + this.groundOffset;
                this.verticalVelocity = 0;
                this.onGround = true;
                this.isOnGround = true;
            }
        }
    }
    
    updateCamera(dt) {
        const lookSpeed = 2.0; // Camera rotation speed multiplier
        
        if (this.gamepad.lookX !== 0) {
            // Horizontal orbit (left/right)
            this.camera.alpha -= this.gamepad.lookX * lookSpeed * dt;
        }
        
        if (this.gamepad.lookY !== 0) {
            // Vertical orbit (up/down) - INVERTED
            this.camera.beta -= this.gamepad.lookY * lookSpeed * dt;

            // Clamp vertical rotation (0.2 to Math.PI - 0.2)
            const minBeta = 0.2;
            const maxBeta = Math.PI - 0.2;
            if (this.camera.beta < minBeta) this.camera.beta = minBeta;
            if (this.camera.beta > maxBeta) this.camera.beta = maxBeta;
        }
    }

    // ============================================================
    // COMBAT AND TARGETING
    // ============================================================
    
    targetNext() {
        if (!this.scene.game || !this.scene.game.world) return;
        
        const enemies = this.scene.game.world.enemies.filter(e => e.mesh);
        if (enemies.length === 0) {
            this.clearTarget();
            return;
        }
        
        const playerPos = this.mesh.position;
        
        if (!this.currentTarget) {
            // Target the closest enemy
            let closest = null;
            let minDistSq = Infinity;
            
            enemies.forEach(enemy => {
                const distSq = BABYLON.Vector3.DistanceSquared(playerPos, enemy.mesh.position);
                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    closest = enemy;
                }
            });
            
            this.setTarget(closest);
        } else {
            // Cycle to the next closest enemy
            const currentIndex = enemies.findIndex(e => e.mesh === this.currentTarget);
            let nextIndex = (currentIndex + 1) % enemies.length;
            this.setTarget(enemies[nextIndex].mesh);
        }
    }
    
    setTarget(targetMesh) {
        if (this.currentTarget === targetMesh) return;

        // Clear existing highlight
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
            this.targetHighlight = null;
        }
        
        this.currentTarget = targetMesh;
        
        if (this.currentTarget) {
            console.log(`[Player] Targeting: ${this.currentTarget.name || 'Enemy'}`);
            this.createTargetHighlight();
        } else {
            console.log('[Player] Target cleared');
        }
    }
    
    clearTarget() {
        this.setTarget(null);
    }
    
    createTargetHighlight() {
        if (!this.currentTarget || this.targetHighlight) return;
        
        // Create ring around target
        this.targetHighlight = BABYLON.MeshBuilder.CreateTorus('targetHighlight', {
            diameter: 3,
            thickness: 0.1,
            tessellation: 32
        }, this.scene);
        
        this.targetHighlight.rotation.x = Math.PI / 2; // Flat on the ground
        this.targetHighlight.position.y = this.currentTarget.position.y + 0.02;
        
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
        // ... dispose other members
        console.log('[Player] Disposed');
    }
}
