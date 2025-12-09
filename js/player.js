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
        
        if (world && typeof world.getHeightAt === 'function') {
            const groundY = world.getHeightAt(0, 0); // Get height at world center (0, 0)
            spawnY = groundY + this.colliderHeight / 2 + 0.2; // Centered on collider with slight lift (0.2)
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
            if (this.scene.world && typeof this.scene.world.getHeightAt === 'function') {
                const groundY = this.scene.world.getHeightAt(this.mesh.position.x, this.mesh.position.z);
                this.mesh.position.y = groundY + this.colliderHeight / 2;
                this.onGround = true;
                this.isOnGround = true; // For UI
                this.verticalVelocity = 0;
                console.log(`[Player] ✓ Snapped to ground at y=${this.mesh.position.y.toFixed(2)}, onGround=true`);
            }
        }, 100);
        
        console.log('[Player] ✓ Player initialized and ready');
    }
    
    // Utility to wait for the terrain mesh to be created in the world
    waitForTerrain(timeoutSeconds) {
        return new Promise(resolve => {
            const check = () => {
                const world = this.scene.game?.world;
                if (world && world.terrain) {
                    resolve(world.terrain);
                    return;
                }
                if (timeoutSeconds <= 0) {
                    resolve(null);
                    return;
                }
                timeoutSeconds--;
                setTimeout(check, 100);
            };
            check();
        });
    }
    
    // Creates the invisible capsule/cylinder collider mesh
    createPlayerMesh(spawnY) {
        // Create a cylinder mesh to act as the physics collider
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", {
            height: this.colliderHeight,
            diameter: this.colliderRadius * 2
        }, this.scene);
        
        // Set initial position - y is the center of the cylinder!
        this.mesh.position = new BABYLON.Vector3(0, spawnY, 0);
        
        // Hide the collider mesh
        this.mesh.isVisible = false;
        
        // Enable collisions
        this.mesh.checkCollisions = true;
        
        // Add metadata for picking (in case a visible model hasn't loaded yet)
        this.mesh.metadata = { isPlayer: true, entity: this };
        
        // Setup physics impostor
        if (this.scene.getPhysicsEngine() && this.mesh.getScene().getPhysicsEngine().get
        name() === 'CannonJSPlugin') {
            try {
                this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                    this.mesh,
                    BABYLON.PhysicsImpostor.CylinderImpostor,
                    {
                        mass: CONFIG.PLAYER.MASS || 15,
                        friction: CONFIG.PLAYER.FRICTION || 0.2,
                        restitution: 0.0,
                        disableBidirectionalTransformation: true // Crucial for preventing tilt
                    },
                    this.scene
                );
                
                // Lock rotation to keep player upright
                this.mesh.physicsImpostor.setAngularFactor(BABYLON.Vector3.Zero());
                this.mesh.physicsImpostor.setLinearFactor(new BABYLON.Vector3(1, 1, 1));
                
                this.physicsReady = true;
                console.log('[Player] Collider mesh and Cannon.js impostor created');
            } catch (err) {
                console.error('[Player] Failed to create physics impostor:', err);
            }
        } else {
            console.warn('[Player] Physics engine not ready or not Cannon.js, using manual movement.');
        }
    }
    
    // Loads the actual visible character model and attaches it to the collider
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

            this.characterModel = result.meshes[0];
            
            // Set up visual root which will be parented to the collider
            this.visualRoot = new BABYLON.Mesh("playerVisualRoot", this.scene);
            this.visualRoot.parent = this.mesh;
            
            // Scale and offset
            this.characterModel.scaling.scaleInPlace(characterConfig.scale);
            this.characterModel.parent = this.visualRoot;
            
            // Apply offset from config (relative to the collider's center)
            const offset = characterConfig.offset;
            this.visualRoot.position.set(offset.x, offset.y, offset.z);
            
            // Enable shadows
            if (this.scene.shadowGenerator) {
                this.scene.shadowGenerator.addShadowCaster(this.characterModel);
            }
            
            console.log('[Player] ✓ Character model loaded and parented');
            
            // Store animation groups
            this.animations.idle = result.animationGroups.find(g => g.name === characterConfig.animations.idle);
            this.animations.walk = result.animationGroups.find(g => g.name === characterConfig.animations.walk);
            this.animations.run = result.animationGroups.find(g => g.name === characterConfig.animations.run);
            this.animations.jump = result.animationGroups.find(g => g.name === characterConfig.animations.jump);

            // Start default animation
            this.playAnimation('idle');

        } catch (e) {
            console.error('[Player] Failed to load character model:', e);
            // Fallback: Make the collider visible if model fails
            this.mesh.isVisible = true;
            this.mesh.material = new BABYLON.StandardMaterial('playerMat', this.scene);
            this.mesh.material.diffuseColor = BABYLON.Color3.Blue();
        }
    }
    
    playAnimation(name, loop = true) {
        const anim = this.animations[name];
        if (anim) {
            // Stop previous animation group
            if (this.currentAnimation) {
                this.currentAnimation.stop();
            }
            // Play new animation group
            anim.start(loop);
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

        // CRITICAL FIX: Set the camera as the scene's active camera
        this.scene.activeCamera = this.camera;

        this.camera.lowerRadiusLimit = 3;
        this.camera.upperRadiusLimit = 20;
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);

        // Make camera follow player
        this.camera.lockedTarget = this.mesh;
        this.camera.checkCollisions = true; // Enable camera collisions
        this.camera.collisionRadius = new BABYLON.Vector3(0.5, 0.5, 0.5); // Collision size
    }
    
    setupInput() {
        const inputMap = {};
        this.scene.actionManager = new BABYLON.ActionManager(this.scene);

        // Key Down Actions
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, evt => {
                inputMap[evt.sourceEvent.key] = evt.sourceEvent.type === "keydown";
                
                switch (evt.sourceEvent.key.toLowerCase()) {
                    case 'w':
                    case 'arrowup':
                        this.input.forward = true;
                        break;
                    case 's':
                    case 'arrowdown':
                        this.input.backward = true;
                        break;
                    case 'a':
                    case 'arrowleft':
                        this.input.left = true;
                        break;
                    case 'd':
                    case 'arrowright':
                        this.input.right = true;
                        break;
                    case 'shift':
                        this.input.run = true;
                        break;
                    case ' ': // Space
                        this.queueJump();
                        this.jumpHeld = true;
                        break;
                    case 'e':
                        this.tryInteraction();
                        break;
                    case 'q':
                        this.setNextTarget();
                        break;
                }
            })
        );

        // Key Up Actions
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, evt => {
                inputMap[evt.sourceEvent.key] = evt.sourceEvent.type === "keydown";
                
                switch (evt.sourceEvent.key.toLowerCase()) {
                    case 'w':
                    case 'arrowup':
                        this.input.forward = false;
                        break;
                    case 's':
                    case 'arrowdown':
                        this.input.backward = false;
                        break;
                    case 'a':
                    case 'arrowleft':
                        this.input.left = false;
                        break;
                    case 'd':
                    case 'arrowright':
                        this.input.right = false;
                        break;
                    case 'shift':
                        this.input.run = false;
                        break;
                    case ' ': // Space
                        this.releaseJump();
                        break;
                }
            })
        );
        
        // Mobile/Touch Input (Simplified virtual joystick)
        const DEADZONE = 0.2;
        const RUNZONE = 0.7;
        let touchStart = null;
        
        const resetMovement = () => {
            this.input.forward = this.input.backward = this.input.left = this.input.right = this.input.run = false;
        };

        const onTouchMove = (evt) => {
            if (!touchStart || !evt.changedTouches || evt.changedTouches.length === 0) return;
            
            const t = evt.changedTouches[0];
            const dx = (t.clientX - touchStart.x) / 100; // Normalize movement
            const dy = (t.clientY - touchStart.y) / 100;

            resetMovement();
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

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
                // Simple assumption: if touch starts in left half, it's movement
                if (x < window.innerWidth / 2) {
                    touchStart = { x, y };
                    break;
                }
                // Right side is assumed for camera/action
                if (x >= window.innerWidth / 2) {
                    // Treat as tap for interaction or attack
                    const pickInfo = this.scene.pick(x, y);
                    this.handlePointerDown(pickInfo);
                }
            }
        };

        const onTouchEnd = (evt) => {
            if (!touchStart) return;
            resetMovement();
            touchStart = null;
        };

        window.addEventListener('touchstart', onTouchStart, false);
        window.addEventListener('touchmove', onTouchMove, false);
        window.addEventListener('touchend', onTouchEnd, false);
    }
    
    setupGamepad() {
        const gamepadManager = new BABYLON.GamepadManager(this.scene);
        gamepadManager.onGamepadConnectedObservable.add((gamepad) => {
            this.gamepad.connected = true;
            console.log('[Player] Gamepad connected:', gamepad.id);
            
            gamepad.onleftstickchanged((axis) => {
                this.gamepad.moveX = axis.x;
                this.gamepad.moveY = axis.y;
            });
            
            gamepad.onrightstickchanged((axis) => {
                this.gamepad.lookX = axis.x;
                this.gamepad.lookY = axis.y;
            });
        });
        
        gamepadManager.onGamepadDisconnectedObservable.add(() => {
            this.gamepad.connected = false;
            console.log('[Player] Gamepad disconnected');
            this.gamepad.moveX = this.gamepad.moveY = this.gamepad.lookX = this.gamepad.lookY = 0;
            this.input.run = false;
        });
        
        this.gamepadManager = gamepadManager;
    }
    
    // Called by world when it's fully ready
    // Hook for future physics implementation
    startAfterWorldReady() {
        console.log('[Player] ✓ World ready signal received');
        // TODO: Re-enable physics here when reimplemented
    }

    // Main update loop
    update(deltaTime) {
        this.handleGamepadInput(deltaTime);
        this.updateMovement(deltaTime);
        this.updateRotation(deltaTime);
        this.updateTargetHighlight(deltaTime);
    }
    
    handleGamepadInput(deltaTime) {
        if (!this.gamepad.connected) return;

        const DEADZONE = 0.15;
        const RUNZONE = 0.6;
        
        // Reset keyboard/gamepad-derived input
        this.input.forward = this.input.backward = this.input.left = this.input.right = false;

        const dx = this.gamepad.moveX;
        const dy = this.gamepad.moveY;

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        // Movement (Left Stick)
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

        // Button handling (Requires raw gamepad access, which is complicated with BABYLON.js GamepadManager)
        // Assume buttons are mapped: 0=A/Cross (Jump), 1=B/Circle (Run/Dash), 2=X/Square (Attack), 3=Y/Triangle (Interact)
        
        const gamepad = this.gamepadManager.gamepads[0];
        if (!gamepad || !gamepad.buttons) return;

        // B/Circle (1) - Run/Dash
        const runPressed = (gamepad.buttons[1] && gamepad.buttons[1].pressed) || (gamepad.buttons[6] && gamepad.buttons[6].pressed) || (gamepad.buttons[7] && gamepad.buttons[7].pressed);
        this.input.run = runPressed;

        // A/Cross (0) - Jump
        const jumpPressed = gamepad.buttons[0] && gamepad.buttons[0].pressed;
        if (jumpPressed) {
            if (!this.jumpHeld) {
                this.queueJump();
            }
            this.jumpHeld = true;
        } else {
            this.releaseJump();
        }

        // Camera Look (Right Stick) is handled directly in the rotation update
    }

    updateMovement(deltaTime) {
        if (!this.mesh) return;

        let totalSpeed = this.speed;
        if (this.input.run) {
            totalSpeed *= this.runMultiplier;
            this.playAnimation('run', true);
        } else if (this.input.forward || this.input.backward || this.input.left || this.input.right) {
            this.playAnimation('walk', true);
        } else {
            this.playAnimation('idle', true);
        }
        
        // Calculate camera direction
        const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
        const right = this.camera.getDirection(BABYLON.Vector3.Right());

        // Zero out vertical component to keep movement flat relative to camera plane
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();

        // Calculate movement direction vector
        let moveDir = BABYLON.Vector3.Zero();

        if (this.input.forward) moveDir.addInPlace(forward);
        if (this.input.backward) moveDir.subtractInPlace(forward);
        if (this.input.right) moveDir.addInPlace(right);
        if (this.input.left) moveDir.subtractInPlace(right);
        
        const hasMovement = moveDir.lengthSquared() > 0;
        if (hasMovement) {
            moveDir.normalize();
        }

        // Apply jump logic
        if (this.jumpQueued && this.onGround) {
            this.verticalVelocity = this.jumpForce;
            this.onGround = false;
            this.jumpQueued = false;
            this.isOnGround = false; // For UI
            this.playAnimation('jump', false);
        }

        // Apply gravity
        if (!this.onGround) {
            this.verticalVelocity += this.gravity * deltaTime;
        }

        // Total displacement calculation
        const speed = hasMovement ? totalSpeed : 0;
        const flatDisplacement = moveDir.scale(speed * deltaTime);
        
        // Final displacement vector (including vertical velocity from jump/gravity)
        const displacement = flatDisplacement.clone();
        displacement.y = this.verticalVelocity * deltaTime;

        const previousPosition = this.mesh.position.clone();

        // Use moveWithCollisions for physics-aware movement
        this.mesh.moveWithCollisions(displacement);

        // Post-move vertical check (simple ground detection)
        const newPosition = this.mesh.position;
        const moved = newPosition.subtract(previousPosition);
        
        // Check if movement stopped vertically (hit ground or ceiling)
        const collidedVertically = (moved.y < displacement.y - 0.001) && (displacement.y < 0);
        
        if (collidedVertically) {
            // Hit ground
            if (this.verticalVelocity < 0) {
                this.verticalVelocity = 0;
                this.onGround = true;
                this.isOnGround = true; // For UI
                this.playAnimation(this.input.run ? 'run' : (hasMovement ? 'walk' : 'idle'), true);
            }
        }
        
        // Check for pickup collision (simple radius check)
        this.checkItemPickup();

        // Update facing from ACTUAL movement to avoid stale rotation when sliding/blocked
        const flatMovement = new BABYLON.Vector3(moved.x, 0, moved.z);
        if (flatMovement.lengthSquared() > 0.0001) {
            const targetRotation = Math.atan2(flatMovement.x, flatMovement.z) + Math.PI;
            this.lastFacing = targetRotation; // Store the rotation for continuous turning
        }

        // Update UI
        if (this.scene.game.ui) {
            this.scene.game.ui.updatePlayerStats(this);
        }
    }
    
    updateRotation(deltaTime) {
        if (!this.mesh) return;

        let targetRotation = this.lastFacing;

        // Apply keyboard/gamepad rotation to the visual root
        if (this.visualRoot) {
            this.visualRoot.rotation.y = BABYLON.Scalar.Lerp(
                this.visualRoot.rotation.y,
                targetRotation,
                this.rotationSpeed * 5 // Faster rotation on movement
            );
        }
        
        // Apply camera/look rotation from gamepad (Right Stick)
        if (this.gamepad.connected && (Math.abs(this.gamepad.lookX) > 0.1 || Math.abs(this.gamepad.lookY) > 0.1)) {
            const lookSpeed = 2.5; // Sensitivity factor

            // Horizontal orbit
            this.camera.alpha += this.gamepad.lookX * lookSpeed * deltaTime;

            // Vertical orbit (up/down) - INVERTED
            this.camera.beta -= this.gamepad.lookY * lookSpeed * deltaTime;
            const minBeta = 0.2;
            const maxBeta = Math.PI - 0.2;
            if (this.camera.beta < minBeta) this.camera.beta = minBeta;
            if (this.camera.beta > maxBeta) this.camera.beta = maxBeta;
        }
    }

    // ============================================================
    // COMBAT & INTERACTION
    // ============================================================
    
    setTarget(mesh) {
        if (!mesh || mesh === this.currentTarget) return;
        
        // Dispose old highlight
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
            this.targetHighlight = null;
        }

        this.currentTarget = mesh.metadata.entity || mesh;
        
        // Create new highlight
        this.createTargetHighlight();
        
        console.log(`[Player] Target set to: ${this.currentTarget.name || this.currentTarget.constructor.name}`);
    }
    
    setNextTarget() {
        const enemies = this.scene.game.world?.enemies || [];
        if (enemies.length === 0) {
            this.setTarget(null);
            return;
        }
        
        // Simple cycler: find current index, go to next
        const currentIndex = this.currentTarget ? enemies.findIndex(e => e === this.currentTarget) : -1;
        const nextIndex = (currentIndex + 1) % enemies.length;
        
        this.setTarget(enemies[nextIndex]);
    }
    
    createTargetHighlight() {
        if (!this.currentTarget || this.targetHighlight) return;
        
        // Create ring around target
        this.targetHighlight = BABYLON.MeshBuilder.CreateTorus(
            'targetHighlight',
            { diameter: 2.0, thickness: 0.2, tessellation: 30 },
            this.scene
        );
        this.targetHighlight.rotation.x = Math.PI / 2;
        this.targetHighlight.position.y = this.currentTarget.mesh.position.y - 0.9;
        
        // Red glow material
        const mat = new BABYLON.StandardMaterial('targetMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        mat.disableLighting = true;
        this.targetHighlight.material = mat;
        
        // Animate highlight
        const startTime = Date.now();
        this.scene.onBeforeRenderObservable.add(() => {
            if (!this.targetHighlight || !this.currentTarget || !this.currentTarget.mesh) return;
            
            const time = (Date.now() - startTime) / 1000;
            
            // Pulse scale
            this.targetHighlight.scaling.setAll(1 + Math.sin(time * 3) * 0.1);
            
            // Follow target
            this.targetHighlight.position.x = this.currentTarget.mesh.position.x;
            this.targetHighlight.position.z = this.currentTarget.mesh.position.z;
        });
    }
    
    // Handle mouse click targeting
    handlePointerDown(pickInfo) {
        if (!pickInfo.hit) return;
        
        const mesh = pickInfo.pickedMesh;
        if (!mesh || !mesh.metadata) return;
        
        // Check if clicked mesh is targetable (Enemy or NPC)
        if (mesh.metadata.isEnemy || mesh.metadata.isNPC) {
            this.setTarget(mesh);
        } else if (mesh.metadata.isItem) {
            // Pick up item on click
            this.tryPickupItem(mesh.metadata.entity);
        }
    }
    
    tryInteraction() {
        // Simple sphere check for nearby interactable objects (NPCs, Chests, etc.)
        const INTERACT_RANGE = 4.0;
        const playerPos = this.mesh.position;
        
        const nearbyNPC = (this.scene.game.world?.npcs || []).find(npc => {
            return BABYLON.Vector3.Distance(playerPos, npc.mesh.position) <= INTERACT_RANGE;
        });
        
        if (nearbyNPC) {
            nearbyNPC.talkTo(this);
            return;
        }

        // Simple attack logic:
        if (this.currentTarget) {
            const distance = BABYLON.Vector3.Distance(playerPos, this.currentTarget.mesh.position);
            if (distance <= 3.0) {
                this.attack(this.currentTarget);
                return;
            }
        }
        
        this.scene.game.ui.showMessage("Nothing to interact with here.", 1500);
    }

    attack(target) {
        // Simple attack placeholder
        const damage = 10 + Math.floor(Math.random() * 5); // 10-15 damage
        if (target && target.takeDamage) {
            target.takeDamage(damage, this);
            this.scene.game.ui.showMessage(`Attacked ${target.name || 'Enemy'} for ${damage} damage!`, 1000, 'playerAction');
        }
        // Play attack animation
        this.playAnimation('attack', false);
        this.playAnimation('idle', true); // Revert to idle
    }

    takeDamage(amount, source) {
        this.health -= amount;
        if (this.health < 0) this.health = 0;
        
        // Show damage text
        if (this.scene.game.ui) {
            this.scene.game.ui.showFloatingText(
                amount.toFixed(0),
                this.mesh.position.add(new BABYLON.Vector3(0, 1.5, 0)),
                'enemyDamage' // Player taking damage from enemy
            );
        }
        
        console.log(`[Player] Took ${amount} damage. Health: ${this.health}`);

        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        console.log('[Player] DIED!');
        this.scene.game.ui.showMessage("YOU DIED. Game Over.", 5000);
        this.scene.game.stop();
        // TODO: Respawn logic
    }
    
    heal(amount) {
        this.health += amount;
        if (this.health > this.maxHealth) this.health = this.maxHealth;
        this.scene.game.ui.showFloatingText(
            `+${amount.toFixed(0)}`,
            this.mesh.position.add(new BABYLON.Vector3(0, 1.5, 0)),
            'heal'
        );
    }
    
    restoreMana(amount) {
        this.mana += amount;
        if (this.mana > this.maxMana) this.mana = this.maxMana;
    }
    
    checkItemPickup() {
        const PICKUP_RANGE = 2.0;
        const playerPos = this.mesh.position;
        
        // Filter items that are close enough
        const nearbyItems = (this.scene.game.world?.items || []).filter(item => {
            return BABYLON.Vector3.Distance(playerPos, item.mesh.position) <= PICKUP_RANGE;
        });
        
        for (const item of nearbyItems) {
            this.tryPickupItem(item);
        }
    }
    
    tryPickupItem(item) {
        if (!item || item._isDisposed) return;
        
        // Placeholder: Add item to an imaginary inventory, then dispose of the mesh
        const success = item.pickUp(this);
        if (success) {
            // Remove from world's list
            const items = this.scene.game.world.items;
            const index = items.indexOf(item);
            if (index > -1) {
                items.splice(index, 1);
            }
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
        if (this.gamepadManager) {
            this.gamepadManager.dispose();
        }
        this.scene.onBeforeRenderObservable.clear();
        console.log('[Player] Disposed');
    }
}
