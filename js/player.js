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
        
        // FIX for Uncaught SyntaxError (missing ) after argument list) at player.js:256:165
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, this.groundOffset, 0); 
        
        // Reset position to center for collision calculations to work relative to ellipsoid
        this.mesh.position = BABYLON.Vector3.Zero();
    }
    
    async loadCharacterModel() {
        // Configuration Check
        if (typeof CONFIG === 'undefined' || typeof ASSET_MANIFEST === 'undefined') {
            console.warn('[Player] Config or Asset manifest not found, skipping character model');
            return;
        }
        
        const characterConfig = ASSET_MANIFEST.CHARACTERS.PLAYER.knight;
        if (!characterConfig) {
            console.warn('[Player] Knight character config not found');
            return;
        }
        
        const modelPath = ASSET_MANIFEST.BASE_PATH + characterConfig.model;
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
            this.characterModel.name = 'playerCharacterModel';
            this.characterModel.parent = this.visualRoot;
            
            // Apply scale and offset from config
            const scale = characterConfig.scale || 1.0;
            this.characterModel.scaling.setAll(scale);
            
            const offset = characterConfig.offset || { x: 0, y: 0, z: 0 };
            this.characterModel.position = new BABYLON.Vector3(offset.x, offset.y, offset.z);
            
            // Make all character parts receive shadows
            result.meshes.forEach(m => {
                m.receiveShadows = true;
                if (this.scene.game?.world?.shadowGenerator) {
                    this.scene.game.world.shadowGenerator.addShadowCaster(m);
                }
            });
            
            // Store animation groups
            this.animationGroups = result.animationGroups;
            this.setupAnimations(characterConfig.animations);

        } catch (error) {
            console.error('[Player] Failed to load character model:', error);
            // Fallback: make the placeholder box visible
            this.mesh.visibility = 0.5;
            this.mesh.isVisible = true;
        }
    }

    setupAnimations(animMap) {
        if (!this.animationGroups) return;

        // Map animation names to groups
        this.animationGroups.forEach(group => {
            const name = group.name;
            for (const key in animMap) {
                if (animMap[key] === name) {
                    this.animations[key] = group;
                    group.stop(); // Stop all initially
                }
            }
        });

        // Start idle animation
        this.playAnimation('idle', true);
    }

    playAnimation(key, loop = false) {
        const anim = this.animations[key];
        if (anim && anim !== this.currentAnimation) {
            if (this.currentAnimation) {
                this.currentAnimation.stop();
            }
            anim.loopAnimation = loop;
            anim.start(true);
            this.currentAnimation = anim;
        }
    }

    setupCamera() {
        // Create third-person arc rotate camera
        this.camera = new BABYLON.ArcRotateCamera(
            'playerCamera',
            -Math.PI / 2,      // Alpha: Start facing forward
            Math.PI / 3,       // Beta: 60 degrees down
            10,                // Radius: 10 units away
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

        // Keyboard inputs
        const map = {}; // To store the state of keys

        this.scene.actionManager = new BABYLON.ActionManager(this.scene);
        
        const KEY_MAP = {
            'w': 'forward',
            's': 'backward',
            'a': 'left',
            'd': 'right',
            ' ': 'jump', // Spacebar
            'Shift': 'run'
        };

        // Key Down Actions
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, evt => {
                const key = evt.sourceEvent.key;
                if (KEY_MAP[key]) {
                    this.input[KEY_MAP[key]] = true;
                    if (key === ' ') {
                        this.queueJump();
                        this.jumpHeld = true;
                    }
                }
            })
        );

        // Key Up Actions
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, evt => {
                const key = evt.sourceEvent.key;
                if (KEY_MAP[key]) {
                    this.input[KEY_MAP[key]] = false;
                    if (key === ' ') {
                        this.releaseJump();
                    }
                }
            })
        );
        
        // Mouse/Touch for camera rotation is handled by the ArcRotateCamera's attachControl
        
        // Targeting (Example: Mouse Click)
        this.scene.onPointerDown = (evt, pickInfo) => {
            this.handlePointerDown(pickInfo);
        };
        
        console.log('[Player] ✓ Keyboard and Mouse input setup');
    }

    setupGamepad() {
        // Check for Gamepads
        const gamepads = new BABYLON.Gamepads.GamepadManager(this.scene);
        gamepads.onGamepadConnectedObservable.add((gamepad, state) => {
            console.log(`[Gamepad] Connected: ${gamepad.id}`);
            this.gamepad.connected = true;

            if (gamepad.type === BABYLON.Gamepads.Gamepad.XBOX) {
                // XBox gamepad specific setup
                const xboxPad = gamepad;
                
                // Left Stick (Movement)
                xboxPad.onleftstickchanged((values) => {
                    this.gamepad.moveX = values.x;
                    this.gamepad.moveY = values.y;

                    const DEADZONE = 0.15;
                    this.input.forward = values.y > DEADZONE;
                    this.input.backward = values.y < -DEADZONE;
                    this.input.right = values.x > DEADZONE;
                    this.input.left = values.x < -DEADZONE;
                    
                    // Run is generally done with a button on controllers, not stick deflection
                    // Leave run state alone for now
                });
                
                // Right Stick (Camera Look)
                xboxPad.onrightstickchanged((values) => {
                    this.gamepad.lookX = values.x;
                    this.gamepad.lookY = values.y;
                });
                
                // A Button (Jump)
                xboxPad.onbuttondown(7, () => {
                    if (!this.jumpHeld) {
                        this.queueJump();
                    }
                    this.jumpHeld = true;
                });
                xboxPad.onbuttonup(7, () => {
                    this.releaseJump();
                });
                
                // Left Bumper (Run) - Assuming left bumper is the run button
                xboxPad.onbuttondown(5, () => {
                    this.input.run = true;
                });
                xboxPad.onbuttonup(5, () => {
                    this.input.run = false;
                });
                
                // X Button (Target/Attack)
                xboxPad.onbuttondown(0, () => {
                    // Attack logic here
                });
            }
        });
        
        gamepads.onGamepadDisconnectedObservable.add((gamepad) => {
            console.log(`[Gamepad] Disconnected: ${gamepad.id}`);
            this.gamepad.connected = false;
            this.gamepad.moveX = 0;
            this.gamepad.moveY = 0;
            this.gamepad.lookX = 0;
            this.gamepad.lookY = 0;
        });

        console.log('[Player] ✓ Gamepad manager initialized');
    }

    update(deltaTime) {
        if (!this.mesh || !this.mesh.position) return;
        
        // ============================================================
        // MOVEMENT LOGIC
        // ============================================================
        const cameraRotationY = this.camera.alpha;
        let moveX = 0;
        let moveZ = 0;
        
        let currentSpeed = this.speed;
        if (this.input.run) {
            currentSpeed *= this.runMultiplier;
        }

        let hasMovement = false;
        
        // Calculate movement direction in world space relative to camera
        const forwardDirection = new BABYLON.Vector3(
            Math.sin(cameraRotationY), 
            0, 
            Math.cos(cameraRotationY)
        );
        const rightDirection = new BABYLON.Vector3(
            Math.sin(cameraRotationY + Math.PI / 2), 
            0, 
            Math.cos(cameraRotationY + Math.PI / 2)
        );

        let moveDirection = BABYLON.Vector3.Zero();

        if (this.input.forward) {
            moveDirection.addInPlace(forwardDirection);
            hasMovement = true;
        }
        if (this.input.backward) {
            moveDirection.subtractInPlace(forwardDirection);
            hasMovement = true;
        }
        if (this.input.right) {
            moveDirection.addInPlace(rightDirection);
            hasMovement = true;
        }
        if (this.input.left) {
            moveDirection.subtractInPlace(rightDirection);
            hasMovement = true;
        }

        if (hasMovement) {
            moveDirection = moveDirection.normalize();
        }

        // Apply jump queue
        if (this.jumpQueued && this.onGround) {
            this.verticalVelocity = this.jumpForce;
            this.onGround = false;
            this.isOnGround = false; // For UI
            this.jumpQueued = false;
            this.playAnimation('jump', false); // Play jump animation once
            
            // Revert to run/walk after jump anim
            setTimeout(() => {
                if (hasMovement) {
                    this.playAnimation(this.input.run ? 'run' : 'walk', true);
                } else {
                    this.playAnimation('idle', true);
                }
            }, 500); // 0.5 seconds for jump peak
        }
        
        // Gravity and vertical movement
        if (!this.onGround) {
            this.verticalVelocity += this.gravity * deltaTime;
        }
        
        // The total displacement vector for the frame
        const displacement = moveDirection.scale(currentSpeed * deltaTime);
        displacement.y = this.verticalVelocity * deltaTime;
        
        // Store pre-collision position for friction checks
        const previousPosition = this.mesh.position.clone();
        
        // Use Babylon's `moveWithCollisions`
        this.mesh.moveWithCollisions(displacement);

        // ============================================================
        // GROUND COLLISION & SNAPPING
        // ============================================================

        // Check for ground collision using world height
        const world = this.scene.game?.world;
        let groundY = -Infinity;
        if (world && typeof world.getTerrainHeight === 'function') {
            groundY = world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
        }

        const feetY = this.mesh.position.y - this.groundOffset;
        const groundHeightThreshold = groundY + 0.1; // Allow slight sinking before snap

        if (feetY <= groundHeightThreshold) {
            // Player is touching or slightly below the ground
            if (!this.onGround) {
                // Landed!
                this.verticalVelocity = 0;
                this.onGround = true;
                this.isOnGround = true; // For UI
                
                // Snap player position exactly onto the terrain
                this.mesh.position.y = groundY + this.groundOffset;
                
                // Play appropriate animation
                if (hasMovement) {
                    this.playAnimation(this.input.run ? 'run' : 'walk', true);
                } else {
                    this.playAnimation('idle', true);
                }
            }
        } else if (feetY > groundHeightThreshold) {
            // Player is in the air
            this.onGround = false;
            this.isOnGround = false;
        }
        
        // ============================================================
        // ROTATION AND ANIMATION
        // ============================================================

        // Only rotate if there is horizontal movement
        const moved = this.mesh.position.subtract(previousPosition);
        const flatMovement = new BABYLON.Vector3(moved.x, 0, moved.z);
        
        if (flatMovement.lengthSquared() > 0.0001) {
            // Calculate the desired rotation based on movement direction
            const targetRotation = Math.atan2(flatMovement.x, flatMovement.z);

            // Smoothly interpolate the visual root rotation
            if (this.visualRoot) {
                let currentRotation = this.visualRoot.rotation.y;
                
                // Handle wrap-around (e.g., rotating from 359 degrees to 1 degree)
                let diff = targetRotation - currentRotation;
                if (diff > Math.PI) diff -= 2 * Math.PI;
                if (diff < -Math.PI) diff += 2 * Math.PI;

                currentRotation += diff * this.rotationSpeed;
                this.visualRoot.rotation.y = currentRotation;
            }
            
            // Update animation if on ground
            if (this.onGround) {
                this.playAnimation(this.input.run ? 'run' : 'walk', true);
            }

        } else if (this.onGround && this.currentAnimation !== this.animations.idle) {
            // No horizontal movement, switch to idle
            this.playAnimation('idle', true);
        }
        
        // ============================================================
        // CAMERA UPDATE
        // ============================================================
        if (this.gamepad.connected) {
            const lookSpeed = 1.0;
            const lookX = this.gamepad.lookX;
            const lookY = this.gamepad.lookY;

            // Horizontal orbit (left/right)
            if (Math.abs(lookX) > 0.1) {
                this.camera.alpha += lookX * lookSpeed * deltaTime;
            }

            // Vertical orbit (up/down) - INVERTED
            if (Math.abs(lookY) > 0.1) {
                this.camera.beta -= lookY * lookSpeed * deltaTime;
                const minBeta = 0.2;
                const maxBeta = Math.PI - 0.2;
                if (this.camera.beta < minBeta) this.camera.beta = minBeta;
                if (this.camera.beta > maxBeta) this.camera.beta = maxBeta;
            }
        }
        
        // ============================================================
        // TARGETING VISUALS
        // ============================================================
        if (this.currentTarget) {
            if (!this.targetHighlight) {
                this.createTargetHighlight();
            }
            // Highlight update is handled by an observable on the scene
        } else if (this.targetHighlight) {
            this.targetHighlight.dispose();
            this.targetHighlight = null;
        }
    }
    
    // ============================================================
    // COMBAT AND UTILITY
    // ============================================================
    setTarget(targetMesh) {
        // Find the Entity object associated with the mesh
        const world = this.scene.game?.world;
        if (!world) return;
        
        let entity = null;
        const targetId = targetMesh.metadata.entityId;

        // Simplified check, assuming metadata contains enough info to find the entity
        if (targetMesh.metadata.isEnemy) {
            entity = world.enemies.find(e => e.mesh === targetMesh);
        } else if (targetMesh.metadata.isNPC) {
            entity = world.npcs.find(e => e.mesh === targetMesh);
        }
        
        if (entity) {
            this.currentTarget = entity;
            console.log(`[Player] Targeting: ${entity.name}`);
        }
    }
    
    targetNext() {
        // Simple logic to cycle through nearby enemies
        const world = this.scene.game?.world;
        if (!world || !world.enemies.length) return;
        
        const playerPos = this.mesh.position;
        const TARGET_RANGE = 20;

        // 1. Find all enemies in range
        const potentialTargets = world.enemies
            .filter(e => e.mesh && BABYLON.Vector3.Distance(playerPos, e.mesh.position) <= TARGET_RANGE)
            .sort((a, b) => BABYLON.Vector3.Distance(playerPos, a.mesh.position) - BABYLON.Vector3.Distance(playerPos, b.mesh.position));
            
        if (potentialTargets.length === 0) {
            this.currentTarget = null;
            return;
        }
        
        // 2. Find current target index
        const currentIndex = this.currentTarget 
            ? potentialTargets.findIndex(e => e === this.currentTarget)
            : -1;

        // 3. Select next target (wrap around)
        const nextIndex = (currentIndex + 1) % potentialTargets.length;
        this.setTarget(potentialTargets[nextIndex].mesh);
    }

    createTargetHighlight() {
        if (this.targetHighlight) return;
        
        // Create ring around target
        this.targetHighlight = BABYLON.MeshBuilder.CreateTorus('targetHighlight', { 
            diameter: 3, 
            thickness: 0.1, 
            tessellation: 32 
        }, this.scene);
        
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
            
            // Keep highlight slightly above ground
            const world = this.scene.game?.world;
            if (world && typeof world.getTerrainHeight === 'function') {
                const height = world.getTerrainHeight(this.targetHighlight.position.x, this.targetHighlight.position.z);
                this.targetHighlight.position.y = height + 0.1; // 0.1 units above ground
            } else {
                this.targetHighlight.position.y = 0.1; 
            }
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
        // Remove observables (like the target highlight one)
        // ... (This would be more complex, but for simplicity, disposing the mesh usually helps)
        console.log('[Player] Disposed');
    }
}
