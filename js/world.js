class World {
  constructor(scene, shadowGenerator) {
    this.scene = scene;
    this.shadowGenerator = shadowGenerator;
    this.ground = null;
    this.terrain = null;
    this.objects = new Map();
    this.npcs = new Map();
    this.items = new Map();
  }
  
  async init() {
    try {
      // Create ground
      await this.createGround();
      
      // Load terrain
      await this.loadTerrain();
      
      // Load objects
      await this.loadObjects();
      
      // Load NPCs
      await this.loadNPCs();
      
      debugLog('World initialized');
    } catch (error) {
      console.error('Error initializing world:', error);
      throw error;
    }
  }
  
  async createGround() {
    // Create a simple ground
    this.ground = BABYLON.MeshBuilder.CreateGround('ground', {
      width: 100,
      height: 100,
      subdivisions: 2
    }, this.scene);
    
    // Create a material for the ground
    const groundMaterial = new BABYLON.StandardMaterial('groundMaterial', this.scene);
    groundMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.1);
    groundMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    this.ground.material = groundMaterial;
    
    // Enable physics
    this.ground.checkCollisions = true;
    this.ground.receiveShadows = true;
    
    // Add physics impostor
    this.ground.physicsImpostor = new BABYLON.PhysicsImpostor(
      this.ground,
      BABYLON.PhysicsImpostor.BoxImpostor,
      { mass: 0, restitution: 0.2, friction: 1.0 },
      this.scene
    );
  }
  
  async loadTerrain() {
    // In a real game, you would load terrain data from a file or generate it procedurally
    // For now, we'll create a simple terrain with some hills
    
    // Create a height map
    const size = 128;
    const subdivisions = 100;
    const minHeight = 0;
    const maxHeight = 5;
    
    // Create height data
    const heightData = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const x = (i % size) / size;
      const z = Math.floor(i / size) / size;
      
      // Simple noise-based height
      let height = 0;
      height += 0.5 * Math.sin(x * 4 * Math.PI) * Math.sin(z * 4 * Math.PI);
      height += 0.25 * Math.sin(x * 8 * Math.PI) * Math.sin(z * 8 * Math.PI);
      height = (height + 1) * 0.5; // Normalize to 0-1
      
      heightData[i] = minHeight + height * (maxHeight - minHeight);
    }
    
    // Create the terrain
    this.terrain = BABYLON.MeshBuilder.CreateGroundFromHeightMap(
      'terrain',
      heightData,
      {
        width: 200,
        height: 200,
        subdivisions: subdivisions,
        minHeight: minHeight,
        maxHeight: maxHeight,
        updatable: false
      },
      this.scene
    );
    
    // Position the terrain
    this.terrain.position.y = -0.5;
    
    // Create a material for the terrain
    const terrainMaterial = new BABYLON.StandardMaterial('terrainMaterial', this.scene);
    terrainMaterial.diffuseTexture = new BABYLON.Texture('assets/textures/ground/grass.jpg', this.scene);
    terrainMaterial.diffuseTexture.uScale = 10;
    terrainMaterial.diffuseTexture.vScale = 10;
    terrainMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    this.terrain.material = terrainMaterial;
    
    // Enable physics
    this.terrain.checkCollisions = true;
    this.terrain.receiveShadows = true;
    
    // Add physics impostor
    this.terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
      this.terrain,
      BABYLON.PhysicsImpostor.HeightmapImpostor,
      { mass: 0, restitution: 0.2, friction: 1.0 },
      this.scene
    );
  }
  
  async loadObjects() {
    // In a real game, you would load objects from a file or database
    // For now, we'll create some simple objects
    
    // Create some trees
    this.createTree(10, 0, 10);
    this.createTree(-10, 0, 10);
    this.createTree(10, 0, -10);
    this.createTree(-10, 0, -10);
    
    // Create some rocks
    this.createRock(15, 0, 15);
    this.createRock(-15, 0, 15);
    this.createRock(15, 0, -15);
    this.createRock(-15, 0, -15);
  }
  
  createTree(x, y, z) {
    // Create trunk
    const trunk = BABYLON.MeshBuilder.CreateCylinder('trunk', {
      height: 2,
      diameter: 0.8
    }, this.scene);
    
    // Create leaves
    const leaves = BABYLON.MeshBuilder.CreateSphere('leaves', {
      diameter: 4,
      segments: 8
    }, this.scene);
    
    // Position the tree
    trunk.position = new BABYLON.Vector3(x, y + 1, z);
    leaves.position = new BABYLON.Vector3(x, y + 3, z);
    
    // Create materials
    const trunkMaterial = new BABYLON.StandardMaterial('trunkMaterial', this.scene);
    trunkMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.3, 0.2);
    
    const leavesMaterial = new BABYLON.StandardMaterial('leavesMaterial', this.scene);
    leavesMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.1);
    
    // Apply materials
    trunk.material = trunkMaterial;
    leaves.material = leavesMaterial;
    
    // Enable shadows
    this.shadowGenerator.addShadowCaster(trunk);
    this.shadowGenerator.addShadowCaster(leaves);
    
    // Add physics
    trunk.checkCollisions = true;
    leaves.checkCollisions = false;
    
    // Store the tree
    const tree = {
      trunk,
      leaves,
      position: new BABYLON.Vector3(x, y, z)
    };
    
    this.objects.set(`tree_${x}_${z}`, tree);
    
    return tree;
  }
  
  createRock(x, y, z) {
    // Create a simple rock
    const rock = BABYLON.MeshBuilder.CreateSphere('rock', {
      diameter: 2,
      segments: 8
    }, this.scene);
    
    // Position the rock
    rock.position = new BABYLON.Vector3(x, y + 1, z);
    
    // Create material
    const rockMaterial = new BABYLON.StandardMaterial('rockMaterial', this.scene);
    rockMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    
    // Apply material
    rock.material = rockMaterial;
    
    // Enable shadows
    this.shadowGenerator.addShadowCaster(rock);
    
    // Add physics
    rock.checkCollisions = true;
    
    // Store the rock
    this.objects.set(`rock_${x}_${z}`, {
      mesh: rock,
      position: new BABYLON.Vector3(x, y, z)
    });
    
    return rock;
  }
  
  async loadNPCs() {
    // In a real game, you would load NPCs from a file or database
    // For now, we'll create a simple NPC
    
    // Create a test NPC
    this.createNPC('test_npc', 'Merchant', 0, 0, 20);
  }
  
  createNPC(id, name, x, y, z) {
    // Create a simple NPC
    const npc = BABYLON.MeshBuilder.CreateCapsule(`npc_${id}`, {
      height: 1.8,
      radius: 0.4
    }, this.scene);
    
    // Position the NPC
    npc.position = new BABYLON.Vector3(x, y, z);
    
    // Create material
    const npcMaterial = new BABYLON.StandardMaterial(`npcMaterial_${id}`, this.scene);
    npcMaterial.diffuseColor = new BABYLON.Color3(1.0, 0.5, 0.5); // Reddish color for NPCs
    
    // Apply material
    npc.material = npcMaterial;
    
    // Enable shadows
    this.shadowGenerator.addShadowCaster(npc);
    
    // Create name label
    const nameLabel = new BABYLON.GUI.Rectangle(`npcName_${id}`);
    nameLabel.background = 'rgba(0, 0, 0, 0.5)';
    nameLabel.height = '30px';
    nameLabel.width = '100px';
    nameLabel.cornerRadius = 5;
    
    const nameText = new BABYLON.GUI.TextBlock(`npcNameText_${id}`, name);
    nameText.color = 'white';
    nameText.fontSize = 14;
    nameLabel.addControl(nameText);
    
    // Create advanced dynamic texture
    const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('npcUI', true, this.scene);
    advancedTexture.addControl(nameLabel);
    
    // Position the name label above the NPC
    nameLabel.linkWithMesh(npc);
    nameLabel.linkOffsetY = -50;
    
    // Store the NPC
    this.npcs.set(id, {
      id,
      name,
      mesh: npc,
      position: new BABYLON.Vector3(x, y, z),
      nameLabel
    });
    
    return npc;
  }
  
  update(deltaTime) {
    // Update world objects
    this.updateNPCs(deltaTime);
  }
  
  updateNPCs(deltaTime) {
    // Update NPCs
    for (const [id, npc] of this.npcs) {
      // Simple idle animation
      npc.mesh.rotation.y += 0.01 * deltaTime;
      
      // Update name label position
      if (npc.nameLabel) {
        const screenPos = BABYLON.Vector3.Project(
          new BABYLON.Vector3(
            npc.mesh.position.x,
            npc.mesh.position.y + 2,
            npc.mesh.position.z
          ),
          BABYLON.Matrix.Identity(),
          this.scene.getTransformMatrix(),
          this.scene.activeCamera.viewport.toGlobal(
            this.scene.getEngine().getRenderWidth(),
            this.scene.getEngine().getRenderHeight()
          )
        );
        
        npc.nameLabel.left = `${screenPos.x - 50}px`;
        npc.nameLabel.top = `${screenPos.y}px`;
      }
    }
  }
  
  // Cleanup
  dispose() {
    // Dispose of all objects
    if (this.ground) {
      this.ground.dispose();
      this.ground = null;
    }
    
    if (this.terrain) {
      this.terrain.dispose();
      this.terrain = null;
    }
    
    // Dispose of all objects
    for (const [id, obj] of this.objects) {
      if (obj.mesh) {
        obj.mesh.dispose();
      } else if (obj.trunk && obj.leaves) {
        obj.trunk.dispose();
        obj.leaves.dispose();
      }
    }
    this.objects.clear();
    
    // Dispose of all NPCs
    for (const [id, npc] of this.npcs) {
      if (npc.mesh) {
        npc.mesh.dispose();
      }
      if (npc.nameLabel) {
        npc.nameLabel.dispose();
      }
    }
    this.npcs.clear();
  }
}
