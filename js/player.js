// Player class - CLEAN REWRITE
class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.visualRoot = null; // Rotated visuals attached to collider
        this.camera = null;
        this.characterModel = null;
        this.name = 'Player'; // Used for damage/heal logging
        
        // Movement speeds (units per second)
        this.speed = CONFIG.PLAYER.MOVE_SPEED * 60; // Convert to units/s (assuming default 60FPS)
        this.runMultiplier = CONFIG.PLAYER.RUN_MULTIPLIER;
        this.jumpForce = CONFIG.PLAYER.JUMP_FORCE * 60; // Convert to units/s
        this.gravity = -CONFIG.GAME.GRAVITY; // Gravity acceleration (units/second^2)
        this.rotationSpeed = CONFIG.PLAYER.ROTATION_LERP;

        // Stats
        this.health = CONFIG.PLAYER.HEALTH;
        this.maxHealth = CONFIG.PLAYER.HEALTH;
        this.stamina = CONFIG.PLAYER.STAMINA;
        this.maxStamina = CONFIG.PLAYER.STAMINA;
        this.mana = 100;
        this.maxMana = 100;

        // Inventory
        this.inventory = new Inventory(CONFIG.PLAYER.INVENTORY_SIZE);
        
        // Collider dimensions (used for physics + ground detection)
        this.colliderHeight = 1.8;
        this.colliderRadius = 0.4;
        this.groundOffset = this.colliderHeight / 2; // Distance from center to feet
        
        // Physics state
        this.isGrounded = false;
        this.velocity = BABYLON.Vector3.Zero();
        
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
            lookY: 0,
            jump: false
        };
        
        // Animation state
        this.animations = {};
        this.currentAnimation = null;

        // Combat state
        this.currentTarget = null;
        this.targetHighlight = null;
        this.isAttacking = false;
        this.attackCooldown = 0.5;
        this._lastAttackTime = 0;

        this._isWorldReady = false;

        this.init();
    }

    async init() {
        this.setupMesh();
        this.setupCamera();
        this.setupInputs();

        // Asset loading is handled by the world's async flow
        await this.loadCharacterAssets();

        // Create the health bar after the mesh is loaded/created
        this.createHealthBar();
    }

    /**
     * The world calls this function when its assets are loaded and physics is stable.
     */
    startAfterWorldReady() {
        this._isWorldReady = true;
        this.spawn();
    }

    spawn() {
        if (!this.scene.world) {
            console.error("[Player] Cannot spawn, world not ready.");
            return;
        }

        const world = this.scene.world;
        const spawnX = 0;
        const spawnZ = 0;
        let spawnY = world.getTerrainHeight(spawnX, spawnZ);

        // Ensure player spawns above ground, or above max height if no terrain info
        spawnY = spawnY > 0 ? spawnY + this.groundOffset + 1 : CONFIG.PLAYER.SPAWN_HEIGHT;

        // Set initial position
        this.mesh.position.set(spawnX, spawnY, spawnZ);
        this.velocity.setAll(0);
        console.log(`[Player] Spawned at: ${this.mesh.position.y.toFixed(2)}`);

        // Enable physics now that the player is placed in the world
        this.setupPhysics();

        // Lock pointer for first-person control
        this.scene.onPointerDown = (evt) => {
            if (evt.button === 0) { // Left click
                this.scene.getEngine().enterPointerlock();
                this.handleAttack();
            } else if (evt.button === 2) { // Right click for targeting
                const pickInfo = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
                this.handlePointerDown(pickInfo);
            }
        };

        // Teleport camera to initial position
        this.camera.position = this.mesh.position.clone();
        this.camera.position.y += 0.5;
    }

    setupMesh() {
        // Create an invisible capsule collider for physics
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", {
            height: this.colliderHeight,
            diameter: this.colliderRadius * 2
        }, this.scene);
        this.mesh.isVisible = false;
        this.mesh.checkCollisions = true;
        this.mesh.metadata = { isPlayer: true, entity: this };

        // Create a visual root attached to the collider for character model rotation
        this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
        this.visualRoot.parent = this.mesh;
        this.visualRoot.position.y = -this.groundOffset; // Position visuals at the bottom of the collider

        this.mesh.name = 'Player';
    }

    async loadCharacterAssets() {
        const loader = this.scene.assetLoader;
        const assetKey = 'knight'; // Assuming 'knight' is the default player model
        const asset = ASSET_MANIFEST.CHARACTERS.PLAYER[assetKey];

        if (!loader || !asset || !asset.model) {
            console.warn("[Player] AssetLoader or player model not found. Using procedural mesh.");
            this.createProceduralModel();
            return;
        }

        try {
            const model = await loader.loadModel(asset.model, {
                scene: this.scene,
                scaling: new BABYLON.Vector3(asset.scale || 1.0, asset.scale || 1.0, asset.scale || 1.0)
            });

            if (model && model.root) {
                this.characterModel = model.root;
                this.characterModel.parent = this.visualRoot;
                this.characterModel.position.copyFrom(asset.offset || BABYLON.Vector3.Zero());
                this.characterModel.receiveShadows = true;

                if (this.scene.shadowGenerator) {
                    this.scene.shadowGenerator.addShadowCaster(this.characterModel);
                }

                // Store animations
                if (model.animationGroups.length > 0) {
                    for (const key in asset.animations) {
                        const animName = asset.animations[key];
                        const animGroup = model.animationGroups.find(ag => ag.name.includes(animName));
                        if (animGroup) {
                            this.animations[key] = animGroup;
                            animGroup.stop(); // Stop all initially
                        }
                    }
                }

                this.playAnimation('idle');
                console.log(`[Player] ✓ Loaded character model: ${assetKey}`);
            } else {
                this.createProceduralModel();
            }
        } catch (error) {
            console.error("[Player] Failed to load character model, using procedural:", error);
            this.createProceduralModel();
        }
    }

    createProceduralModel() {
        // Simple visible box/sphere for fallback
        const body = BABYLON.MeshBuilder.CreateBox("body", { width: 0.8, height: 1.2, depth: 0.8 }, this.scene);
        const head = BABYLON.MeshBuilder.CreateSphere("head", { diameter: 0.5 }, this.scene);

        body.position.y = 0.6; // Base of body on visual root
        head.position.y = 1.45;

        body.parent = this.visualRoot;
        head.parent = this.visualRoot;

        const mat = new BABYLON.StandardMaterial("playerMat", this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.1, 0.4, 0.7);
        body.material = mat;
        head.material = mat;

        this.characterModel = body; // Use body as the main reference
        this.characterModel.receiveShadows = true;
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(this.characterModel);
        }
    }

    setupPhysics() {
        if (!this.mesh.physicsImpostor) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh,
                BABYLON.PhysicsImpostor.CylinderImpostor,
                {
                    mass: CONFIG.PLAYER.MASS,
                    friction: CONFIG.PLAYER.FRICTION,
                    restitution: 0.0,
                    linearDamping: CONFIG.PLAYER.LINEAR_DAMPING,
                    angularDamping: CONFIG.PLAYER.ANGULAR_DAMPING
                },
                this.scene
            );

            // Get initial velocity from impostor
            this.mesh.physicsImpostor.getLinearVelocityToRef(this.velocity);
        }
    }

    setupCamera() {
        this.camera = new BABYLON.FollowCamera("PlayerCamera", new BABYLON.Vector3(0, 5, -10), this.scene);
        this.camera.lockedTarget = this.mesh;
        this.camera.radius = 5; // Distance behind the target
        this.camera.heightOffset = 1.0; // Height above the target
        this.camera.rotationOffset = 180; // Default view direction
        this.camera.cameraAcceleration = 0.05;
        this.camera.maxCameraSpeed = 20;

        // Set up FreeCamera for first person view mode
        this.fpCamera = new BABYLON.FreeCamera("FPCamera", new BABYLON.Vector3(0, 0, 0), this.scene);
        this.fpCamera.parent = this.mesh;
        this.fpCamera.position = new BABYLON.Vector3(0, 0.7, 0); // Eye height
        this.fpCamera.attachControl(this.scene.getEngine().get<ctrl62>              this.velocity.addInPlace(force.scale(CONFIG.PLAYER.IMPULSE_STRENGTH * deltaTime));
            }
        }

        // Apply movement velocity
        if (movement.length() > 0) {
            // Apply a small impulse to the physics body to move it
            const impulse = movement.scale(CONFIG.PLAYER.IMPULSE_STRENGTH * deltaTime);
            this.mesh.physicsImpostor.applyImpulse(
                impulse,
                this.mesh.position
            );
            
            // Rotate visual root (which contains the model) to face movement direction
            const targetRotation = Math.atan2(movement.x, movement.z);
            this.visualRoot.rotation.y = BABYLON.Scalar.Lerp(this.visualRoot.rotation.y, targetRotation, this.rotationSpeed);

            // Animate
            this.playAnimation(this.input.run ? 'run' : 'walk');
        } else {
            this.playAnimation('idle');
        }

        // Apply vertical movement (Jump)
        if (this.input.jump && this.isGrounded) {
            this.mesh.physicsImpostor.setLinearVelocity(this.velocity.add(new BABYLON.Vector3(0, this.jumpForce, 0)));
            this.isGrounded = false;
            this.input.jump = false; // Consume jump
            this.playAnimation('jump');
        }


        // Update global position from physics body
        this.mesh.physicsImpostor.get
        this.mesh.physicsImpostor.getLinearVelocityToRef(this.velocity);
        this.position.copyFrom(this.mesh.position);

        // Update camera position to follow mesh position
        // FollowCamera automatically updates, but FreeCamera needs explicit update
        if (this.scene.activeCamera === this.fpCamera) {
            // The FPCamera is parented, so it follows automatically.
            // The player mesh needs to be rotated to match camera/pointer yaw.
            const cameraRotation = this.fpCamera.rotation.y;
            this.visualRoot.rotation.y = BABYLON.Scalar.Lerp(this.visualRoot.rotation.y, cameraRotation, this.rotationSpeed);
        }

        // Ground detection (Raycast downwards)
        const ray = new BABYLON.Ray(this.position.clone(), new BABYLON.Vector3(0, -1, 0), this.groundOffset + 0.1);
        const pickInfo = this.scene.pickWithRay(ray, (mesh) => {
            return mesh !== this.mesh; // Don't hit yourself
        });

        if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name.includes('terrain')) {
            this.isGrounded = true;
            if (this.velocity.y < -0.1) {
                this.velocity.y = 0; // Prevent sliding down slopes with vertical velocity
            }
        } else {
            this.isGrounded = false;
        }

        // Combat/Targeting Update
        this.updateTargetHighlight();
        this.updateHealthBar();
        this.checkPickup();
    }

    checkPickup() {
        if (!this.scene.world || !this.scene.world.items.length) return;

        const pickupRadius = 2.0;
        const playerPos = this.position;

        for (const item of this.scene.world.items) {
            if (item.mesh) {
                const itemPos = item.mesh.position;
                if (BABYLON.Vector3.Distance(playerPos, itemPos) < pickupRadius) {
                    item.collect(this);
                }
            }
        }
    }

    handleAttack() {
        const now = performance.now() / 1000;
        if (now - this._lastAttackTime < this.attackCooldown) return;

        this._lastAttackTime = now;
        this.isAttacking = true;
        this.playAnimation('attack');
        // This should be done via an animation event or timing later.
        setTimeout(() => { this.isAttacking = false; }, 300);

        // Perform raycast/sphere cast for attack
        const attackRay = this.fpCamera.getForwardRay(30); // 30 units range
        const pickInfo = this.scene.pickWithRay(attackRay, (mesh) => {
            return mesh.metadata && (mesh.metadata.isEnemy || mesh.metadata.isNPC);
        });

        if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.metadata.isEnemy) {
            const enemy = pickInfo.pickedMesh.metadata.entity;
            if (enemy && enemy.takeDamage) {
                const damage = 10 + Math.floor(Math.random() * 5); // Simple damage calc
                enemy.takeDamage(damage, this);
            }
        }
    }

    // ========== STATS & COMBAT ==========

    takeDamage(amount, source) {
        this.health -= amount;
        this.health = Math.max(0, this.health);
        
        if (this.scene.ui) {
            this.scene.ui.showFloatingText(amount.toFixed(0), this.mesh.position.clone().add(new BABYLON.Vector3(0, 1.5, 0)), 'playerDamage');
        }

        if (this.health <= 0) {
            this.die();
        }
    }

    heal(amount) {
        this.health += amount;
        this.health = Math.min(this.maxHealth, this.health);
        if (this.scene.ui) {
            this.scene.ui.showFloatingText(`+${amount.toFixed(0)} HP`, this.mesh.position.clone().add(new BABYLON.Vector3(0, 1.5, 0)), 'heal');
        }
    }

    restoreMana(amount) {
        this.mana += amount;
        this.mana = Math.min(this.maxMana, this.mana);
    }

    die() {
        console.log("[Player] You have died!");
        // Stop movement, disable inputs, respawn logic, etc.
        this.stop();
        // Simple respawn
        setTimeout(() => {
            this.health = this.maxHealth;
            this.mana = this.maxMana;
            this.stamina = this.maxStamina;
            this.spawn();
            this.start();
        }, 3000);
    }

    // ========== ANIMATION ==========

    playAnimation(name) {
        if (!this.animations[name]) {
            // console.warn(`Animation ${name} not found.`);
            return;
        }

        if (this.currentAnimation === name) {
            return;
        }

        // Stop current animation
        if (this.currentAnimation && this.animations[this.currentAnimation]) {
            this.animations[this.currentAnimation].stop();
        }

        // Play new animation
        const animGroup = this.animations[name];
        animGroup.start(animGroup.loop, 1.0, animGroup.from, animGroup.to, false);
        this.currentAnimation = name;
    }


    // ========== UI / VISUALS ==========

    createHealthBar() {
        // Player health bar is typically on the HUD (UIManager)
        // But this is the NPC/Enemy style bar for consistency in an RPG
        if (this.healthBar) this.healthBar.dispose();

        const plane = BABYLON.MeshBuilder.CreatePlane("playerHealthBarPlane", { width: 1.0, height: 0.1 }, this.scene);
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        plane.parent = this.mesh;
        plane.position.y = this.colliderHeight + 0.2; // Above the player's head
        plane.isVisible = CONFIG.DEBUG; // Only show in debug

        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(plane);

        const bar = new BABYLON.GUI.Rectangle("healthBar");
        bar.width = 1;
        bar.height = 1;
        bar.color = "white";
        bar.thickness = 2;
        advancedTexture.addControl(bar);

        const health = new BABYLON.GUI.Rectangle("healthFill");
        health.width = 1;
        health.height = 1;
        health.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        health.background = "green";
        bar.addControl(health);

        this.healthBar = { mesh: plane, fill: health };
    }

    updateHealthBar() {
        if (this.healthBar && this.healthBar.mesh.isVisible) {
            this.healthBar.fill.width = this.health / this.maxHealth;
        }
    }

    setTarget(mesh) {
        if (this.currentTarget) {
            // Remove old target's glow if any
        }

        this.currentTarget = mesh.metadata.entity;
        console.log(`[Player] Target set: ${this.currentTarget.name}`);
        this.createTargetHighlight(mesh);
    }

    createTargetHighlight(targetMesh) {
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
        }

        // Simple circle highlight on the ground
        this.targetHighlight = BABYLON.MeshBuilder.CreateDisc('targetHighlight', { radius: 1.2, tessellation: 32 }, this.scene);
        this.targetHighlight.rotation.x = Math.PI / 2; // Flat on the ground
        this.targetHighlight.position.y = this.currentTarget.position.y + 0.02; // Just above ground

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
        if (this.fpCamera) {
            this.fpCamera.dispose();
        }
        if (this.targetHighlight) {
            this.targetHighlight.dispose();
        }
        if (this.characterModel) {
            this.characterModel.dispose();
        }
    }
}
