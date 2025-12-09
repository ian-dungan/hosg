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
        this.activeGamepad = null; // Holds the active gamepad instance
        
        // Animation state
        this.animations = {
            idle: null,
            walk: null,
            run: null,
            jump: null,
            attack: null
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
        this.worldReady = false;
        
        // Internal flags
        this._waitingLogged = false;
        
        console.log('[Player] Player created');
    }

    queueJump() {
        if (this.jumpHeld) return;
        this.jumpQueued = true;
        this.jumpHeld = true; // Set held immediately to prevent queueing multiple jumps
    }

    releaseJump() {
        this.jumpHeld = false;
    }

    // Called by the world after all assets and physics are set up
    startAfterWorldReady() {
        this.worldReady = true;
        console.log('[Player] ✓ World ready signal received');
        
        // Snap to ground immediately after world is ready and physics is stable
        const world = this.scene.game?.world;
        if (world && typeof world.getTerrainHeight === 'function' && this.mesh) {
            const groundY = world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
            this.mesh.position.y = groundY + this.groundOffset;
            this.onGround = true;
            this.isOnGround = true; 
            this.verticalVelocity = 0;
            console.log(`[Player] ✓ Snapped to ground at y=${this.mesh.position.y.toFixed(2)}, onGround=${this.onGround}`);
        }
    }
    
    // Wait for terrain physics to be ready, then create player
    async init() {
        console.log('[Player] Waiting for terrain to be ready...');
        
        // Wait for terrain with timeout
        const terrain = await this.waitForTerrain(100); // 100 attempts, ~5s timeout
        if (!terrain) {
            console.error('[Player] TERRAIN TIMEOUT - Creating player anyway at y=10');
            this.createPlayerMesh(10);
        } else {
            console.log('[Player] Found terrain after 1 attempts');
            console.log('[Player] ✓ Terrain ready, creating player...');
            
            // Get spawn height from terrain - spawn ON the ground!
            const world = this.scene.game?.world;
            let spawnY = CONFIG.PLAYER.SPAWN_HEIGHT + this.groundOffset; // Fallback if world not ready (center position)
            
            if (world && typeof world.getTerrainHeight === 'function') {
                const groundY = world.getTerrainHeight(0, 0);
                spawnY = groundY + this.groundOffset + 0.2; // Centered on collider with slight lift
                console.log(`[Player] Ground at y=${groundY.toFixed(2)}, spawning at y=${spawnY.toFixed(2)}`);
            } else {
                console.warn('[Player] Could not get terrain height, using fallback center spawn');
            }
            
            // Create player mesh (spawns directly at spawnY, no extra offset)
            this.createPlayerMesh(spawnY);
        }
        
        // Load character model
        await this.loadCharacterModel();
        
        // Setup camera
        this.setupCamera();
        
        // Setup input (keyboard + gamepad)
        this.setupInput();
        this.setupGamepad();
        
        console.log('[Player] ✓ Player initialized and ready');
    }

    // Waits up to 100 attempts for the world's terrain to be ready
    async waitForTerrain(maxAttempts) {
        let attempts = 0;
        const checkTerrain = () => this.scene.game?.world?.terrain;

        while (attempts < maxAttempts) {
            const terrain = checkTerrain();
            if (terrain) return terrain;

            attempts++;
            if (attempts % 10 === 0 && attempts > 1) {
                console.log(`[Player] Waiting for terrain... (${attempts} attempts)`);
            }
            await new Promise(resolve => setTimeout(resolve, 50)); // Wait 50ms
        }
        return null;
    }

    createPlayerMesh(spawnY) {
        // 1. Create the invisible physics collider (Capsule or Sphere/Box)
        this.mesh = BABYLON.MeshBuilder.CreateCapsule("playerCollider", {
            height: this.colliderHeight,
            radius: this.colliderRadius,
            subdivisions: 4,
            tessellation: 32,
            capSubdivisions: 4,
            updatable: false
        }, this.scene);
        this.mesh.position.set(0, spawnY, 0);
        this.mesh.isVisible = false;
        this.mesh.checkCollisions = true;
        this.mesh.isPickable = false;
        this.mesh.ellipsoid = new BABYLON.Vector3(this.colliderRadius, this.colliderHeight / 2, this.colliderRadius);
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0, 0);
        
        // Apply Physics Impostor (Cannon.js)
        if (this.scene.getPhysicsEngine()) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.SphereImpostor, // Sphere is often the most reliable simple impostor for player movement in Cannon.js
                {
                    mass: CONFIG.PLAYER.MASS,
                    restitution: 0.01,
                    friction: CONFIG.PLAYER.FRICTION
                },
                this.scene
            );
            // Apply damping for smooth stop
            this.mesh.physicsImpostor.setDamping(CONFIG.PLAYER.LINEAR_DAMPING, CONFIG.PLAYER.ANGULAR_DAMPING);
            this.mesh.physicsImpostor.sleep(); // Start asleep until movement begins
            this.physicsReady = true;
        }

        console.log('[Player] ✓ Physics collider mesh created');

        // 2. Create the visual root (a simple TransformNode)
        // This holds the visible model and rotates independently of the collider's movement
        this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
        this.visualRoot.parent = this.mesh; // Link visual root to the collider

        // Set metadata
        this.mesh.metadata = { 
            entityType: 'Player', 
            name: 'Player', 
            isPlayer: true 
        };
    }

    async loadCharacterModel() {
        const assetInfo = ASSET_MANIFEST.CHARACTERS.PLAYER.knight;
        
        if (!assetInfo) {
            console.log('[Player] Asset manifest not found, skipping character model');
            return;
        }

        try {
            const model = await this.scene.assetLoader.loadModel(assetInfo.model);
            
            if (model) {
                this.characterModel = model;
                this.characterModel.name = "PlayerCharacterModel";
                this.characterModel.parent = this.visualRoot;
                this.characterModel.scaling.setAll(assetInfo.scale);
                
                // Apply offset to place model correctly relative to the physics body
                const offset = assetInfo.offset || { x: 0, y: 0, z: 0 };
                this.characterModel.position.set(offset.x, offset.y, offset.z);
                
                // Configure animations
                const animationGroups = this.scene.animationGroups;
                for (const group of animationGroups) {
                    if (group.name.includes(this.characterModel.name)) {
                        // Map animations
                        for (const key in assetInfo.animations) {
                            if (group.name.endsWith(assetInfo.animations[key])) {
                                this.animations[key] = group;
                                // Stop all animations initially
                                group.stop();
                            }
                        }
                    }
                }
                
                // Start with idle animation
                this.playAnimation('idle');
                
                // Enable shadows for the character model
                if (this.scene.world?.shadowGenerator) {
                    this.scene.world.shadowGenerator.addShadowCaster(this.characterModel);
                }

                console.log('[Player] ✓ Character model loaded and animations mapped');
            } else {
                console.warn('[Player] Failed to load character model from:', assetInfo.model);
            }
        } catch (e) {
            console.error('[Player] Error loading character model:', e);
        }
    }

    playAnimation(name, loop = true) {
        if (this.currentAnimation === this.animations[name]) return;
        
        if (this.currentAnimation) {
            this.currentAnimation.stop();
        }
        
        const newAnimation = this.animations[name];
        if (newAnimation) {
            newAnimation.start(loop, 1.0, newAnimation.from, newAnimation.to, false);
            this.currentAnimation = newAnimation;
        } else {
            // console.warn(`[Player] Animation not found: ${name}`);
        }
    }

    setupCamera() {
        this.camera = new BABYLON.FollowCamera(
            "playerCamera",
            new BABYLON.Vector3(0, 5, -10),
            this.scene,
            this.mesh // Target to follow is the physics collider
        );
        
        // Camera settings
        this.camera.radius = 12; // How far back the camera is
        this.camera.heightOffset = 4; // How high the camera is
        this.camera.rotationOffset = 180; // Start looking forward
        this.camera.cameraAcceleration = 0.05;
        this.camera.maxCameraSpeed = 20;
        this.camera.inputs.removeByType("FollowCameraPointersInput"); // Disable pointer input to handle it manually
        
        this.scene.activeCamera = this.camera;
        
        console.log('[Player] ✓ Camera setup complete');
    }

    setupInput() {
        // Keyboard Input Map
        const map = {};
        this.scene.actionManager = new BABYLON.ActionManager(this.scene);
        
        // Key down
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, (evt) => {
                map[evt.sourceEvent.key.toLowerCase()] = evt.sourceEvent.type === "keydown";
                this.updateInputState(map);
            })
        );

        // Key up
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, (evt) => {
                map[evt.sourceEvent.key.toLowerCase()] = evt.sourceEvent.type === "keydown";
                this.updateInputState(map);
            })
        );
        
        // Mouse/Pointer Lock
        this.scene.onPointerDown = (evt) => {
            if (evt.button === 0) { // Left click
                // Lock the mouse pointer
                if (!document.pointerLockElement) {
                    this.scene.getEngine().enterPointerlock();
                }
                
                // Handle targeting
                const pickInfo = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
                this.handlePointerDown(pickInfo);
            }
        };

        console.log('[Player] ✓ Input setup complete');
    }

    updateInputState(map) {
        this.input.forward = map['w'] || map['arrowup'];
        this.input.backward = map['s'] || map['arrowdown'];
        this.input.left = map['a'] || map['arrowleft'];
        this.input.right = map['d'] || map['arrowright'];
        this.input.run = map['shift'];
        
        // Jump is handled slightly differently to queue the jump on keydown
        if (map[' ']) {
            if (!this.jumpHeld) {
                this.queueJump();
            }
            this.jumpHeld = true;
        } else {
            this.releaseJump();
        }
    }

    setupGamepad() {
        const manager = new BABYLON.GamepadManager(this.scene);
        
        // Connection handler
        manager.onGamepadConnectedObservable.add((gamepad, state) => {
            console.log(`[Player] Gamepad connected: ${gamepad.id}`);
            this.gamepad.connected = true;
            this.activeGamepad = gamepad;
            
            // XBox controller specific setup
            if (gamepad instanceof BABYLON.Xbox360Pad) {
                
                // PATCHED: Check for existence of BABYLON.Xbox360Button before accessing its properties.
                if (typeof BABYLON.Xbox360Button !== 'undefined' && typeof BABYLON.Xbox360Button.XBox === 'undefined') {
                    // Set a fallback if the constant is missing, preventing the TypeError
                    BABYLON.Xbox360Button.XBox = 99; 
                }
                
                // LEFT STICK - Movement
                gamepad.onLeftStickChanged((axes) => {
                    const DEADZONE = 0.2;
                    this.gamepad.moveX = Math.abs(axes.x) > DEADZONE ? axes.x : 0;
                    this.gamepad.moveY = Math.abs(axes.y) > DEADZONE ? axes.y : 0;
                });

                // RIGHT STICK - Camera Look (handled by FollowCamera's standard input if enabled, or handled manually here)
                gamepad.onRightStickChanged((axes) => {
                    const DEADZONE = 0.1;
                    this.gamepad.lookX = Math.abs(axes.x) > DEADZONE ? axes.x : 0;
                    this.gamepad.lookY = Math.abs(axes.y) > DEADZONE ? axes.y : 0;
                });
                
                // Buttons
                gamepad.onButtonDownObservable.add((button) => {
                    // Ignore the XBox/Guide button entirely as it is often the source of a crash or unwanted behavior
                    if (typeof BABYLON.Xbox360Button !== 'undefined' && button === BABYLON.Xbox360Button.XBox) { 
                        return;
                    }
                    
                    // A button - Jump
                    if (button === BABYLON.Xbox360Button.A) {
                        this.queueJump();
                    }
                    
                    // X button - Attack
                    if (button === BABYLON.Xbox360Button.X) {
                        // TODO: Implement attack logic
                    }
                });

                gamepad.onButtonUpObservable.add((button) => {
                    // A button - Jump Release
                    if (button === BABYLON.Xbox360Button.A) {
                        this.releaseJump();
                    }
                });
                
                // Triggers and Bumpers for Run/Crouch
                gamepad.onButtonChange((button, value) => {
                    // Left Bumper (LB) for Run (button 4)
                    const runPressed = gamepad.buttons[4] && gamepad.buttons[4].pressed;
                    this.input.run = runPressed;
                    
                    // Jump check (for long-press logic)
                    const jumpPressed = gamepad.buttons[0] && gamepad.buttons[0].pressed;
                    if (jumpPressed) {
                        if (!this.jumpHeld) {
                            this.queueJump();
                        }
                        this.jumpHeld = true;
                    } else {
                        this.releaseJump();
                    }
                });
            }
        });

        // Disconnection handler
        manager.onGamepadDisconnectedObservable.add((gamepad, state) => {
            console.log(`[Player] Gamepad disconnected: ${gamepad.id}`);
            this.gamepad.connected = false;
            this.activeGamepad = null;
        });
        
        console.log('[Player] ✓ Gamepad setup complete');
    }

    update(deltaTime) {
        if (!this.mesh || !this.physicsReady) return;

        let moveVector = BABYLON.Vector3.Zero();
        let isMoving = false;
        
        // 1. Calculate base movement vector from keyboard/gamepad
        if (this.input.forward || this.gamepad.moveY < 0) {
            moveVector.z += this.input.forward ? 1 : -this.gamepad.moveY;
            isMoving = true;
        }
        if (this.input.backward || this.gamepad.moveY > 0) {
            moveVector.z -= this.input.backward ? 1 : this.gamepad.moveY;
            isMoving = true;
        }
        if (this.input.left || this.gamepad.moveX < 0) {
            moveVector.x -= this.input.left ? 1 : -this.gamepad.moveX;
            isMoving = true;
        }
        if (this.input.right || this.gamepad.moveX > 0) {
            moveVector.x += this.input.right ? 1 : this.gamepad.moveX;
            isMoving = true;
        }
        
        // Normalize movement vector
        if (moveVector.length() > 1) {
            moveVector = moveVector.normalize();
        }
        
        // Determine speed
        const currentSpeed = this.speed * (this.input.run ? this.runMultiplier : 1.0);
        
        // 2. Rotation (Rotate Visual Root)
        if (isMoving && this.camera) {
            // Get camera yaw (rotation around Y axis)
            const cameraYaw = this.camera.rotation.y;
            
            // Calculate target rotation angle (world-space)
            const angle = Math.atan2(moveVector.x, moveVector.z);
            const targetRotation = cameraYaw + angle;
            
            // Interpolate rotation for smooth turning
            this.visualRoot.rotation.y = this.lerp(
                this.visualRoot.rotation.y, 
                targetRotation, 
                this.rotationSpeed
            );
            
            this.lastFacing = this.visualRoot.rotation.y; // Store for when we stop moving
        } else if (this.visualRoot) {
            // If standing still, face the last direction
            this.visualRoot.rotation.y = this.lastFacing; 
        }

        // 3. Apply Horizontal Movement (Apply impulse/velocity to physics body)
        if (isMoving) {
            // Transform movement vector from local space (relative to camera) to world space
            const worldMovement = this.visualRoot.forward.scale(currentSpeed);
            
            // Set linear velocity
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            const targetVelocity = new BABYLON.Vector3(worldMovement.x, currentVelocity.y, worldMovement.z);
            
            // Use velocity interpolation for smoother control, or simply set velocity
            this.mesh.physicsImpostor.setLinearVelocity(targetVelocity);
            
            // Animation
            this.playAnimation(this.input.run ? 'run' : 'walk');
            
        } else {
            // Stop horizontal movement using damping/friction
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    currentVelocity.x * (1 - CONFIG.PLAYER.ROTATION_LERP), // Use damping constant
                    currentVelocity.y, 
                    currentVelocity.z * (1 - CONFIG.PLAYER.ROTATION_LERP)
                )
            );
            
            // Animation
            this.playAnimation('idle');
        }
        
        // 4. Handle Jump
        if (this.jumpQueued && this.onGround) {
            this.mesh.physicsImpostor.wakeUp();
            this.mesh.physicsImpostor.applyImpulse(
                new BABYLON.Vector3(0, this.jumpForce * CONFIG.PLAYER.IMPULSE_STRENGTH, 0),
                this.mesh.position
            );
            this.onGround = false;
            this.isOnGround = false;
            this.jumpQueued = false;
            this.playAnimation('jump', false); // Jump animation usually doesn't loop
        }
        
        // 5. Ground Check (Using Raycast or simplified Y-position check)
        this.checkGroundStatus(deltaTime);

        // 6. Update UI (Health/Stamina)
        this.updateUI();
    }
    
    checkGroundStatus(deltaTime) {
        if (!this.worldReady) return;
        
        const world = this.scene.game?.world;
        if (!world || typeof world.getTerrainHeight !== 'function') return;

        // Simplified check: raycast straight down from the center of the collider
        const ray = new BABYLON.Ray(this.mesh.position, BABYLON.Vector3.Down(), this.groundOffset + 0.5);
        const pickInfo = this.scene.pickWithRay(ray, (mesh) => mesh === world.terrain || mesh === world.collisionBarrier);

        const currentOnGround = pickInfo.hit && pickInfo.pickedPoint.y < this.mesh.position.y - (this.colliderHeight * 0.4);

        if (currentOnGround && !this.onGround) {
            // Landed
            this.onGround = true;
            this.isOnGround = true;
            this.verticalVelocity = 0;
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    this.mesh.physicsImpostor.getLinearVelocity().x,
                    0,
                    this.mesh.physicsImpostor.getLinearVelocity().z
                )
            );
        } else if (!currentOnGround && this.onGround) {
            // Just stepped off a ledge, or jumped
            this.onGround = false;
            this.isOnGround = false;
        }
        
        this.isOnGround = this.onGround; // Keep UI state updated
    }

    lerp(a, b, t) {
        return a + (b - a) * t;
    }

    updateUI() {
        if (this.scene.game?.ui) {
            this.scene.game.ui.updatePlayerStats(this);
            
            if (CONFIG.DEBUG) {
                const fps = this.scene.getEngine().getFps().toFixed(0);
                const pos = this.mesh.position.toFixed(2);
                this.scene.game.ui.updateDebugText(`FPS: ${fps}\nPos: ${pos}\nGround: ${this.isOnGround}`);
            }
        }
    }

    // ========== TARGETING & COMBAT ==========

    setTarget(targetMesh) {
        if (this.currentTarget) {
            // Remove highlight from old target
            if (this.targetHighlight) {
                this.targetHighlight.dispose();
                this.targetHighlight = null;
            }
        }
        
        this.currentTarget = targetMesh;
        if (this.currentTarget) {
            this.createTargetHighlight(this.currentTarget);
            console.log(`[Player] Target set to: ${targetMesh.name}`);
        }
    }
    
    createTargetHighlight(targetMesh) {
        // Create a circular decal/mesh at the target's feet
        this.targetHighlight = BABYLON.MeshBuilder.CreateGround('targetHighlight', {
            width: 1.5,
            height: 1.5,
            subdivisions: 1
        }, this.scene);
        
        // Initial placement
        this.targetHighlight.position.x = targetMesh.position.x;
        this.targetHighlight.position.z = targetMesh.position.z;
        this.targetHighlight.position.y = this.scene.game.world.getTerrainHeight(targetMesh.position.x, targetMesh.position.z) + 0.02; // Offset slightly above ground
        
        // Red glow material
        const mat = new BABYLON.StandardMaterial('targetMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        mat.disableLighting = true;
        this.targetHighlight.material = mat;
        
        // Animate highlight
        const startTime = Date.now();
        this.scene.onBeforeRenderObservable.add((scene) => {
            if (!this.targetHighlight || !this.currentTarget) return;
            
            const time = (Date.now() - startTime) / 1000;
            
            // Pulse scale
            this.targetHighlight.scaling.setAll(1 + Math.sin(time * 3) * 0.1);
            
            // Follow target
            this.targetHighlight.position.x = this.currentTarget.position.x;
            this.targetHighlight.position.z = this.currentTarget.position.z;
            this.targetHighlight.position.y = scene.game.world.getTerrainHeight(this.currentTarget.position.x, this.currentTarget.position.z) + 0.02;
        }, -1, false, this);
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
        if (this.visualRoot) {
            this.visualRoot.dispose();
        }
        // Dispose animation groups
        for (const key in this.animations) {
            if (this.animations[key]) {
                this.animations[key].dispose();
                this.animations[key] = null;
            }
        }
        this.activeGamepad = null;
        console.log('[Player] Disposed.');
    }
}
