// Player class - CLEAN REWRITE
class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.camera = null;
        this.speed = 0.15;
        this.runMultiplier = 2.0;
        this.jumpForce = 0.3;
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
        
        // Physics ready flag
        this.physicsReady = false;
        this.onGround = true;
        
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
        
        // Setup camera
        this.setupCamera();
        
        // Setup input
        this.setupInput();
        
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
        this.mesh.visibility = 0; // Invisible (will add character model later)
        
        // CRITICAL: Enable collisions
        this.mesh.checkCollisions = true;
        
        // Create physics impostor with SIMPLE settings
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
        }
        
        this.physicsReady = true;
        
        console.log(`[Player] ✓ Player mesh created at position (${this.mesh.position.x}, ${this.mesh.position.y.toFixed(2)}, ${this.mesh.position.z})`);
        console.log(`[Player] ✓ Physics enabled: mass=1, friction=0.5`);
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
    
    update(deltaTime) {
        if (!this.mesh || !this.physicsReady) return;
        
        const dt = deltaTime / 16.67; // Normalize to 60fps
        
        // Get camera forward/right directions
        const forward = this.camera.getDirection(BABYLON.Axis.Z);
        forward.y = 0;
        forward.normalize();
        
        const right = this.camera.getDirection(BABYLON.Axis.X);
        right.y = 0;
        right.normalize();
        
        // Calculate movement direction
        let moveDir = BABYLON.Vector3.Zero();
        
        if (this.input.forward) moveDir.addInPlace(forward);
        if (this.input.backward) moveDir.subtractInPlace(forward);
        if (this.input.right) moveDir.addInPlace(right);
        if (this.input.left) moveDir.subtractInPlace(right);
        
        // Apply movement
        if (moveDir.lengthSquared() > 0) {
            moveDir.normalize();
            
            const speed = this.input.run ? this.speed * this.runMultiplier : this.speed;
            const velocity = moveDir.scale(speed * dt);
            
            // Apply velocity
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    velocity.x,
                    this.mesh.physicsImpostor.getLinearVelocity().y, // Keep vertical velocity
                    velocity.z
                )
            );
            
            // Rotate player to face movement direction
            const targetRotation = Math.atan2(moveDir.x, moveDir.z);
            this.mesh.rotation.y = targetRotation;
        } else {
            // Stop horizontal movement when no input
            const currentVel = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(0, currentVel.y, 0)
            );
        }
        
        // Jump
        if (this.input.jump && this.onGround) {
            const currentVel = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(currentVel.x, this.jumpForce, currentVel.z)
            );
            this.onGround = false;
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
            this.mesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
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
