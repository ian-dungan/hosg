class Player {
  constructor(scene, camera, shadowGenerator) {
    this.scene = scene;
    this.camera = camera;
    this.shadowGenerator = shadowGenerator;
    
    this.mesh = null;
    this.character = null;
    this.animations = {};
    this.currentAnimation = null;
    
    // Player state
    this.state = {
      health: 100,
      maxHealth: 100,
      mana: 100,
      maxMana: 100,
      level: 1,
      experience: 0,
      stats: {
        strength: 10,
        dexterity: 10,
        intelligence: 10,
        vitality: 10,
        luck: 10
      },
      position: new BABYLON.Vector3(0, 0, 0),
      rotation: 0,
      velocity: new BABYLON.Vector3(0, 0, 0),
      isMoving: false,
      isJumping: false,
      isAttacking: false
    };
    
    // Input state
    this.input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      attack: false
    };
    
    // Physics
    this.physicsBody = null;
    this.physicsImpostor = null;
  }
  
  async init() {
    try {
      // Create player mesh
      await this.createCharacter();
      
      // Setup physics
      this.setupPhysics();
      
      // Setup animations
      await this.loadAnimations();
      
      // Set initial animation
      this.playAnimation('idle', true);
      
      debugLog('Player initialized');
    } catch (error) {
      console.error('Error initializing player:', error);
      throw error;
    }
  }
  
  async createCharacter() {
    // Create a simple character as a placeholder
    // In a real game, you would load a 3D model here
    const character = BABYLON.MeshBuilder.CreateCapsule('player', {
      height: 1.8,
      radius: 0.4,
      subdivisions: 8,
      tessellation: 16
    }, this.scene);
    
    // Position the character
    character.position = new BABYLON.Vector3(0, 1, 0);
    
    // Create a material for the character
    const material = new BABYLON.StandardMaterial('playerMaterial', this.scene);
    material.diffuseColor = new BABYLON.Color3(0.3, 0.6, 1.0);
    material.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    character.material = material;
    
    // Enable shadows
    this.shadowGenerator.addShadowCaster(character);
    
    this.mesh = character;
  }
  
  setupPhysics() {
    // Create physics impostor for the player
    this.physicsImpostor = new BABYLON.PhysicsImpostor(
      this.mesh,
      BABYLON.PhysicsImpostor.CapsuleImpostor,
      {
        mass: 1,
        friction: 0.2,
        restitution: 0.1,
        nativeOptions: {
          move: true
        }
      },
      this.scene
    );
    
    // Disable rotation on physics body
    this.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
    this.physicsImpostor.setAngularVelocity(new BABYLON.Vector3(0, 0, 0));
  }
  
  async loadAnimations() {
    // In a real game, you would load animations from a 3D model
    // For now, we'll create some basic animations programmatically
    
    // Idle animation
    const idleAnim = new BABYLON.Animation(
      'idle',
      'rotation.y',
      30,
      BABYLON.Animation.ANIMATIONTYPE_FLOAT,
      BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );
    
    const keyFrames = [];
    keyFrames.push({ frame: 0, value: 0 });
    keyFrames.push({ frame: 30, value: Math.PI / 16 });
    keyFrames.push({ frame: 60, value: 0 });
    keyFrames.push({ frame: 90, value: -Math.PI / 16 });
    keyFrames.push({ frame: 120, value: 0 });
    
    idleAnim.setKeys(keyFrames);
    
    // Add animations to the mesh
    this.mesh.animations = [idleAnim];
    
    // Store animation references
    this.animations = {
      idle: idleAnim,
      walk: null, // Would be loaded from model
      run: null,  // Would be loaded from model
      attack: null, // Would be loaded from model
      jump: null,  // Would be loaded from model
      death: null  // Would be loaded from model
    };
  }
  
  playAnimation(name, loop = true) {
    if (this.currentAnimation === name) return;
    
    // Stop current animation
    if (this.currentAnimation) {
      this.scene.stopAnimation(this.mesh);
    }
    
    // Start new animation
    const animation = this.animations[name];
    if (animation) {
      this.scene.beginAnimation(this.mesh, 0, 120, loop, 1.0);
      this.currentAnimation = name;
    }
  }
  
  update(deltaTime, keys) {
    if (!this.mesh || !this.physicsImpostor) return;
    
    // Update input state
    this.updateInput(keys);
    
    // Handle movement
    this.handleMovement(deltaTime);
    
    // Handle jumping
    this.handleJumping();
    
    // Handle attacking
    this.handleAttacking();
    
    // Update camera position to follow player
    this.updateCamera();
    
    // Update player state
    this.updateState();
  }
  
  updateInput(keys) {
    this.input = {
      forward: keys['w'] || keys['arrowup'],
      backward: keys['s'] || keys['arrowdown'],
      left: keys['a'] || keys['arrowleft'],
      right: keys['d'] || keys['arrowright'],
      jump: keys[' '],
      attack: keys[' '] || keys['f'] || keys[' '] // Space or F key for attack
    };
  }
  
  handleMovement(deltaTime) {
    const moveSpeed = CONFIG.PLAYER.MOVE_SPEED;
    const moveVector = new BABYLON.Vector3(0, 0, 0);
    
    // Calculate movement direction based on camera orientation
    const forward = this.camera.getForwardRay().direction;
    const right = this.camera.getRightRay().direction;
    
    // Flatten the vectors
    forward.y = 0;
    right.y = 0;
    forward.normalize();
    right.normalize();
    
    // Calculate movement vector
    if (this.input.forward) {
      moveVector.addInPlace(forward.scale(moveSpeed * deltaTime * 60));
    }
    if (this.input.backward) {
      moveVector.addInPlace(forward.scale(-moveSpeed * deltaTime * 60));
    }
    if (this.input.left) {
      moveVector.addInPlace(right.scale(-moveSpeed * deltaTime * 60));
    }
    if (this.input.right) {
      moveVector.addInPlace(right.scale(moveSpeed * deltaTime * 60));
    }
    
    // Apply movement
    if (moveVector.length() > 0) {
      this.mesh.moveWithCollisions(moveVector);
      this.playAnimation('walk');
      this.state.isMoving = true;
    } else {
      this.playAnimation('idle');
      this.state.isMoving = false;
    }
    
    // Update rotation to face movement direction
    if (moveVector.length() > 0) {
      const targetRotation = Math.atan2(moveVector.x, moveVector.z);
      this.mesh.rotation.y = BABYLON.Scalar.Lerp(
        this.mesh.rotation.y,
        targetRotation,
        0.2
      );
    }
  }
  
  handleJumping() {
    if (this.input.jump && !this.state.isJumping) {
      // Apply jump force
      this.physicsImpostor.setLinearVelocity(
        new BABYLON.Vector3(
          this.physicsImpostor.getLinearVelocity().x,
          10,
          this.physicsImpostor.getLinearVelocity().z
        )
      );
      this.state.isJumping = true;
      this.playAnimation('jump', false);
    }
    
    // Check if player is on the ground
    const ray = new BABYLON.Ray(
      this.mesh.position.add(new BABYLON.Vector3(0, -1, 0)),
      new BABYLON.Vector3(0, -1, 0),
      1.1
    );
    
    const hit = this.scene.pickWithRay(ray);
    if (hit.pickedMesh) {
      this.state.isJumping = false;
    }
  }
  
  handleAttacking() {
    if (this.input.attack && !this.state.isAttacking) {
      this.state.isAttacking = true;
      this.playAnimation('attack', false);
      
      // Reset attack state after animation
      setTimeout(() => {
        this.state.isAttacking = false;
      }, 500);
      
      // Perform attack logic here
      // ...
    }
  }
  
  updateCamera() {
    // Simple third-person camera follow
    const cameraOffset = new BABYLON.Vector3(0, 3, -5);
    const targetPosition = this.mesh.position.add(cameraOffset);
    this.camera.position = BABYLON.Vector3.Lerp(
      this.camera.position,
      targetPosition,
      0.1
    );
    this.camera.setTarget(this.mesh.position);
  }
  
  updateState() {
    // Update player state for networking
    this.state.position = this.mesh.position.clone();
    this.state.rotation = this.mesh.rotation.y;
  }
  
  // Network sync methods
  updateFromNetwork(data) {
    // Update player state from network data
    if (data.position) {
      this.mesh.position = BABYLON.Vector3.FromArray(data.position);
    }
    if (data.rotation !== undefined) {
      this.mesh.rotation.y = data.rotation;
    }
    // Update other properties as needed
  }
  
  // Cleanup
  dispose() {
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }
  }
}
