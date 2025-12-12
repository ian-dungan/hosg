// Player class - IMPROVED PHYSICS & MOVEMENT v2.0
class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.camera = null;
        this.characterModel = null;
        
        // Movement configuration
        this.walkSpeed = 5.0;           // Units per second
        this.runSpeed = 10.0;           // Units per second when running
        this.jumpVelocity = 8.0;        // Upward velocity for jump
        this.rotationSpeed = 8.0;       // How fast to rotate toward movement direction
        
        // Collider dimensions
        this.colliderHeight = 1.8;
        this.colliderRadius = 0.4;
        this.groundOffset = this.colliderHeight / 2;
        
        // Input state
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            run: false,
            jump: false,
            jumpPressed: false  // For single jump detection
        };
        
        // Gamepad state
        this.gamepad = {
            connected: false,
            moveX: 0,
            moveY: 0,
            lookX: 0,
            lookY: 0
        };
        
        // Movement state
        this.isGrounded = false;        // Are we on the ground?
        this.coyoteTime = 0;            // Grace period after leaving ground
        this.coyoteTimeMax = 0.1;       // 100ms grace period
        this.groundCheckDistance = 0.2; // How far to raycast for ground
        
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
        
        // For UI compatibility
        this.onGround = true;
        this.isOnGround = true;
        
        console.log('[Player] Player created');
    }
    
    async init() {
        console.log('[Player] Waiting for terrain to be ready...');
        
        // Wait for terrain
        const terrain = await this.waitForTerrain(100);
        if (!terrain) {
            console.error('[Player] Terrain timeout - creating player at y=10');
            this.createPlayerMesh(10);
            await this.loadCharacterModel();
            this.setupCamera();
            this.setupInput();
            this.setupGamepad();
            return;
        }
        
        console.log('[Player] ✓ Terrain ready, creating player...');
        
        // Get spawn height from terrain
        const world = this.scene.game?.world;
        let spawnY = this.groundOffset + 0.5;
        
        if (world && typeof world.getTerrainHeight === 'function') {
            const groundY = world.getTerrainHeight(0, 0);
            spawnY = groundY + this.groundOffset + 0.2;
            console.log(`[Player] Spawning at y=${spawnY.toFixed(2)}`);
        }
        
        this.createPlayerMesh(spawnY);
        await this.loadCharacterModel();
        this.setupCamera();
        this.setupInput();
        this.setupGamepad();
        
        // Initial ground snap
        setTimeout(() => {
            if (this.scene.world && typeof this.scene.world.getTerrainHeight === 'function') {
                const groundY = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
                this.mesh.position.y = groundY + this.groundOffset;
                this.isGrounded = true;
                console.log(`[Player] ✓ Snapped to ground`);
            }
        }, 100);
        
        console.log('[Player] ✓ Player initialized');
    }
    
    async waitForTerrain(maxAttempts) {
        for (let i = 0; i < maxAttempts; i++) {
            const terrain = this.scene.getMeshByName('terrain');
            if (terrain && terrain.isEnabled() && terrain.physicsImpostor) {
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
        // Create invisible capsule collider
        this.mesh = BABYLON.MeshBuilder.CreateBox('player', {
            width: this.colliderRadius * 2,
            height: this.colliderHeight,
            depth: this.colliderRadius * 2
        }, this.scene);
        
        this.mesh.position = new BABYLON.Vector3(0, spawnY, 0);
        this.mesh.visibility = 0;
        this.mesh.isVisible = false;
        this.mesh.isPickable = false;
        
        // Setup physics with proper settings for smooth movement
        if (this.scene.getPhysicsEngine()) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh,
                BABYLON.PhysicsImpostor.BoxImpostor,
                {
                    mass: 80,
                    friction: 0.0,      // No friction - we handle movement manually
                    restitution: 0.0    // No bouncing
                },
                this.scene
            );
            
            const impostor = this.mesh.physicsImpostor;
            
            // Lock rotation so player doesn't tip over
            if (impostor.physicsBody) {
                impostor.physicsBody.fixedRotation = true;
                impostor.physicsBody.updateMassProperties();
                impostor.physicsBody.linearDamping = 0.9;   // High damping for precise control
                impostor.physicsBody.angularDamping = 0.99;
            }
            
            console.log('[Player] ✓ Physics body created');
        }
        
        console.log(`[Player] ✓ Player collider created at y=${this.mesh.position.y.toFixed(2)}`);
    }
    
    async loadCharacterModel() {
        if (!window.ASSET_MANIFEST || !window.ASSET_MANIFEST.CHARACTERS) {
            console.warn('[Player] No character model assets available');
            return;
        }
        
        const knightData = ASSET_MANIFEST.CHARACTERS.PLAYER.knight;
        if (!knightData) {
            console.warn('[Player] Knight model data not found');
            return;
        }
        
        try {
            const assetLoader = new window.AssetLoader(this.scene);
            const modelInstance = await assetLoader.loadModel(knightData.model, {
                position: this.mesh.position.clone(),
                scaling: new BABYLON.Vector3(knightData.scale, knightData.scale, knightData.scale)
            });
            
            if (modelInstance && modelInstance.root) {
                this.characterModel = modelInstance.root;
                this.characterModel.parent = this.mesh;
                
                // Apply offset
                if (knightData.offset) {
                    this.characterModel.position = new BABYLON.Vector3(
                        knightData.offset.x,
                        knightData.offset.y,
                        knightData.offset.z
                    );
                }
                
                // Setup animations
                if (modelInstance.animationGroups && modelInstance.animationGroups.length > 0) {
                    for (const ag of modelInstance.animationGroups) {
                        const name = ag.name.toLowerCase();
                        if (name.includes('idle')) this.animations.idle = ag;
                        else if (name.includes('walk')) this.animations.walk = ag;
                        else if (name.includes('run')) this.animations.run = ag;
                        else if (name.includes('jump')) this.animations.jump = ag;
                    }
                    
                    // Start with idle
                    if (this.animations.idle) {
                        this.playAnimation('idle');
                    }
                }
                
                console.log('[Player] ✓ Character model loaded');
            }
        } catch (err) {
            console.error('[Player] Failed to load character model:', err);
        }
    }
    
    setupCamera() {
        this.camera = new BABYLON.ArcRotateCamera(
            'playerCamera',
            -Math.PI / 2,
            Math.PI / 3,
            15,
            this.mesh.position,
            this.scene
        );
        
        this.camera.lowerRadiusLimit = 5;
        this.camera.upperRadiusLimit = 30;
        this.camera.lowerBetaLimit = 0.2;
        this.camera.upperBetaLimit = Math.PI / 2 - 0.1;
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
        this.camera.inputs.attached.mousewheel.wheelPrecision = 50;
        
        this.scene.activeCamera = this.camera;
        console.log('[Player] ✓ Camera setup complete');
    }
    
    setupInput() {
        this.scene.onKeyboardObservable.add((kbInfo) => {
            const isDown = (kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN);
            
            switch (kbInfo.event.key.toLowerCase()) {
                case 'w': this.input.forward = isDown; break;
                case 's': this.input.backward = isDown; break;
                case 'a': this.input.left = isDown; break;
                case 'd': this.input.right = isDown; break;
                case 'shift': this.input.run = isDown; break;
                case ' ':
                    if (isDown && !this.input.jumpPressed) {
                        this.input.jump = true;
                        this.input.jumpPressed = true;
                    } else if (!isDown) {
                        this.input.jumpPressed = false;
                    }
                    break;
                case 'tab':
                    if (isDown) {
                        kbInfo.event.preventDefault();
                        this.targetNext();
                    }
                    break;
                case 'escape':
                    if (isDown) {
                        this.clearTarget();
                    }
                    break;
            }
        });
        
        // Mouse click targeting
        this.scene.onPointerDown = (evt, pickInfo) => {
            this.handlePointerDown(pickInfo);
        };
        
        console.log('[Player] ✓ Keyboard input setup');
    }
    
    setupGamepad() {
        const gamepadManager = new BABYLON.GamepadManager();
        
        gamepadManager.onGamepadConnectedObservable.add((gamepad) => {
            console.log('[Player] Gamepad connected:', gamepad.id);
            this.gamepad.connected = true;
            
            gamepad.onleftstickchanged((values) => {
                this.gamepad.moveX = Math.abs(values.x) > 0.15 ? values.x : 0;
                this.gamepad.moveY = Math.abs(values.y) > 0.15 ? -values.y : 0;
            });
            
            gamepad.onrightstickchanged((values) => {
                this.gamepad.lookX = Math.abs(values.x) > 0.15 ? values.x : 0;
                this.gamepad.lookY = Math.abs(values.y) > 0.15 ? values.y : 0;
            });
            
            gamepad.onbuttondown((button) => {
                if (button === BABYLON.Xbox360Button.A && !this.input.jumpPressed) {
                    this.input.jump = true;
                    this.input.jumpPressed = true;
                }
            });
            
            gamepad.onbuttonup((button) => {
                if (button === BABYLON.Xbox360Button.A) {
                    this.input.jumpPressed = false;
                }
            });
        });
        
        console.log('[Player] ✓ Gamepad support enabled');
    }
    
    playAnimation(name) {
        if (this.currentAnimation === name) return;
        
        // Stop current animation
        if (this.currentAnimation && this.animations[this.currentAnimation]) {
            this.animations[this.currentAnimation].stop();
        }
        
        // Start new animation
        if (this.animations[name]) {
            this.animations[name].start(true, 1.0, 
                this.animations[name].from, 
                this.animations[name].to, 
                false
            );
            this.currentAnimation = name;
        }
    }
    
    checkGrounded() {
        if (!this.scene.world || typeof this.scene.world.getTerrainHeight !== 'function') {
            return false;
        }
        
        // Get terrain height at player position
        const terrainY = this.scene.world.getTerrainHeight(
            this.mesh.position.x,
            this.mesh.position.z
        );
        
        // Calculate distance to ground (from feet position)
        const feetY = this.mesh.position.y - this.groundOffset;
        const distanceToGround = feetY - terrainY;
        
        // We're grounded if within check distance
        return distanceToGround <= this.groundCheckDistance;
    }
    
    update(deltaTime) {
        if (!this.mesh || !this.mesh.physicsImpostor) return;
        
        // ============================================================
        // GROUND DETECTION
        // ============================================================
        const wasGrounded = this.isGrounded;
        this.isGrounded = this.checkGrounded();
        
        // Coyote time - grace period after leaving ground
        if (wasGrounded && !this.isGrounded) {
            this.coyoteTime = this.coyoteTimeMax;
        } else if (this.isGrounded) {
            this.coyoteTime = this.coyoteTimeMax;
        } else {
            this.coyoteTime = Math.max(0, this.coyoteTime - deltaTime);
        }
        
        // Update UI compatibility flags
        this.onGround = this.isGrounded;
        this.isOnGround = this.isGrounded;
        
        // ============================================================
        // MOVEMENT INPUT
        // ============================================================
        let moveX = 0;
        let moveZ = 0;
        
        // Keyboard input
        if (this.input.forward) moveZ += 1;
        if (this.input.backward) moveZ -= 1;
        if (this.input.left) moveX -= 1;
        if (this.input.right) moveX += 1;
        
        // Gamepad input (overrides keyboard if active)
        if (this.gamepad.connected && (Math.abs(this.gamepad.moveX) > 0.001 || Math.abs(this.gamepad.moveY) > 0.001)) {
            moveX = this.gamepad.moveX;
            moveZ = this.gamepad.moveY;
        }
        
        // Normalize diagonal movement
        const moveLength = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (moveLength > 0) {
            moveX /= moveLength;
            moveZ /= moveLength;
        }
        
        // ============================================================
        // MOVEMENT VELOCITY
        // ============================================================
        if (moveLength > 0 && this.camera) {
            // Get camera-relative movement direction
            const cameraForward = this.camera.getForwardRay().direction;
            cameraForward.y = 0;
            cameraForward.normalize();
            
            const cameraRight = BABYLON.Vector3.Cross(cameraForward, BABYLON.Vector3.Up());
            
            // Calculate world-space movement direction
            const moveDirection = cameraForward.scale(moveZ).add(cameraRight.scale(moveX));
            moveDirection.normalize();
            
            // Apply speed
            const speed = this.input.run ? this.runSpeed : this.walkSpeed;
            const targetVelocity = moveDirection.scale(speed);
            
            // Get current velocity
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            
            // Set horizontal velocity (preserve vertical)
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(targetVelocity.x, currentVelocity.y, targetVelocity.z)
            );
            
            // ============================================================
            // ROTATION - Face movement direction
            // ============================================================
            const targetRotation = Math.atan2(moveDirection.x, moveDirection.z);
            const currentRotation = this.mesh.rotation.y;
            
            // Smooth rotation interpolation
            let rotationDiff = targetRotation - currentRotation;
            
            // Handle wrapping (shortest path)
            while (rotationDiff > Math.PI) rotationDiff -= 2 * Math.PI;
            while (rotationDiff < -Math.PI) rotationDiff += 2 * Math.PI;
            
            const newRotation = currentRotation + rotationDiff * this.rotationSpeed * deltaTime;
            this.mesh.rotation.y = newRotation;
            
            // Animation
            if (this.isGrounded) {
                this.playAnimation(this.input.run ? 'run' : 'walk');
            }
        } else {
            // No movement - stop horizontal velocity
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(0, currentVelocity.y, 0)
            );
            
            // Animation
            if (this.isGrounded) {
                this.playAnimation('idle');
            }
        }
        
        // ============================================================
        // JUMP
        // ============================================================
        if (this.input.jump && this.coyoteTime > 0) {
            // Apply jump velocity
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(currentVelocity.x, this.jumpVelocity, currentVelocity.z)
            );
            
            // Consume jump input and coyote time
            this.input.jump = false;
            this.coyoteTime = 0;
            
            // Animation
            this.playAnimation('jump');
            
            console.log('[Player] Jump!');
        }
        
        // Clear jump input if we're falling
        if (!this.isGrounded && this.coyoteTime <= 0) {
            this.input.jump = false;
        }
        
        // ============================================================
        // CAMERA UPDATE
        // ============================================================
        if (this.camera) {
            // Follow player
            this.camera.target = this.mesh.position;
            
            // Gamepad camera control
            if (this.gamepad.connected) {
                const lookSpeed = 2.0;
                if (Math.abs(this.gamepad.lookX) > 0.001) {
                    this.camera.alpha -= this.gamepad.lookX * lookSpeed * deltaTime;
                }
                if (Math.abs(this.gamepad.lookY) > 0.001) {
                    this.camera.beta -= this.gamepad.lookY * lookSpeed * deltaTime;
                    this.camera.beta = Math.max(0.2, Math.min(Math.PI / 2 - 0.1, this.camera.beta));
                }
            }
        }
        
        // ============================================================
        // SAFETY - Prevent falling through terrain
        // ============================================================
        if (this.mesh.position.y < -0.05 && this.scene.world && 
            typeof this.scene.world.getTerrainHeight === 'function') {
            console.warn('[Player] Terrain clip detected! Correcting...');
            
            const groundY = this.scene.world.getTerrainHeight(
                this.mesh.position.x,
                this.mesh.position.z
            );
            
            this.mesh.position.y = groundY + this.groundOffset;
            this.mesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
            
            if (this.mesh.physicsImpostor.physicsBody) {
                const body = this.mesh.physicsImpostor.physicsBody;
                body.position.set(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);
                body.velocity.set(0, 0, 0);
            }
        }
        
        // Emergency reset if fallen way below
        if (this.mesh.position.y < -5) {
            console.warn('[Player] Emergency teleport to spawn!');
            this.mesh.position.set(0, 20, 0);
            this.mesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
        }
    }
    
    // ============================================================
    // TARGETING SYSTEM
    // ============================================================
    targetNext() {
        const targetables = this.scene.meshes.filter(m => 
            m.metadata && (m.metadata.isEnemy || m.metadata.isNPC) && 
            m.metadata.health > 0
        );
        
        if (targetables.length === 0) {
            this.clearTarget();
            return;
        }
        
        let currentIndex = -1;
        if (this.currentTarget) {
            currentIndex = targetables.findIndex(m => m === this.currentTarget);
        }
        
        const nextIndex = (currentIndex + 1) % targetables.length;
        this.setTarget(targetables[nextIndex]);
    }
    
    setTarget(mesh) {
        if (!mesh) {
            this.clearTarget();
            return;
        }
        
        this.currentTarget = mesh;
        this.updateTargetHighlight();
        
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
        
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
            this.targetHighlight = null;
        }
        
        if (this.scene.ui && typeof this.scene.ui.hideTargetInfo === 'function') {
            this.scene.ui.hideTargetInfo();
        }
    }
    
    updateTargetHighlight() {
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
        }
        
        if (!this.currentTarget) return;
        
        this.targetHighlight = BABYLON.MeshBuilder.CreateTorus('targetHighlight', {
            diameter: 3,
            thickness: 0.1,
            tessellation: 32
        }, this.scene);
        
        this.targetHighlight.position = this.currentTarget.position.clone();
        this.targetHighlight.position.y = 0.1;
        this.targetHighlight.rotation.x = Math.PI / 2;
        
        const mat = new BABYLON.StandardMaterial('targetMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        mat.disableLighting = true;
        this.targetHighlight.material = mat;
        
        const startTime = Date.now();
        this.scene.onBeforeRenderObservable.add(() => {
            if (!this.targetHighlight || !this.currentTarget) return;
            const time = (Date.now() - startTime) / 1000;
            this.targetHighlight.scaling.setAll(1 + Math.sin(time * 3) * 0.1);
            this.targetHighlight.position.x = this.currentTarget.position.x;
            this.targetHighlight.position.z = this.currentTarget.position.z;
        });
    }
    
    handlePointerDown(pickInfo) {
        if (!pickInfo.hit) return;
        
        const mesh = pickInfo.pickedMesh;
        if (!mesh || !mesh.metadata) return;
        
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
    }
}

window.Player = Player;
console.log('[Player] Player class loaded v2.0');
