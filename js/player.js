// Player class - CLEAN REWRITE
class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.camera = null;
        this.characterModel = null;
        
        // Movement speeds
        this.speed = 8.0;              // Units per second (was 0.15 - too slow!)
        this.runMultiplier = 2.0;      // Run = 16.0 units/sec
        this.jumpForce = 8.0;          // Jump velocity (was 0.3 - barely jumped!)
        this.rotationSpeed = 0.1;
        
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
        
        // Physics ready flag
        this.physicsReady = false;
        this.onGround = true;
        
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
        
        // Get spawn height from terrain
        const world = this.scene.game?.world;
        let spawnY = 5; // Safe default
        
        if (world && world.getHeightAt) {
            const groundY = world.getHeightAt(0, 0);
            spawnY = groundY + 3; // 3 units above ground
            console.log(`[Player] Ground at y=${groundY.toFixed(2)}, spawning at y=${spawnY.toFixed(2)}`);
        }
        
        // Create player mesh with physics
        this.createPlayerMesh(spawnY);
        
        // Load character model
        await this.loadCharacterModel();
        
        // Setup camera
        this.setupCamera();
        
        // Setup input (keyboard + gamepad)
        this.setupInput();
        this.setupGamepad();
        
        console.log('[Player] ✓ Player initialized and ready');
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
        // Create simple capsule for physics
        this.mesh = BABYLON.MeshBuilder.CreateCapsule('player', {
            radius: 0.5,
            height: 1.8,
            tessellation: 8
        }, this.scene);
        
        this.mesh.position = new BABYLON.Vector3(0, spawnY, 0);
        this.mesh.visibility = 0; // Invisible (character model will be visible)
        
        // CRITICAL: Enable collisions
        this.mesh.checkCollisions = true;
        
        // Create physics impostor with CAPSULE - wait a frame for mesh to be ready
        setTimeout(() => {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh,
                BABYLON.PhysicsImpostor.CapsuleImpostor,
                {
                    mass: 1,
                    friction: 0.5,
                    restitution: 0
                },
                this.scene
            );
            
            // Lock rotation so player doesn't tip over
            const body = this.mesh.physicsImpostor.physicsBody;
            if (body) {
                body.fixedRotation = true;
                body.updateMassProperties();
                this.physicsReady = true;
                console.log(`[Player] ✓ Physics enabled: mass=1, friction=0.5, body ready`);
            } else {
                console.error('[Player] ✗ Physics body is NULL! Using fallback movement');
                this.physicsReady = false;
            }
        }, 100);
        
        console.log(`[Player] ✓ Player mesh created at position (${this.mesh.position.x}, ${this.mesh.position.y.toFixed(2)}, ${this.mesh.position.z})`);
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
            
            // Get root mesh
            this.characterModel = result.meshes[0];
            this.characterModel.parent = this.mesh;
            
            // Apply offset from config
            const offset = characterConfig.offset || { x: 0, y: -0.9, z: 0 };
            this.characterModel.position = new BABYLON.Vector3(offset.x, offset.y, offset.z);
            
            // Apply scale from config
            const scale = characterConfig.scale || 1.0;
            this.characterModel.scaling = new BABYLON.Vector3(scale, scale, scale);
            
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
            console.log('[Player] Continuing with invisible capsule');
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
            
            switch(key) {
                case 'w': this.input.forward = isDown; break;
                case 's': this.input.backward = isDown; break;
                case 'a': this.input.left = isDown; break;
                case 'd': this.input.right = isDown; break;
                case 'shift': this.input.run = isDown; break;
                case ' ': 
                    if (isDown && !this.input.jump) {
                        this.input.jump = true;
                    } else if (!isDown) {
                        this.input.jump = false;
                    }
                    break;
            }
        });
        
        console.log('[Player] ✓ Input setup complete');
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
    }
    
    update(deltaTime) {
        if (!this.mesh) return;
        
        // CRITICAL: Don't run update until physics is initialized
        // The createPlayerMesh setTimeout needs 100ms to complete
        if (!this.physicsReady) {
            // Still show "waiting" message occasionally
            if (!this._waitingLogged) {
                console.log('[Player] Waiting for physics to initialize...');
                this._waitingLogged = true;
            }
            return;
        }
        
        // Update gamepad state
        this.updateGamepad();
        
        const dt = deltaTime * 60; // Scale to 60fps baseline
        
        // Get camera forward/right directions
        const forward = this.camera.getDirection(BABYLON.Axis.Z);
        forward.y = 0;
        forward.normalize();
        
        const right = this.camera.getDirection(BABYLON.Axis.X);
        right.y = 0;
        right.normalize();
        
        // Calculate movement direction from keyboard + gamepad
        let moveDir = BABYLON.Vector3.Zero();
        
        // Keyboard input
        if (this.input.forward) moveDir.addInPlace(forward);
        if (this.input.backward) moveDir.subtractInPlace(forward);
        if (this.input.right) moveDir.addInPlace(right);
        if (this.input.left) moveDir.subtractInPlace(right);
        
        // Gamepad input
        if (this.gamepad.connected) {
            const gamepadMove = forward.scale(-this.gamepad.moveY).add(right.scale(this.gamepad.moveX));
            moveDir.addInPlace(gamepadMove);
        }
        
        // Check if physics is ready and body exists
        const hasPhysics = this.physicsReady && 
                          this.mesh.physicsImpostor && 
                          this.mesh.physicsImpostor.physicsBody;
        
        // Apply movement
        if (moveDir.lengthSquared() > 0) {
            moveDir.normalize();
            
            const speed = this.input.run ? this.speed * this.runMultiplier : this.speed;
            const velocity = moveDir.scale(speed * dt);
            
            if (hasPhysics) {
                // Use physics-based movement
                try {
                    const currentVel = this.mesh.physicsImpostor.getLinearVelocity();
                    this.mesh.physicsImpostor.setLinearVelocity(
                        new BABYLON.Vector3(
                            velocity.x,
                            currentVel.y, // Keep vertical velocity
                            velocity.z
                        )
                    );
                } catch (e) {
                    console.warn('[Player] Physics error, using direct movement:', e.message);
                    this.mesh.position.addInPlace(velocity);
                }
            } else {
                // Fallback: Direct position manipulation
                this.mesh.position.addInPlace(velocity);
                
                // Apply gravity manually
                if (this.mesh.position.y > 0) {
                    this.mesh.position.y -= 0.5 * dt;
                }
                if (this.mesh.position.y < 0) {
                    this.mesh.position.y = 0;
                }
            }
            
            // Rotate player to face movement direction
            const targetRotation = Math.atan2(moveDir.x, moveDir.z);
            this.mesh.rotation.y = targetRotation;
            
            // Play walk/run animation
            if (this.input.run && this.animations.run) {
                this.playAnimation('run');
            } else if (this.animations.walk) {
                this.playAnimation('walk');
            }
        } else {
            // No movement - stop horizontal velocity
            if (hasPhysics) {
                try {
                    const currentVel = this.mesh.physicsImpostor.getLinearVelocity();
                    this.mesh.physicsImpostor.setLinearVelocity(
                        new BABYLON.Vector3(0, currentVel.y, 0)
                    );
                } catch (e) {
                    // Ignore
                }
            }
            
            // Play idle animation
            if (this.animations.idle) {
                this.playAnimation('idle');
            }
        }
        
        // Jump
        if (this.input.jump && this.onGround) {
            if (hasPhysics) {
                try {
                    const currentVel = this.mesh.physicsImpostor.getLinearVelocity();
                    this.mesh.physicsImpostor.setLinearVelocity(
                        new BABYLON.Vector3(currentVel.x, this.jumpForce, currentVel.z)
                    );
                } catch (e) {
                    this.mesh.position.y += 2;
                }
            } else {
                this.mesh.position.y += 2;
            }
            this.onGround = false;
            this.input.jump = false; // Reset jump
        }
        
        // Ground check
        const ray = new BABYLON.Ray(
            this.mesh.position,
            new BABYLON.Vector3(0, -1, 0),
            1.2
        );
        const hit = this.scene.pickWithRay(ray, (mesh) => mesh.name === 'terrain');
        this.onGround = hit && hit.hit;
        
        // Safety check - if falling below world, reset
        if (this.mesh.position.y < -10) {
            console.warn('[Player] Fell through world! Resetting...');
            this.mesh.position = new BABYLON.Vector3(0, 10, 0);
            if (hasPhysics) {
                try {
                    this.mesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
                } catch (e) {
                    // Ignore
                }
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
    }
}

// Export for use in game.js
window.Player = Player;
console.log('[Player] Player class loaded');
