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
        
        // Swimming
        this.isSwimming = false;
        this.swimSpeed = 3.5;          // Swimming speed
        this.swimGravity = -5;         // Reduced gravity in water
        this.buoyancy = 3.0;           // Upward force in water
        this.waterLevel = CONFIG.WORLD.WATER_LEVEL || 0;
        this.waterDrag = 0.95;         // Damping in water

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
        
        // Mobile joystick UI (visible controls for mobile)
        this.mobileUI = {
            enabled: false,
            joystickBase: null,
            joystickStick: null,
            actionButtons: [],
            joystickActive: false,
            joystickRadius: 60,
            joystickMaxDistance: 40
        };
        
        // Detect mobile and create UI
        if (this.isMobile()) {
            this.createMobileUI();
        }
        
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
        // FIX: Increased timeout to 300 attempts (30 seconds)
        const terrain = await this.waitForTerrain(300); 
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
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, this.colliderHeight / 2, 0);

        this.physicsReady = true; // Allow update to run immediately

        console.log(`[Player] ✓ Player collider created at (${this.mesh.position.x}, ${this.mesh.position.y.toFixed(2)}, ${this.mesh.position.z})`);
    }
    
    async loadCharacterModel() {
        if (!window.ASSET_PATHS || !window.ASSET_PATHS.PLAYER_MODELS) {
            console.warn('[Player] ASSET_PATHS not found, skipping character model');
            return;
        }
        
        const modelPath = ASSET_PATHS.getPlayerPath('knight');
        if (!modelPath) {
            console.warn('[Player] Knight model path not found');
            return;
        }
        
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
            const offset = { x: 0, y: -0.9, z: 0 };  // Standard knight offset
            this.characterModel.position = new BABYLON.Vector3(offset.x, offset.y, offset.z);
            
            // NOTE: Don't rotate character model here - we rotate the parent mesh instead
            // If your model faces backward by default, add Math.PI to mesh rotation in update()
            
            // Apply default scale
            const scale = 1.0;
            this.characterModel.scaling = new BABYLON.Vector3(scale, scale, scale);
            
            // Make sure ALL child meshes are visible and don't have physics
            result.meshes.forEach((mesh, index) => {
                if (!mesh) return;
                
                // Hide debug/collision meshes by name
                const name = (mesh.name || '').toLowerCase();
                if (name.includes('collision') || 
                    name.includes('collider') || 
                    name.includes('hitbox') ||
                    name.includes('debug') ||
                    name.includes('physics') ||
                    name.includes('primitive') ||
                    name.includes('helper') ||
                    name.includes('gizmo')) {
                    mesh.isVisible = false;
                    mesh.isPickable = false;
                    mesh.setEnabled(false);
                    console.log(`[Player] Hiding debug mesh: ${mesh.name}`);
                    return; // Skip further processing
                }
                
                // Turn off ALL debug rendering
                mesh.showBoundingBox = false;
                mesh.showSubMeshesBoundingBox = false;
                mesh.renderOutline = false;
                mesh.renderOverlay = false;
                
                if (mesh.ellipsoid) {
                    mesh.showEllipsoid = false;
                }
                
                // Hide any wireframe
                if (mesh.material) {
                    mesh.material.wireframe = false;
                }
                
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
                
                // Map animations by name
                result.animationGroups.forEach(anim => {
                    const name = anim.name.toLowerCase();
                    if (name.includes('idle')) {
                        this.animations.idle = anim;
                    } else if (name.includes('walk')) {
                        this.animations.walk = anim;
                    } else if (name.includes('run')) {
                        this.animations.run = anim;
                    } else if (name.includes('jump')) {
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
        // PATCH: Prevent mobile scrolling
        if (canvas) {
            canvas.style.touchAction = "none";
            canvas.style.outline = "none";
        }

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
                
                // E key - Interact/Confirm (open target menu / execute menu action)
                case 'e':
                    if (isDown && !this._eKeyWasPressed) {
                        this.handleConfirm();
                        this._eKeyWasPressed = true;
                    }
                    if (!isDown) {
                        this._eKeyWasPressed = false;
                    }
                    break;
                
                // Escape key - Cancel/Close menu
                case 'escape':
                    if (isDown && !this._escapeKeyWasPressed) {
                        this.handleCancel();
                        this._escapeKeyWasPressed = true;
                    }
                    if (!isDown) {
                        this._escapeKeyWasPressed = false;
                    }
                    break;
                
                // Ability hotkeys
                case '1':
                case '2':
                case '3':
                case '4':
                case '5':
                    if (isDown) {
                        this.useAbility(key);
                    }
                    break;
                
                // Music toggle (M key)
                case 'm':
                    if (isDown) {
                        const game = this.scene.game;
                        if (game && game.toggleMusic) {
                            game.toggleMusic();
                        }
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

        // Movement joystick (bottom left)
        let moveTouchId = null;
        let moveStartX = 0;
        let moveStartY = 0;

        // Camera look (bottom right)
        let lookTouchId = null;
        let lookLastX = 0;
        let lookLastY = 0;

        const DEADZONE = 20;
        const RUNZONE  = 80;
        const CAMERA_SENSITIVITY = 0.003;

        // Define invisible touch zones
        const ZONE_HEIGHT = window.innerHeight * 0.4; // Bottom 40% of screen
        const ZONE_Y_START = window.innerHeight - ZONE_HEIGHT;
        
        const isInMoveZone = (x, y) => {
            return x < window.innerWidth * 0.5 && y > ZONE_Y_START;
        };
        
        const isInLookZone = (x, y) => {
            return x >= window.innerWidth * 0.5 && y > ZONE_Y_START;
        };

        const resetDirections = () => {
            this.input.forward  = false;
            this.input.backward = false;
            this.input.left     = false;
            this.input.right    = false;
            this.input.run      = false;
        };

        const updateMoveFromTouch = (x, y) => {
            const dx = x - moveStartX;
            const dy = y - moveStartY;

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

        const updateLookFromTouch = (x, y) => {
            if (lookLastX === 0 && lookLastY === 0) {
                lookLastX = x;
                lookLastY = y;
                return;
            }

            const dx = x - lookLastX;
            const dy = y - lookLastY;

            // Rotate camera horizontally
            if (this.camera) {
                this.camera.alpha -= dx * CAMERA_SENSITIVITY;
                
                // Adjust vertical angle (beta) with limits
                const newBeta = this.camera.beta - dy * CAMERA_SENSITIVITY;
                this.camera.beta = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, newBeta));
            }

            lookLastX = x;
            lookLastY = y;
        };

        const onTouchStart = (evt) => {
            if (!evt.changedTouches || evt.changedTouches.length === 0) return;

            for (let i = 0; i < evt.changedTouches.length; i++) {
                const t = evt.changedTouches[i];
                const x = t.clientX;
                const y = t.clientY;

                // Check if in movement zone (bottom left)
                if (isInMoveZone(x, y) && moveTouchId === null) {
                    moveTouchId = t.identifier;
                    moveStartX = x;
                    moveStartY = y;
                    updateMoveFromTouch(x, y);
                }
                // Check if in look zone (bottom right)
                else if (isInLookZone(x, y) && lookTouchId === null) {
                    lookTouchId = t.identifier;
                    lookLastX = x;
                    lookLastY = y;
                }
            }

            evt.preventDefault();
        };

        const onTouchMove = (evt) => {
            if (!evt.changedTouches) return;

            for (let i = 0; i < evt.changedTouches.length; i++) {
                const t = evt.changedTouches[i];
                
                // Update movement
                if (t.identifier === moveTouchId) {
                    updateMoveFromTouch(t.clientX, t.clientY);
                }
                // Update camera look
                else if (t.identifier === lookTouchId) {
                    updateLookFromTouch(t.clientX, t.clientY);
                }
            }

            evt.preventDefault();
        };

        const onTouchEnd = (evt) => {
            if (!evt.changedTouches) return;

            for (let i = 0; i < evt.changedTouches.length; i++) {
                const t = evt.changedTouches[i];
                
                // Movement ended
                if (t.identifier === moveTouchId) {
                    moveTouchId = null;
                    resetDirections();
                }
                // Look ended
                else if (t.identifier === lookTouchId) {
                    lookTouchId = null;
                    lookLastX = 0;
                    lookLastY = 0;
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
    
    // Mobile detection
    isMobile() {
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        if (/android/i.test(userAgent)) return true;
        if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) return true;
        if ('ontouchstart' in window && window.innerWidth < 1024) return true;
        return false;
    }
    
    // Create mobile joystick UI
    createMobileUI() {
        const container = document.createElement('div');
        container.id = 'mobileJoystick';
        container.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 80px;
            width: ${this.mobileUI.joystickRadius * 2}px;
            height: ${this.mobileUI.joystickRadius * 2}px;
            z-index: 1000;
            pointer-events: auto;
        `;
        
        const base = document.createElement('div');
        base.style.cssText = `
            position: absolute;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.2);
            border: 3px solid rgba(255, 255, 255, 0.4);
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
        `;
        
        const stick = document.createElement('div');
        stick.style.cssText = `
            position: absolute;
            width: 50%;
            height: 50%;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.6);
            border: 2px solid rgba(255, 255, 255, 0.8);
            top: 25%;
            left: 25%;
            transition: all 0.05s;
            box-shadow: 0 0 15px rgba(255, 255, 255, 0.5);
        `;
        
        container.appendChild(base);
        container.appendChild(stick);
        document.body.appendChild(container);
        
        this.mobileUI.joystickBase = base;
        this.mobileUI.joystickStick = stick;
        this.mobileUI.container = container;
        
        this.createActionButtons();
        this.setupJoystickHandlers();
        this.mobileUI.enabled = true;
        
        console.log('[Player] Mobile UI created');
    }
    
    createActionButtons() {
        const container = document.createElement('div');
        container.id = 'mobileActions';
        container.style.cssText = `
            position: fixed;
            bottom: 60px;
            right: 40px;
            z-index: 1000;
        `;
        
        const jumpBtn = this.createButton('↑', 'Jump');
        jumpBtn.style.bottom = '80px';
        jumpBtn.style.right = '0';
        jumpBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.queueJump();
        });
        
        const attackBtn = this.createButton('⚔', 'Attack');
        attackBtn.style.bottom = '0';
        attackBtn.style.right = '0';
        
        container.appendChild(jumpBtn);
        container.appendChild(attackBtn);
        document.body.appendChild(container);
        
        this.mobileUI.actionButtons.push(jumpBtn, attackBtn);
    }
    
    createButton(text, label) {
        const btn = document.createElement('button');
        btn.innerHTML = text;
        btn.title = label;
        btn.style.cssText = `
            position: absolute;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.3);
            border: 3px solid rgba(255, 255, 255, 0.5);
            color: white;
            font-size: 24px;
            font-weight: bold;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
            user-select: none;
            -webkit-user-select: none;
            -webkit-tap-highlight-color: transparent;
        `;
        
        btn.addEventListener('touchstart', () => {
            btn.style.background = 'rgba(255, 255, 255, 0.6)';
            btn.style.transform = 'scale(0.95)';
        });
        
        btn.addEventListener('touchend', () => {
            btn.style.background = 'rgba(255, 255, 255, 0.3)';
            btn.style.transform = 'scale(1)';
        });
        
        return btn;
    }
    
    setupJoystickHandlers() {
        const container = this.mobileUI.container;
        
        container.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length === 0) return;
            
            const touch = e.touches[0];
            this.mobileUI.joystickActive = true;
            
            const rect = container.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            this.updateJoystick(touch.clientX - centerX, touch.clientY - centerY);
        }, { passive: false });
        
        container.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!this.mobileUI.joystickActive || e.touches.length === 0) return;
            
            const touch = e.touches[0];
            const rect = container.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            this.updateJoystick(touch.clientX - centerX, touch.clientY - centerY);
        }, { passive: false });
        
        container.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.mobileUI.joystickActive = false;
            this.mobileUI.joystickStick.style.left = '25%';
            this.mobileUI.joystickStick.style.top = '25%';
            
            this.input.forward = false;
            this.input.backward = false;
            this.input.left = false;
            this.input.right = false;
            this.input.run = false;
        }, { passive: false });
    }
    
    updateJoystick(deltaX, deltaY) {
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const angle = Math.atan2(deltaY, deltaX);
        
        const clampedDistance = Math.min(distance, this.mobileUI.joystickMaxDistance);
        
        const stickX = Math.cos(angle) * clampedDistance;
        const stickY = Math.sin(angle) * clampedDistance;
        
        const percentX = 25 + (stickX / this.mobileUI.joystickRadius) * 50;
        const percentY = 25 + (stickY / this.mobileUI.joystickRadius) * 50;
        
        this.mobileUI.joystickStick.style.left = percentX + '%';
        this.mobileUI.joystickStick.style.top = percentY + '%';
        
        if (distance > 5) {
            const normalizedX = stickX / this.mobileUI.joystickMaxDistance;
            const normalizedY = stickY / this.mobileUI.joystickMaxDistance;
            
            this.input.forward = false;
            this.input.backward = false;
            this.input.left = false;
            this.input.right = false;
            
            if (Math.abs(normalizedY) > 0.2) {
                if (normalizedY < 0) this.input.forward = true;
                else this.input.backward = true;
            }
            
            if (Math.abs(normalizedX) > 0.2) {
                if (normalizedX < 0) this.input.left = true;
                else this.input.right = true;
            }
            
            this.input.run = distance > (this.mobileUI.joystickMaxDistance * 0.7);
        }
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
        
        // Buttons (Xbox controller layout)
        // Y button (3) - Jump
        if (gamepad.buttons[3] && gamepad.buttons[3].pressed) {
            if (!this.jumpHeld) {
                this.queueJump();
            }
            this.jumpHeld = true;
        } else {
            this.releaseJump();
        }
        
        // A button (0) - Confirm/Interact
        if (gamepad.buttons[0] && gamepad.buttons[0].pressed) {
            if (!this.gamepad.aButtonWasPressed) {
                this.handleConfirm();
                this.gamepad.aButtonWasPressed = true;
            }
        } else {
            this.gamepad.aButtonWasPressed = false;
        }
        
        // B button (1) - Cancel/Back or Run (hold)
        const bPressed = gamepad.buttons[1] && gamepad.buttons[1].pressed;
        if (bPressed) {
            if (!this.gamepad.bButtonWasPressed) {
                this.handleCancel();
                this.gamepad.bButtonWasPressed = true;
            }
            this.input.run = true; // Also use as run when held
        } else {
            this.gamepad.bButtonWasPressed = false;
            this.input.run = false;
        }
        
        // X button (2) - Quick action (optional)
        if (gamepad.buttons[2] && gamepad.buttons[2].pressed) {
            if (!this.gamepad.xButtonWasPressed) {
                // Could be used for quick loot or action
                this.gamepad.xButtonWasPressed = true;
            }
        } else {
            this.gamepad.xButtonWasPressed = false;
        }
        
        // Start button (9) - Character Sheet/Inventory
        if (gamepad.buttons[9] && gamepad.buttons[9].pressed) {
            if (!this.gamepad.startButtonWasPressed) {
                this.toggleCharacterSheet();
                this.gamepad.startButtonWasPressed = true;
            }
        } else {
            this.gamepad.startButtonWasPressed = false;
        }
        
        // D-pad for menu navigation OR targeting
        // Check if menu is open
        const menuOpen = this.scene.ui && this.scene.ui.targetMenu && this.scene.ui.targetMenu.isVisible;
        
        // D-pad Up (12) - Navigate menu up OR Target next
        if (gamepad.buttons[12] && gamepad.buttons[12].pressed) {
            if (!this.gamepad.dpadUpWasPressed) {
                if (menuOpen) {
                    this.scene.ui.targetMenu.moveSelection(-1); // Move up in menu
                } else {
                    this.targetNext();
                }
                this.gamepad.dpadUpWasPressed = true;
            }
        } else {
            this.gamepad.dpadUpWasPressed = false;
        }
        
        // D-pad Down (13) - Navigate menu down OR Target previous
        if (gamepad.buttons[13] && gamepad.buttons[13].pressed) {
            if (!this.gamepad.dpadDownWasPressed) {
                if (menuOpen) {
                    this.scene.ui.targetMenu.moveSelection(1); // Move down in menu
                } else {
                    this.targetPrevious();
                }
                this.gamepad.dpadDownWasPressed = true;
            }
        } else {
            this.gamepad.dpadDownWasPressed = false;
        }
        
        // D-pad Left (14) - Cycle targets left (only if menu closed)
        if (gamepad.buttons[14] && gamepad.buttons[14].pressed) {
            if (!this.gamepad.dpadLeftWasPressed && !menuOpen) {
                this.targetPrevious();
                this.gamepad.dpadLeftWasPressed = true;
            }
        } else {
            this.gamepad.dpadLeftWasPressed = false;
        }
        
        // D-pad Right (15) - Cycle targets right (only if menu closed)
        if (gamepad.buttons[15] && gamepad.buttons[15].pressed) {
            if (!this.gamepad.dpadRightWasPressed && !menuOpen) {
                this.targetNext();
                this.gamepad.dpadRightWasPressed = true;
            }
        } else {
            this.gamepad.dpadRightWasPressed = false;
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
            if (this.input.run && this.animations.run && !this.isSwimming) {
                this.playAnimation('run');
            } else if (this.animations.walk) {
                this.playAnimation('walk');
            }
        } else if (this.animations.idle) {
            this.playAnimation('idle');
        }

        // CHECK IF IN WATER (check head position)
        const headY = this.mesh.position.y + (this.colliderHeight / 4); // Upper part of body
        const wasSwimming = this.isSwimming;
        this.isSwimming = headY < this.waterLevel;
        
        // Log swimming state changes
        if (this.isSwimming && !wasSwimming) {
            console.log('[Player] Entered water - swimming');
        } else if (!this.isSwimming && wasSwimming) {
            console.log('[Player] Exited water - walking');
        }

        // GRAVITY / BUOYANCY
        if (this.isSwimming) {
            // Swimming physics - buoyancy and reduced gravity
            this.verticalVelocity += this.swimGravity * dt;
            
            // Apply buoyancy force to float toward surface
            if (headY < this.waterLevel) {
                this.verticalVelocity += this.buoyancy * dt;
            }
            
            // Water drag
            this.verticalVelocity *= this.waterDrag;
            
            // Allow swimming up/down with jump/crouch
            if (this.input.jump) {
                this.verticalVelocity = Math.min(this.verticalVelocity + 5 * dt, 3);
            }
            // Note: Add crouch key if you want to swim down
            
        } else {
            // Normal gravity
            if (!this.onGround) {
                this.verticalVelocity += this.gravity * dt;
            } else {
                this.verticalVelocity = 0;
                this._gravityLogCount = 0; // Reset counter when on ground
            }
        }

        // JUMP (only works on ground, not while swimming)
        if (this.jumpQueued && this.onGround && !this.isSwimming) {
            this.verticalVelocity = jumpSpeed;
            this.onGround = false;
            this.isOnGround = false; // For UI
            this.jumpQueued = false;
            console.log('[Player] JUMP! verticalVel=' + this.verticalVelocity);
        }

        // Combine horizontal + vertical displacement
        const speed = this.isSwimming ? this.swimSpeed : (this.input.run ? runSpeed : walkSpeed);
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
        if (!this.onGround && !this.isSwimming && (!this._gravityLogCount || this._gravityLogCount < 10)) {
            if (!this._gravityLogCount) this._gravityLogCount = 0;
            console.log(`[Player] IN AIR: verticalVel=${this.verticalVelocity.toFixed(3)}, y=${this.mesh.position.y.toFixed(2)}`);
            this._gravityLogCount++;
        }

        // GROUND CHECK - Skip if swimming
        if (this.isSwimming) {
            this.onGround = false;
            this.isOnGround = false;
        } else {
            // Direct terrain height query (NO RAYCASTING!)
            let groundY = 0;
            const prevY = previousPosition.y;

            // Determine terrain height under the player using fixed World method
            if (this.scene.world && typeof this.scene.world.getTerrainHeight === 'function') {
                groundY = this.scene.world.getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
            } else {
                // Fallback: assume flat ground at y=0
                groundY = 0;
            }

            const desiredY = groundY + this.groundOffset;
            const distanceToGround = this.mesh.position.y - desiredY;

            // Start by assuming we're in the air
            let grounded = false;

            // 1) Direct contact or slight penetration → snap to ground
            if (distanceToGround <= 0.02) {
                this.mesh.position.y = desiredY;
                grounded = true;
            }
            // 2) moveWithCollisions blocked vertical motion while we were falling
            else if (this.mesh.position.y === prevY && this.verticalVelocity <= 0) {
                this.mesh.position.y = desiredY;
                grounded = true;
            }
            // 3) Slope-hover correction: very close to the ground and almost not moving vertically
            else if (distanceToGround > 0 && distanceToGround < 0.15 && this.verticalVelocity <= 0.1) {
                this.mesh.position.y = desiredY;
                grounded = true;
            }

            if (grounded) {
                this.onGround = true;
                this.isOnGround = true; // For UI
                this.verticalVelocity = 0;
            } else {
                this.onGround = false;
                this.isOnGround = false; // For UI
            }

            // Prevent upward velocity from persisting while grounded
            if (this.onGround && this.verticalVelocity > 0) {
                this.verticalVelocity = 0;
            }
        } // End of swimming check
        
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
            
            this.verticalVelocity = 0;
            this.onGround = true;
            this.isOnGround = true; // For UI
        }

        // Layer 2: Emergency reset (y < -1)
        // If somehow fell completely through everything
        if (this.mesh.position.y < -1) {
            console.warn('[Player] Emergency reset!');
            this.mesh.position.y = 20;

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
        this.targetHighlight.position.y = this.currentTarget.position.y + 0.1; // Just above target's feet
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
            this.targetHighlight.position.y = this.currentTarget.position.y + 0.1;
            this.targetHighlight.position.z = this.currentTarget.position.z;
        });
    }
    
    // Handle mouse click targeting
    handlePointerDown(pickInfo) {
        if (!pickInfo.hit) return;
        
        const mesh = pickInfo.pickedMesh;
        if (!mesh || !mesh.metadata) return;
        
        // Check if clicked mesh is targetable entity
        if (mesh.metadata.isEnemy || mesh.metadata.isNPC) {
            // Find the actual entity from the mesh
            const entity = this.findEntityFromMesh(mesh);
            if (entity && this.scene.combat) {
                this.scene.combat.setTarget(entity);
            }
        }
    }
    
    findEntityFromMesh(mesh) {
        // Search world for ANY entity with this mesh (enemies AND NPCs)
        if (this.scene.world) {
            // Check enemies first
            for (const enemy of this.scene.world.enemies) {
                if (enemy.mesh === mesh || (enemy.mesh && enemy.mesh.getChildMeshes().includes(mesh))) {
                    return enemy;
                }
            }
            // Also check NPCs (can target but not attack)
            for (const npc of this.scene.world.npcs) {
                if (npc.mesh === mesh || (npc.mesh && npc.mesh.getChildMeshes().includes(mesh))) {
                    return npc;
                }
            }
        }
        return null;
    }
    
    // Use ability (called by hotkey)
    useAbility(key) {
        if (!this.scene.combat) return;
        
        // Map number keys to abilities
        const abilityMap = {
            '1': 'powerStrike', // Or 'fireball' for mage
            '2': 'cleave',
            '3': 'heal',
            '4': null,
            '5': null
        };
        
        const abilityKey = abilityMap[key];
        if (abilityKey) {
            this.scene.combat.useAbility(this, abilityKey);
        }
    }
    
    // Target next enemy (Tab key or D-pad) - WoW/FFXI style
    targetNext() {
        if (!this.scene.combat || !this.scene.world) return;
        
        // Get all targetable entities (enemies AND NPCs)
        const allEntities = [
            ...this.scene.world.enemies.filter(e => e.isAlive && e.mesh),
            ...this.scene.world.npcs.filter(n => n.isAlive && n.mesh)
        ];
        
        if (allEntities.length === 0) return;
        
        // Get camera forward direction
        const camera = this.scene.activeCamera;
        const cameraForward = camera.getForwardRay().direction;
        const playerPos = this.mesh.position;
        
        // Filter to entities in front of camera and sort by distance
        const entitiesInFront = allEntities
            .map(entity => {
                const entityPos = entity.mesh.position;
                const toEntity = entityPos.subtract(playerPos);
                const distance = toEntity.length();
                
                // Normalize direction to entity
                const directionToEntity = toEntity.normalize();
                
                // Dot product with camera forward (1 = directly ahead, -1 = behind)
                const dotProduct = BABYLON.Vector3.Dot(cameraForward, directionToEntity);
                
                return {
                    entity: entity,
                    distance: distance,
                    dotProduct: dotProduct
                };
            })
            .filter(item => item.dotProduct > 0.3) // Only entities in front (roughly 70 degree cone)
            .sort((a, b) => {
                // Sort by distance (closest first)
                return a.distance - b.distance;
            });
        
        if (entitiesInFront.length === 0) {
            // No entities in front, just use all entities sorted by distance
            const sortedAll = allEntities
                .map(entity => {
                    const distance = entity.mesh.position.subtract(playerPos).length();
                    return { entity: entity, distance: distance };
                })
                .sort((a, b) => a.distance - b.distance);
            
            this.scene.combat.setTarget(sortedAll[0].entity);
            return;
        }
        
        // Find current target in the list
        const currentTarget = this.scene.combat.currentTarget;
        let currentIndex = -1;
        
        if (currentTarget) {
            currentIndex = entitiesInFront.findIndex(item => item.entity.id === currentTarget.id);
        }
        
        // Get next target (wrap around)
        const nextIndex = (currentIndex + 1) % entitiesInFront.length;
        this.scene.combat.setTarget(entitiesInFront[nextIndex].entity);
    }
    
    // Target previous entity (camera-aware)
    targetPrevious() {
        if (!this.scene.combat || !this.scene.world) return;
        
        // Get all targetable entities (enemies AND NPCs)
        const allEntities = [
            ...this.scene.world.enemies.filter(e => e.isAlive && e.mesh),
            ...this.scene.world.npcs.filter(n => n.isAlive && n.mesh)
        ];
        
        if (allEntities.length === 0) return;
        
        // Get camera forward direction
        const camera = this.scene.activeCamera;
        const cameraForward = camera.getForwardRay().direction;
        const playerPos = this.mesh.position;
        
        // Filter to entities in front of camera and sort by distance
        const entitiesInFront = allEntities
            .map(entity => {
                const entityPos = entity.mesh.position;
                const toEntity = entityPos.subtract(playerPos);
                const distance = toEntity.length();
                const directionToEntity = toEntity.normalize();
                const dotProduct = BABYLON.Vector3.Dot(cameraForward, directionToEntity);
                
                return {
                    entity: entity,
                    distance: distance,
                    dotProduct: dotProduct
                };
            })
            .filter(item => item.dotProduct > 0.3) // Only entities in front
            .sort((a, b) => a.distance - b.distance);
        
        if (entitiesInFront.length === 0) {
            // No entities in front, just use all entities sorted by distance
            const sortedAll = allEntities
                .map(entity => {
                    const distance = entity.mesh.position.subtract(playerPos).length();
                    return { entity: entity, distance: distance };
                })
                .sort((a, b) => a.distance - b.distance);
            
            this.scene.combat.setTarget(sortedAll[0].entity);
            return;
        }
        
        // Find current target in the list
        const currentTarget = this.scene.combat.currentTarget;
        let currentIndex = -1;
        
        if (currentTarget) {
            currentIndex = entitiesInFront.findIndex(item => item.entity.id === currentTarget.id);
        }
        
        // Get previous target (wrap around)
        const prevIndex = currentIndex <= 0 ? entitiesInFront.length - 1 : currentIndex - 1;
        this.scene.combat.setTarget(entitiesInFront[prevIndex].entity);
    }
    
    // Handle A button confirm
    handleConfirm() {
        // Safety check - ensure UI exists
        if (!this.scene.ui) return;
        
        // If target menu is open, execute selected action
        if (this.scene.ui.targetMenu && this.scene.ui.targetMenu.isVisible) {
            this.scene.ui.targetMenu.executeSelected();
        }
        // If target exists but menu not open, open menu (WoW/FFXI style)
        else if (this.scene.combat && this.scene.combat.currentTarget) {
            if (!this.scene.ui.targetMenu) {
                this.scene.ui.createTargetMenu();
            }
            this.scene.ui.targetMenu.show(this.scene.combat.currentTarget);
        }
    }
    
    // Handle B button cancel
    handleCancel() {
        // Close target menu AND clear target
        if (this.scene.ui && this.scene.ui.targetMenu && this.scene.ui.targetMenu.isVisible) {
            this.scene.ui.targetMenu.hide();
            // Also clear the target
            if (this.scene.combat && this.scene.combat.currentTarget) {
                this.scene.combat.setTarget(null);
            }
        }
        // If menu already closed, just clear target
        else if (this.scene.combat && this.scene.combat.currentTarget) {
            this.scene.combat.setTarget(null);
        }
    }
    
    // Open context menu for current target
    openTargetMenu() {
        if (!this.scene.ui || !this.scene.combat || !this.scene.combat.currentTarget) return;
        
        const target = this.scene.combat.currentTarget;
        
        // Create menu if it doesn't exist
        if (!this.scene.ui.targetMenu) {
            this.scene.ui.createTargetMenu();
        }
        
        // Show menu with appropriate options
        this.scene.ui.targetMenu.show(target);
    }
    
    // Toggle character sheet/inventory (Start button)
    toggleCharacterSheet() {
        if (this.inventory) {
            this.inventory.toggleInventory();
        } else if (this.scene.ui) {
            // Fallback: just log for now
            console.log('[Player] Character sheet opened (inventory system not found)');
        }
    }
    
    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
        }
        if (this.camera) {
            this.camera.dispose();
        }
        
        // Dispose mobile UI
        if (this.mobileUI.container) {
            this.mobileUI.container.remove();
        }
        if (document.getElementById('mobileActions')) {
            document.getElementById('mobileActions').remove();
        }
    }
}

// Export for use in game.js
window.Player = Player;
console.log('[Player] Player class loaded');
