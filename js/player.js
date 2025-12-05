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
        
        // Movement state
        this.verticalVelocity = 0;
        this.onGround = false;
        this.jumpQueued = false;
        this.coyoteTime = 0.1;         // Allow jump shortly after leaving ground
        this.coyoteTimer = 0;
        this.jumpBufferTime = 0.15;    // Allow jump shortly before landing
        this.jumpBufferTimer = 0;
        
        // Grounding
        this.groundOffset = 0.9;       // Approximate half-height of capsule
        this.onSlope = false;
        this.maxSlopeAngle = 45 * Math.PI / 180;
        
        // Camera & targeting
        this.gamepad = {
            connected: false,
            pad: null,
            moveX: 0,
            moveY: 0,
            lookX: 0,
            lookY: 0
        };
        
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
       
        // Last facing direction (radians)
        this.lastFacing = 0;
        
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
    
    async init() {
        // Create base mesh (capsule collider)
        const capsuleHeight = 1.8;
        const capsuleRadius = 0.5;
        
        this.mesh = BABYLON.MeshBuilder.CreateCapsule("playerCollider", {
            height: capsuleHeight,
            radius: capsuleRadius,
            tessellation: 8,
            subdivisions: 1
        }, this.scene);
        
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
        
        // Register with scene
        if (!this.scene.player) {
            this.scene.player = this;
        }
        
        this.physicsReady = true;
        
        console.log('[Player] Initialized');
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
            
            if (result.meshes.length === 0) {
                console.warn('[Player] No meshes found in character model');
                return;
            }
            
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
            
            // Enable shadows
            if (SCENE_LIGHTS.shadowGenerator) {
                result.meshes.forEach(mesh => {
                    if (mesh !== this.characterModel) {
                        SCENE_LIGHTS.shadowGenerator.addShadowCaster(mesh);
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
        
        this.scene.actionManager = this.scene.actionManager || new BABYLON.ActionManager(this.scene);
        
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnKeyDownTrigger,
                (evt) => {
                    this.handleKey(evt.sourceEvent, true);
                }
            )
        );
        
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnKeyUpTrigger,
                (evt) => {
                    this.handleKey(evt.sourceEvent, false);
                }
            )
        );
        
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
        
        if (isJumpPressed && !this.gamepadButtons.jump) {
            this.jumpQueued = true;
            this.jumpBufferTimer = this.jumpBufferTime;
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
        const runSpeed = this.speed * this.runMultiplier;

        // Update jump buffer & coyote timer
        this.coyoteTimer = this.onGround ? this.coyoteTime : Math.max(0, this.coyoteTimer - dt);
        if (this.jumpBufferTimer > 0) {
            this.jumpBufferTimer -= dt;
            if (this.jumpBufferTimer <= 0) {
                this.jumpQueued = false;
            }
        }

        // Handle jump
        if (this.jumpQueued && (this.onGround || this.coyoteTimer > 0)) {
            this.verticalVelocity = this.jumpForce;
            this.onGround = false;
            this.isOnGround = false;
            this.isJumping = true;
            this.isMoving = true;
            this.jumpQueued = false;
            this.coyoteTimer = 0;
            
            this.playAnimation("jump");
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

        const targetY = groundY + this.groundOffset;

        // Basic ground detection based on position vs terrain
        if (this.mesh.position.y <= targetY + 0.02) {
            this.mesh.position.y = targetY;
            this.onGround = true;
            this.isOnGround = true;
            this.verticalVelocity = 0;
            this.isJumping = false;
        } else {
            this.onGround = false;
            this.isOnGround = false;
        }

        // Get camera forward and right vectors (flattened on Y)
        const cameraForward = this.camera.getDirection(new BABYLON.Vector3(0, 0, 1));
        const cameraRight = this.camera.getDirection(new BABYLON.Vector3(1, 0, 0));
        
        const forward = new BABYLON.Vector3(cameraForward.x, 0, cameraForward.z);
        const right = new BABYLON.Vector3(cameraRight.x, 0, cameraRight.z);
        
        forward.normalize();
        right.normalize();

        let moveDir = BABYLON.Vector3.Zero();

        // Keyboard movement
        if (this.input.forward) moveDir.addInPlace(forward);
        if (this.input.backward) moveDir.subtractInPlace(forward);
        if (this.input.right) moveDir.addInPlace(right);
        if (this.input.left) moveDir.subtractInPlace(right);

        // Gamepad movement
        if (this.gamepad.connected) {
            if (Math.abs(this.gamepad.moveY) > 0.01) {
                moveDir.addInPlace(forward.scale(-this.gamepad.moveY));
            }
            if (Math.abs(this.gamepad.moveX) > 0.01) {
                moveDir.addInPlace(right.scale(this.gamepad.moveX));
            }
        }

        const hasMovement = moveDir.lengthSquared() > 0.0001;
        if (hasMovement) {
            moveDir.normalize();
        }

        this.isMoving = hasMovement;
        this.isRunning = this.input.run && hasMovement;

        const speed = this.isRunning ? runSpeed : walkSpeed;

        if (!this._moveLogCount) this._moveLogCount = 0;
        if (this._moveLogCount < 10 && moveDir.lengthSquared() > 0.0001) {
            console.log(`[Player] Movement dir: (${moveDir.x.toFixed(3)}, ${moveDir.y.toFixed(3)}, ${moveDir.z.toFixed(3)}) | speed=${speed.toFixed(3)}`);
            this._moveLogCount++;
        }

        const displacement = hasMovement ? moveDir.scale(speed * dt) : BABYLON.Vector3.Zero();
        displacement.y = this.verticalVelocity * dt;

        const previousPosition = this.mesh.position.clone();
        this.mesh.moveWithCollisions(displacement);

        const moved = this.mesh.position.subtract(previousPosition);
        const flatMovement = new BABYLON.Vector3(moved.x, 0, moved.z);
        if (flatMovement.lengthSquared() > 0.0001) {
            const targetRotation = Math.atan2(flatMovement.x, flatMovement.z) + Math.PI;
            this.lastFacing = targetRotation;
            if (this.visualRoot) {
                this.visualRoot.rotation = new BABYLON.Vector3(0, this.lastFacing, 0);
            }
        }

        // Update camera target
        this.camera.target = new BABYLON.Vector3(
            this.mesh.position.x,
            this.mesh.position.y + 1.0,
            this.mesh.position.z
        );

        // Gamepad camera control (right stick) - inverted
        if (this.camera && this.gamepad.connected) {
            const lookSpeed = 0.08;

            if (Math.abs(this.gamepad.lookX) > 0.001) {
                this.camera.alpha -= this.gamepad.lookX * lookSpeed * dt;
            }

            if (Math.abs(this.gamepad.lookY) > 0.001) {
                this.camera.beta -= this.gamepad.lookY * lookSpeed * dt;
                const minBeta = 0.3;
                const maxBeta = 1.3;
                this.camera.beta = BABYLON.Scalar.Clamp(this.camera.beta, minBeta, maxBeta);
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
