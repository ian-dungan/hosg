// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.33 (LEGACY SAFE)
// Converted to ES5-friendly syntax to avoid parse errors on
// older browsers while preserving existing functionality.
// ============================================================

// Safety guards: ensure Entity/Character exist even if previous scripts failed to load.
if (typeof Entity === 'undefined') {
    console.warn('[Player] Entity base class missing. Installing minimal fallback.');
    function Entity(scene, position) {
        this.scene = scene;
        this.position = position || new BABYLON.Vector3(0, 0, 0);
        this.mesh = null;
        this.isDead = false;
    }

    Entity.prototype.update = function () {
        if (this.mesh && this.mesh.position && this.position && typeof this.mesh.position.copyFrom === 'function') {
            this.mesh.position.copyFrom(this.position);
        }
    };

    Entity.prototype.dispose = function () {
        this.isDead = true;
        if (this.mesh && typeof this.mesh.dispose === 'function') {
            this.mesh.dispose();
            this.mesh = null;
        }
    };
    window.Entity = Entity;
}

if (typeof Character === 'undefined' && typeof Entity !== 'undefined') {
    console.warn('[Player] Character base class missing. Using minimal fallback.');
    function Character(scene, position, name) {
        Entity.call(this, scene, position);
        this.name = name || 'Character';
        this.health = 100;
        this.target = null;
    }
    Character.prototype = Object.create(Entity.prototype);
    Character.prototype.constructor = Character;
    window.Character = Character;
}

// Inventory/Equipment safety shims in case item.js fails to parse in older environments
if (typeof Inventory === 'undefined') {
    console.warn('[Player] Inventory class missing. Installing minimal fallback.');
    function Inventory(player) {
        this.player = player;
        this.slots = [];
    }
    Inventory.prototype.load = function () { this.slots = []; };
    Inventory.prototype.getSaveData = function () { return []; };
    window.Inventory = Inventory;
}

if (typeof Equipment === 'undefined') {
    console.warn('[Player] Equipment class missing. Installing minimal fallback.');
    function Equipment(player) {
        this.player = player;
        this.slots = {};
    }
    Equipment.prototype.load = function () { this.slots = {}; };
    Equipment.prototype.equip = function () { return null; };
    Equipment.prototype.getSaveData = function () { return []; };
    window.Equipment = Equipment;
}

function Player(scene) {
    var C = typeof CONFIG === 'undefined' ? {} : CONFIG;
    var playerConfig = C.PLAYER || {};
    var combatConfig = C.COMBAT || {};

    var spawnHeight = playerConfig.SPAWN_HEIGHT || 5;

    Character.call(this, scene, new BABYLON.Vector3(0, spawnHeight, 0), 'Player');

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
    this.abilities = [];
    this.inventory = new Inventory(this);
    this.equipment = new Equipment(this);

    this.keys = {}; // For input tracking
    this.camera = null;
    this.target = null;
    this.lastAttackTime = 0;
    this.isGrounded = true;

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);

    this._initCamera();
    this._initInput();
    this._initPhysics();

    // CRITICAL: applyClass calls _initMesh immediately.
    // It must be safe even if the class config fails to load.
    this.applyClass('Warrior');
}
Player.prototype = Object.create(Character.prototype);
Player.prototype.constructor = Player;

// Lightweight Object.assign alternative for legacy environments
function _copyProps(target, source) {
    if (!source) return target;
    for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            target[key] = source[key];
        }
    }
    return target;
}

Player.prototype._initCamera = function () {
    this.camera = new BABYLON.FollowCamera('PlayerCamera', this.position.clone(), this.scene);
    this.camera.radius = 10;
    this.camera.heightOffset = 4;
    this.camera.rotationOffset = 180;
    this.camera.cameraAcceleration = 0.05;
    this.camera.maxCameraSpeed = 20;
    this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
};

Player.prototype._initInput = function () {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.scene.onPointerDown = this.handlePointerDown;
};

Player.prototype._initPhysics = function () {
    if (!this.mesh) {
        // Create a simple invisible mesh just for physics collision/position
        this.mesh = BABYLON.MeshBuilder.CreateCylinder('playerCollision', {
            height: 2, diameter: 1
        }, this.scene);
        this.mesh.isVisible = false;
        this.mesh.checkCollisions = true;
    }

    this.mesh.position.copyFrom(this.position);

    // Add a physics impostor
    this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
        this.mesh,
        BABYLON.PhysicsImpostor.CylinderImpostor,
        { mass: 1, restitution: 0.1, friction: 0.5 },
        this.scene
    );
};

Player.prototype._initMesh = function (assetKey) {
    // CRITICAL FIX: Check if assetManager is ready
    if (!this.scene.game || !this.scene.game.assetManager) {
        console.error('[Player] Cannot initialize mesh. AssetManager is not available on game object.');
        if (this.mesh) this.mesh.isVisible = true;
        return;
    }

    var assetMeshes = this.scene.game.assetManager.getAsset(assetKey);

    if (assetMeshes && assetMeshes.length > 0) {
        var rootMesh = assetMeshes[0].clone('PlayerMesh', null);
        rootMesh.isVisible = true;

        // Attach the visual mesh to the collision mesh as a child
        if (this.mesh) {
            rootMesh.parent = this.mesh;
            rootMesh.position = new BABYLON.Vector3(0, -1, 0);
            rootMesh.rotation.y = Math.PI;
        }

        this.visualMesh = rootMesh;
    } else {
        console.warn('[Player] Failed to load mesh for asset: ' + assetKey + '. AssetManager load failed or key is wrong.');
        if (this.mesh) this.mesh.isVisible = true;
    }
};

// --- Input Handlers ---
Player.prototype.handleKeyDown = function (event) {
    this.keys[event.key.toLowerCase()] = true;
};

Player.prototype.handleKeyUp = function (event) {
    this.keys[event.key.toLowerCase()] = false;
};

Player.prototype.handlePointerDown = function (evt) {
    if (evt.button === 0) {
        var pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);

        if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.parent) {
            var targetEntity = this.scene.game.world.npcs.find(function (npc) {
                return npc.mesh && npc.mesh === pickResult.pickedMesh.parent;
            });

            if (targetEntity) {
                this.target = targetEntity;
                this.scene.game.ui.showMessage('Target acquired: ' + this.target.name, 1000, 'info');

                // If a target is acquired and an ability is ready, perform an attack
                var attackAbility = this.abilities[0];
                if (attackAbility && attackAbility.isReady()) {
                    attackAbility.execute(this, this.target);
                }
            } else {
                this.target = null;
            }
        } else {
            this.target = null;
        }
    }
};

// --- Core Update Loop ---
Player.prototype.update = function (deltaTime) {
    this.abilities.forEach(function (ability) { return ability.update(deltaTime); });
    this._updateMovement(deltaTime);
    this._updateCameraPosition();

    Entity.prototype.update.call(this, deltaTime);
};

Player.prototype._updateMovement = function (deltaTime) {
    if (!this.mesh || !this.mesh.physicsImpostor) return;

    var impulseForce = 25;
    var velocity = this.mesh.physicsImpostor.getLinearVelocity();
    var moveVector = BABYLON.Vector3.Zero();

    if (this.keys['w']) moveVector.z += 1;
    if (this.keys['s']) moveVector.z -= 1;
    if (this.keys['a']) moveVector.x -= 1;
    if (this.keys['d']) moveVector.x += 1;

    if (moveVector.lengthSquared() > 0) {
        moveVector = moveVector.normalize();

        // Rotate the move vector based on the camera's rotation
        var yRotation = this.camera.rotationOffset * (Math.PI / 180);
        var matrix = BABYLON.Matrix.RotationY(yRotation);
        moveVector = BABYLON.Vector3.TransformCoordinates(moveVector, matrix);

        // Apply impulse
        var impulse = moveVector.scale(impulseForce);
        this.mesh.physicsImpostor.applyImpulse(
            impulse,
            this.mesh.getAbsolutePosition()
        );

        // Update visual mesh rotation (only if visual mesh exists)
        if (this.visualMesh) {
            var targetAngle = Math.atan2(moveVector.x, moveVector.z);
            this.visualMesh.rotation.y = targetAngle;
        }

        this.visualMesh = rootMesh;
    } else {
        console.warn('[Player] Failed to load mesh for asset: ' + assetKey + '. AssetManager load failed or key is wrong.');
        if (this.mesh) this.mesh.isVisible = true;
    }
};

// --- Input Handlers ---
Player.prototype.handleKeyDown = function (event) {
    this.keys[event.key.toLowerCase()] = true;
};

Player.prototype.handleKeyUp = function (event) {
    this.keys[event.key.toLowerCase()] = false;
};

Player.prototype.handlePointerDown = function (evt) {
    if (evt.button === 0) {
        var pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);

    // Simple velocity dampening to prevent sliding indefinitely
    var horizontalVelocity = new BABYLON.Vector3(velocity.x, 0, velocity.z);
    if (horizontalVelocity.lengthSquared() > 0.01) {
        var dampingForce = horizontalVelocity.scale(-2);
        this.mesh.physicsImpostor.applyForce(
            dampingForce,
            this.mesh.getAbsolutePosition()
        );
    }
};

// --- Class & Stats ---
Player.prototype.applyClass = function (className) {
    var classConfig = (CONFIG && CONFIG.ASSETS && CONFIG.ASSETS.CLASSES
        ? CONFIG.ASSETS.CLASSES[className]
        : null) || this._getFallbackClassConfig(className);

    if (classConfig) {
        this.className = className;

        // 1. Apply Stats (ES5 safe)
        _copyProps(this.stats, classConfig.stats);
        this.health = this.stats.maxHealth;
        this.mana = this.stats.maxMana;
        this.stamina = this.stats.maxStamina;

        // 2. Initialize Mesh
        var assetKey = classConfig.model;
        this._initMesh(assetKey);

        // 3. Initialize Abilities
        var skillTemplates = this.scene.game.skillTemplates;
        if (!skillTemplates) {
            skillTemplates = new Map();
            this.scene.game.skillTemplates = skillTemplates;
        }

        var defaultAbilityTemplate = skillTemplates.get(classConfig.defaultAbility);
        if (!defaultAbilityTemplate) {
            console.warn('[Player] Default ability template not found for: ' + classConfig.defaultAbility + '. Installing fallback.');
            defaultAbilityTemplate = {
                id: classConfig.defaultAbility,
                code: classConfig.defaultAbility.toUpperCase(),
                name: classConfig.defaultAbility,
                skill_type: 'Attack',
                resource_cost: { mana: 0, stamina: 10 },
                cooldown_ms: 5000,
                effect: {
                    type: 'damage',
                    base_value: 10,
                    magic_scaling: 0,
                    physical_scaling: 0.5
                }
            };
            skillTemplates.set(classConfig.defaultAbility, defaultAbilityTemplate);
        }

        this.abilities = [new Ability(defaultAbilityTemplate)];

        console.log('[Player] Applied default class: ' + className);
    } else {
        console.warn('[Player] Class config not found for: ' + className);
    }
};

Player.prototype._getFallbackClassConfig = function (className) {
    if (className !== 'Warrior') return null;

    return {
        model: 'knight',
        stats: {
            maxHealth: 100,
            maxMana: 50,
            maxStamina: 100,
            attackPower: 10,
            magicPower: 5,
            moveSpeed: 0.15
        },
        defaultAbility: 'Cleave'
    };
};

// --- Cleanup/Utility ---
Player.prototype._initTargetHighlight = function () {
    // Placeholder for future target highlight effect
};

Player.prototype.dispose = function () {
    if (this.mesh) {
        this.mesh.dispose();
        this.mesh = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.scene.onPointerDown = null;

    if (this.camera) this.camera.detachControl(this.scene.getEngine().getRenderingCanvas());
};

Player.prototype._updateCameraPosition = function () {
    if (this.camera && this.mesh) {
        this.camera.target.copyFrom(this.mesh.position);
    }
};

// Ensure the Player class is globally accessible
window.Player = Player;
