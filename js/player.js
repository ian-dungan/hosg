// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.27 (ASSET RECOVERY PATCH)
// Update: Player now initializes using the loaded 'knight' model.
// ============================================================

class Player extends Character {
    constructor(scene) {
        const C = typeof CONFIG === 'undefined' ? {} : CONFIG;
        const playerConfig = C.PLAYER || {};
        const combatConfig = C.COMBAT || {};
        
        const spawnHeight = playerConfig.SPAWN_HEIGHT || 5; 
        
        super(scene, new BABYLON.Vector3(0, spawnHeight, 0), 'Player');
        
        this.isPlayer = true; 
        this.className = null; 
        
        this.stats = {
            maxHealth: playerConfig.HEALTH || 100,
            maxMana: playerConfig.MANA || 50, 
            maxStamina: playerConfig.STAMINA || 100,
            
            attackPower: 10,
            magicPower: 5,
            
            moveSpeed: playerConfig.MOVE_SPEED || 0.15, 

            attackRange: combatConfig.RANGE_MELEE || 2,
            attackCooldown: combatConfig.ATTACK_COOLDOWN_MELEE || 1,
            
            currentAttackPower: 10,
            currentMagicPower: 5,
        };
        
        this.health = this.stats.maxHealth;
        this.mana = this.stats.maxMana;
        this.stamina = this.stats.maxStamina;

        // Player State
        this.input = {
            forward: false, backward: false, left: false, right: false,
            action1: false, action2: false, action3: false, action4: false
        };
        this.isMoving = false;
        
        this.target = null;
        this.combat = {
            target: null,
            attackTimer: 0
        };

        // Inventory and Abilities (Requires item.js and ability.js to load first)
        if (typeof Inventory !== 'undefined' && typeof Equipment !== 'undefined') {
            this.inventory = new Inventory(this);
            this.equipment = new Equipment(this);
        } else {
            console.warn('[Player] Inventory/Equipment classes are not defined. Check item.js script order.');
            this.inventory = { load: () => {}, addItem: () => {} };
            this.equipment = { load: () => {} };
        }

        this.abilities = new Map();
        
        this._initCollision(60, 0.2); 
        this._initMesh();
        this._initCamera();
        this._initInput();
    }
    
    // --- ASSET RECOVERY: Use the loaded 'knight' model ---
    async _initMesh() {
        const assets = this.scene.game.assetManager ? this.scene.game.assetManager.assets : null;
        const modelAsset = assets ? assets['CHARACTERS_knight'] : null;

        if (modelAsset && modelAsset[0]) {
            // Create an instance of the loaded mesh and set it as the visual root
            this.visualRoot = modelAsset[0].clone("player_visual", null);
            this.visualRoot.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5); 
            
            // Attach visual root to the collider mesh
            this.visualRoot.parent = this.mesh;
            
            // Recursively make all parts of the model not pickable
            this.visualRoot.getChildMeshes().forEach(m => m.isPickable = false);

            console.log('[Player] Mesh and visual root created from "knight" asset.');
        } else {
            // Fallback: simple visible box if model failed to load
            console.warn('[Player] "knight" model not found. Using simple placeholder mesh.');
            this.visualRoot = this.mesh; 
            this.mesh.isVisible = true;
            this.mesh.material = new BABYLON.StandardMaterial("playerMat", this.scene);
            this.mesh.material.diffuseColor = BABYLON.Color3.Blue();
        }
    }
    
    // --- Initialization Methods (Keep as they are stable) ---
    _initCollision(mass, friction) {
        // Create an invisible collision mesh (Cylinder)
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: 2, diameter: 1 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isVisible = false; // Keep the collider invisible

        if (this.scene.isPhysicsEnabled) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.BoxImpostor, // Box is usually more stable than Cylinder for collision
                { 
                    mass: mass, 
                    friction: friction, 
                    restitution: 0.1 
                }, 
                this.scene
            );

            if (this.mesh.physicsImpostor && typeof this.mesh.physicsImpostor.setAngularFactor === 'function') {
                this.mesh.physicsImpostor.setAngularFactor(0); // Prevent rotation
            } else {
                 console.warn('[Player] Physics impostor ready, but setAngularFactor is missing or failed to initialize correctly. Rotation may occur.');
            }
        }
    }

    _initCamera() {
        this.camera = new BABYLON.ArcRotateCamera(
            "ArcRotateCamera",
            -Math.PI / 2, 
            Math.PI / 3, 
            10, 
            this.mesh.position, 
            this.scene
        );

        this.camera.lowerRadiusLimit = 5;
        this.camera.upperRadiusLimit = 25;
        this.camera.upperBetaLimit = Math.PI / 2.2;
        this.camera.setTarget(this.mesh.position); 
        this.camera.attachControl(this.scene.getEngine().get<ctrl63>
