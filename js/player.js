// Player class - CLEAN REWRITE
class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.camera = null;
        this.characterModel = null;
        
        // Movement speeds (direct movement - no physics)
        this.speed = 0.4;              // Base walk speed (increased from 0.25)
        this.runMultiplier = 2.5;      // Run multiplier
        this.jumpForce = 0.5;          // Jump initial velocity
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
        let spawnY = 1; // Fallback if world not ready
        
        if (world && typeof world.getTerrainHeight === 'function') {
            const groundY = world.getTerrainHeight(0, 0);
            spawnY = groundY + 1; // Just 1 unit above ground
            console.log(`[Player] Ground at y=${groundY.toFixed(2)}, spawning at y=${spawnY.toFixed(2)}`);
        } else {
            console.warn('[Player] Could not get terrain height, using fallback spawn y=1');
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
                this.mesh.position.y = groundY + 0.5;
                this.onGround = true;
                this.verticalVelocity = 0;
                console.log(`[Player] ✓ Snapped to ground at y=${this.mesh.position.y.toFixed(2)}`);
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
        // Create TINY invisible point (just for position reference)
        this.mesh = BABYLON.MeshBuilder.CreateBox('player', {
            width: 0.01,   // TINY
            height: 0.01,
            depth: 0.01
        }, this.scene);
        
        // Spawn at exact position (no extra offset)
        this.mesh.position = new BABYLON.Vector3(0, spawnY, 0);
        
        // MAKE COMPLETELY INVISIBLE - MULTIPLE METHODS
        this.mesh.visibility = 0;
        this.mesh.isVisible = false;
        this.mesh.isPickable = false;
        this.mesh.renderingGroupId = -1; // Don't render at all
        
        // NO PHYSICS! Just use direct movement
        this.physicsReady = true; // Allow update to run immediately
        
        console.log(`[Player] ✓ Player anchor created at (${this.mesh.position.x}, ${this.mesh.position.y.toFixed(2)}, ${this.mesh.position.z}) - NO PHYSICS MODE`);
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

        const DEADZONE = 20;  // px before we consider it a direction
        const RUNZONE  = 80;  // px distance to toggle run

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

            // Vertical: up = forward, down = backward (non-inverted)
            if (absDy > DEADZONE) {
                if (dy < 0) this.input.forward = true;   // finger up
                else        this.input.backward = true;  // finger down
            }

            // Horizontal: left / right
            if (absDx > DEADZONE) {
                if (dx < 0) this.input.left = true;
                else        this.input.right = true;
            }

            // Run when dragging far enough
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
                    // Left side => joystick
                    if (joystickTouchId === null) {
                        joystickTouchId = t.identifier;
                        joystickStartX = x;
                        joystickStartY = y;
                        updateFromTouch(x, y);
                    }
                } else {
                    // Right side tap => jump
                    this.input.jump = true;
                    // Small pulse so jump is consumed once
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
    }
    
    update(deltaTime) {
        if (!this.mesh || !this.physicsReady) return;
        
        // Update gamepad state
        this.updateGamepad();
        
        // deltaTime comes in as SECONDS from game.js; convert to a 60fps-normalized dt
        const targetFps =
            (window.CONFIG && window.CONFIG.GAME && window.CONFIG.GAME.FPS)
                ? window.CONFIG.GAME.FPS
                : 60;
        const dt = deltaTime * targetFps;
        
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
        
        // Gamepad input
        if (this.gamepad.connected) {
            const gamepadMove = forward.scale(-this.gamepad.moveY).add(right.scale(this.gamepad.moveX));
            moveDir.addInPlace(gamepadMove);
        }
        
        // DIRECT MOVEMENT - NO PHYSICS
        if (moveDir.lengthSquared() > 0) {
            moveDir.normalize();
            
            const speed = this.input.run ? this.speed * this.runMultiplier : this.speed;
            const velocity = moveDir.scale(speed * dt);
            
            // Move directly
            this.mesh.position.addInPlace(velocity);
            
            // Rotate to face movement
            const targetRotation = Math.atan2(moveDir.x, moveDir.z);
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
        
        // GRAVITY - Apply downward force
        if (!this.onGround) {
            this.verticalVelocity -= 0.8 * dt; // Gravity acceleration
        } else {
            this.verticalVelocity = 0;
        }
        
        // Apply vertical velocity
        this.mesh.position.y += this.verticalVelocity * dt;
        
        // JUMP
        if (this.input.jump && this.onGround) {
            this.verticalVelocity = this.jumpForce;
            this.onGround = false;
            this.input.jump = false;
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
            if (this.mesh.position.y <= groundY + 0.5) {
                this.mesh.position.y = groundY + 0.5; // 0.5 units above ground
                this.onGround = true;
                this.verticalVelocity = 0;
            } else {
                this.onGround = false;
            }
        } else {
            // Fallback: assume flat ground at y=0
            if (this._groundCheckCount === undefined) {
                console.warn('[Player] World.getTerrainHeight not available, using y=0 fallback');
                this._groundCheckCount = 0;
            }
            
            if (this.mesh.position.y <= 0.5) {
                this.mesh.position.y = 0.5;
                this.onGround = true;
                this.verticalVelocity = 0;
            } else {
                this.onGround = false;
            }
        }
        
        // Safety check - if somehow still falling, reset
        if (this.mesh.position.y < -10) {
            console.warn('[Player] Emergency reset!');
            this.mesh.position.y = 20;
            this.verticalVelocity = 0;
            this.onGround = false;
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
