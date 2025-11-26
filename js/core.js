// Core Configuration
const CONFIG = {
    GAME: {
        VERSION: '1.0.0',
        DEBUG: true,
        TICK_RATE: 60
    },
    PLAYER: {
        HEALTH: 100,
        MANA: 100,
        STAMINA: 100,
        INVENTORY_SIZE: 20,
        MOVE_SPEED: 0.2,
        RUN_MULTIPLIER: 1.5,
        JUMP_FORCE: 0.5,
        CAMERA: {
            SENSITIVITY: 0.002,
            MIN_PITCH: -Math.PI/2 + 0.1,
            MAX_PITCH: Math.PI/2 - 0.1
        }
    },
    WORLD: {
        GRAVITY: -9.81,
        CHUNK_SIZE: 32,
        TERRAIN_SIZE: 1000,
        WATER_LEVEL: -0.5,
        TREE_COUNT: 100,
        ROCK_COUNT: 50,
        GRASS_COUNT: 200,
        BUILDING_COUNT: 5
    },
    COMBAT: {
        BASE_ATTACK_RANGE: 2.0,
        BASE_ATTACK_RATE: 1.0,
        BASE_DAMAGE: 10
    },
    NETWORK: {
        ENABLED: false,
        SERVER_URL: 'ws://localhost:8080',
        RECONNECT_DELAY: 5000
    }
};

// Base Entity Class
class Entity {
    constructor(scene, position) {
        this.scene = scene;
        this.mesh = null;
        this.position = position || BABYLON.Vector3.Zero();
        this.rotation = BABYLON.Vector3.Zero();
        this.scaling = new BABYLON.Vector3(1, 1, 1);
        this.health = 100;
        this.maxHealth = 100;
        this.id = Math.random().toString(36).substr(2, 9);
        this.type = 'entity';
        this.collider = null;
        this.physicsImpostor = null;
        this.isActive = true;
    }

    init() {
        // Override in child classes
    }

    update(deltaTime) {
        if (this.mesh && this.isActive) {
            this.mesh.position.copyFrom(this.position);
            this.mesh.rotation.copyFrom(this.rotation);
            this.mesh.scaling.copyFrom(this.scaling);
        }
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        const isDead = this.health <= 0;
        if (isDead) {
            this.onDeath();
        }
        return isDead;
    }

    onDeath() {
        this.dispose();
    }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        if (this.physicsImpostor) {
            this.physicsImpostor.dispose();
            this.physicsImpostor = null;
        }
        this.isActive = false;
    }

    serialize() {
        return {
            id: this.id,
            type: this.type,
            position: { 
                x: this.position.x, 
                y: this.position.y, 
                z: this.position.z 
            },
            rotation: { 
                x: this.rotation.x, 
                y: this.rotation.y, 
                z: this.rotation.z 
            },
            health: this.health,
            maxHealth: this.maxHealth
        };
    }

    static deserialize(data, scene) {
        // Override in child classes
        return null;
    }
}

// Asset Manager
class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.textures = {};
        this.materials = {};
        this.meshes = {};
        this.assets = {};
        this.queue = [];
        this.loaded = 0;
        this.total = 0;
    }

    addToQueue(id, type, options = {}) {
        this.queue.push({ id, type, options });
        this.total++;
        return this;
    }

    async loadAll(onProgress) {
        const promises = this.queue.map(item => this.loadAsset(item, onProgress));
        await Promise.all(promises);
        return this.assets;
    }

    async loadAsset(item, onProgress) {
        try {
            let asset;
            switch (item.type) {
                case 'texture':
                    asset = await this.loadTexture(item.id, item.options);
                    break;
                case 'mesh':
                    asset = await this.loadMesh(item.id, item.options);
                    break;
                case 'sound':
                    asset = await this.loadSound(item.id, item.options);
                    break;
                default:
                    throw new Error(`Unknown asset type: ${item.type}`);
            }
            
            this.assets[item.id] = asset;
            this.loaded++;
            
            if (onProgress) {
                onProgress(this.loaded / this.total, item.id);
            }
            
            return asset;
        } catch (error) {
            console.error(`Failed to load ${item.type} ${item.id}:`, error);
            throw error;
        }
    }

    async loadTexture(id, options = {}) {
        if (this.textures[id]) return this.textures[id];
        
        // Create procedural texture if no URL provided
        if (!options.url) {
            const size = options.size || 512;
            const texture = new BABYLON.DynamicTexture(id, size, this.scene);
            const context = texture.getContext();
            
            // Generate a simple procedural texture
            const imageData = context.createImageData(size, size);
            const data = imageData.data;
            
            for (let i = 0; i < data.length; i += 4) {
                // Generate some interesting patterns
                const x = (i / 4) % size;
                const y = Math.floor((i / 4) / size);
                
                // Simple noise pattern
                const value = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 0.5 + 0.5;
                
                // Set RGBA values
                data[i] = value * 200 + 55;     // R
                data[i + 1] = value * 100 + 100; // G
                data[i + 2] = value * 50 + 50;   // B
                data[i + 3] = 255;               // A
            }
            
            context.putImageData(imageData, 0, 0);
            texture.update();
            
            this.textures[id] = texture;
            return texture;
        } else {
            // Load texture from URL
            const texture = new BABYLON.Texture(options.url, this.scene);
            this.textures[id] = texture;
            return texture;
        }
    }

    async loadMesh(id, options = {}) {
        if (this.meshes[id]) return this.meshes[id];
        
        // Create a simple procedural mesh if no URL provided
        let mesh;
        switch (options.type) {
            case 'box':
                mesh = BABYLON.MeshBuilder.CreateBox(id, options, this.scene);
                break;
            case 'sphere':
                mesh = BABYLON.MeshBuilder.CreateSphere(id, options, this.scene);
                break;
            case 'ground':
                mesh = BABYLON.MeshBuilder.CreateGround(id, options, this.scene);
                break;
            default:
                mesh = BABYLON.MeshBuilder.CreateBox(id, {}, this.scene);
        }
        
        // Apply material if specified
        if (options.material) {
            mesh.material = this.getMaterial(options.material);
        }
        
        this.meshes[id] = mesh;
        return mesh;
    }

    async loadSound(id, options = {}) {
        // Create a simple sound
        const sound = new BABYLON.Sound(id, null, this.scene, null, {
            autoplay: options.autoplay || false,
            loop: options.loop || false,
            volume: options.volume || 0.5
        });
        
        return sound;
    }

    getMaterial(name, options = {}) {
        const materialKey = `${name}_${JSON.stringify(options)}`;
        
        if (!this.materials[materialKey]) {
            const material = new BABYLON.StandardMaterial(name, this.scene);
            
            // Apply material properties
            switch (name) {
                case 'ground':
                    material.diffuseColor = new BABYLON.Color3(0.3, 0.6, 0.3);
                    material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
                    break;
                case 'water':
                    material.alpha = 0.7;
                    material.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.5);
                    material.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
                    break;
                case 'tree':
                    material.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.2);
                    break;
                case 'rock':
                    material.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
                    break;
                case 'grass':
                    material.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.2);
                    material.alpha = 0.8;
                    material.backFaceCulling = false;
                    break;
                default:
                    material.diffuseColor = new BABYLON.Color3(1, 1, 1);
            }
            
            // Apply any custom options
            if (options.texture) {
                material.diffuseTexture = this.getTexture(options.texture);
            }
            
            this.materials[materialKey] = material;
        }
        
        return this.materials[materialKey];
    }

    getTexture(name) {
        return this.textures[name] || this.loadTexture(name);
    }

    getMesh(name) {
        return this.meshes[name];
    }

    getSound(name) {
        return this.assets[name];
    }

    dispose() {
        // Dispose of all assets
        Object.values(this.textures).forEach(texture => texture.dispose());
        Object.values(this.materials).forEach(material => material.dispose());
        Object.values(this.meshes).forEach(mesh => mesh.dispose());
        
        this.textures = {};
        this.materials = {};
        this.meshes = {};
        this.assets = {};
        this.queue = [];
        this.loaded = 0;
        this.total = 0;
    }
}

// Network Manager
class NetworkManager {
    constructor(game) {
        this.game = game;
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.pendingMessages = [];
        this.eventHandlers = new Map();
        
        // Bind methods
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.send = this.send.bind(this);
        this.on = this.on.bind(this);
        this.off = this.off.bind(this);
    }

    async connect() {
        if (this.socket) {
            await this.disconnect();
        }

        return new Promise((resolve, reject) => {
            try {
                this.socket = new WebSocket(CONFIG.NETWORK.SERVER_URL);
                
                this.socket.onopen = () => {
                    console.log('Connected to server');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    
                    // Process any pending messages
                    while (this.pendingMessages.length > 0) {
                        const { type, data } = this.pendingMessages.shift();
                        this.send(type, data);
                    }
                    
                    resolve();
                };
                
                this.socket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        this.handleMessage(message);
                    } catch (error) {
                        console.error('Error parsing message:', error);
                    }
                };
                
                this.socket.onclose = () => {
                    console.log('Disconnected from server');
                    this.isConnected = false;
                    this.attemptReconnect();
                };
                
                this.socket.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.isConnected = false;
                    reject(error);
                };
                
            } catch (error) {
                console.error('Failed to connect:', error);
                reject(error);
            }
        });
    }

    disconnect() {
        return new Promise((resolve) => {
            if (!this.socket) {
                resolve();
                return;
            }
            
            this.socket.onclose = () => {
                this.socket = null;
                this.isConnected = false;
                resolve();
            };
            
            this.socket.close();
        });
    }

    send(type, data = {}) {
        const message = JSON.stringify({ type, data });
        
        if (!this.isConnected || !this.socket) {
            console.log('Queueing message (not connected):', type);
            this.pendingMessages.push({ type, data });
            return;
        }
        
        try {
            this.socket.send(message);
        } catch (error) {
            console.error('Error sending message:', error);
            this.pendingMessages.push({ type, data });
            this.attemptReconnect();
        }
    }

    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event).add(handler);
        return () => this.off(event, handler);
    }

    off(event, handler) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).delete(handler);
        }
    }

    handleMessage(message) {
        const { type, data } = message;
        
        if (this.eventHandlers.has(type)) {
            for (const handler of this.eventHandlers.get(type)) {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in handler for ${type}:`, error);
                }
            }
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            return;
        }
        
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            if (!this.isConnected) {
                this.connect().catch(console.error);
            }
        }, delay);
    }
}

// Game State Manager
class GameState {
    constructor() {
        this.state = {
            player: null,
            entities: new Map(),
            world: null,
            time: 0,
            day: 1,
            weather: 'clear',
            paused: false
        };
    }

    setPlayer(player) {
        this.state.player = player;
    }

    addEntity(entity) {
        if (entity && entity.id) {
            this.state.entities.set(entity.id, entity);
        }
    }

    removeEntity(id) {
        this.state.entities.delete(id);
    }

    getEntity(id) {
        return this.state.entities.get(id);
    }

    update(deltaTime) {
        if (this.state.paused) return;
        
        // Update game time
        this.state.time += deltaTime;
        if (this.state.time >= 86400) { // 24 hours in seconds
            this.state.time = 0;
            this.state.day++;
        }
        
        // Update all entities
        for (const [id, entity] of this.state.entities) {
            if (entity && typeof entity.update === 'function') {
                entity.update(deltaTime);
            }
        }
    }

    serialize() {
        return {
            time: this.state.time,
            day: this.state.day,
            weather: this.state.weather,
            entities: Array.from(this.state.entities.values()).map(e => e.serialize())
        };
    }

    load(state) {
        if (!state) return;
        
        this.state.time = state.time || 0;
        this.state.day = state.day || 1;
        this.state.weather = state.weather || 'clear';
        
        // Clear existing entities
        this.state.entities.clear();
        
        // Add new entities
        if (Array.isArray(state.entities)) {
            for (const data of state.entities) {
                const entity = this.createEntity(data);
                if (entity) {
                    this.addEntity(entity);
                }
            }
        }
    }

    createEntity(data) {
        // This should be implemented by the game to create the appropriate entity type
        console.warn('createEntity not implemented');
        return null;
    }

    save() {
        try {
            const state = this.serialize();
            localStorage.setItem('gameState', JSON.stringify(state));
            return true;
        } catch (error) {
            console.error('Failed to save game state:', error);
            return false;
        }
    }

    loadFromStorage() {
        try {
            const state = localStorage.getItem('gameState');
            if (state) {
                this.load(JSON.parse(state));
                return true;
            }
        } catch (error) {
            console.error('Failed to load game state:', error);
        }
        return false;
    }
}

// Input Manager
class InputManager {
    constructor() {
        this.keys = new Set();
        this.mouse = {
            x: 0,
            y: 0,
            dx: 0,
            dy: 0,
            buttons: new Set()
        };
        this.touch = {
            active: false,
            x: 0,
            y: 0,
            startX: 0,
            startY: 0
        };
        this.pointerLocked = false;
        
        // Bind event handlers
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchMove = this.onTouchMove.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);
        this.onPointerLockChange = this.onPointerLockChange.bind(this);
        this.onPointerLockError = this.onPointerLockError.bind(this);
        
        // Initialize
        this.initialize();
    }

    initialize() {
        // Keyboard events
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        
        // Mouse events
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
        
        // Touch events
        window.addEventListener('touchstart', this.onTouchStart);
        window.addEventListener('touchmove', this.onTouchMove);
        window.addEventListener('touchend', this.onTouchEnd);
        
        // Pointer lock events
        document.addEventListener('pointerlockchange', this.onPointerLockChange);
        document.addEventListener('mozpointerlockchange', this.onPointerLockChange);
        document.addEventListener('webkitpointerlockchange', this.onPointerLockChange);
        document.addEventListener('pointerlockerror', this.onPointerLockError);
        document.addEventListener('mozpointerlockerror', this.onPointerLockError);
        document.addEventListener('webkitpointerlockerror', this.onPointerLockError);
    }

    dispose() {
        // Remove event listeners
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('touchstart', this.onTouchStart);
        window.removeEventListener('touchmove', this.onTouchMove);
        window.removeEventListener('touchend', this.onTouchEnd);
        document.removeEventListener('pointerlockchange', this.onPointerLockChange);
        document.removeEventListener('mozpointerlockchange', this.onPointerLockChange);
        document.removeEventListener('webkitpointerlockchange', this.onPointerLockChange);
        document.removeEventListener('pointerlockerror', this.onPointerLockError);
        document.removeEventListener('mozpointerlockerror', this.onPointerLockError);
        document.removeEventListener('webkitpointerlockerror', this.onPointerLockError);
    }

    onKeyDown(event) {
        this.keys.add(event.key.toLowerCase());
    }

    onKeyUp(event) {
        this.keys.delete(event.key.toLowerCase());
    }

    onMouseMove(event) {
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
        this.mouse.dx += event.movementX || 0;
        this.mouse.dy += event.movementY || 0;
    }

    onMouseDown(event) {
        this.mouse.buttons.add(event.button);
    }

    onMouseUp(event) {
        this.mouse.buttons.delete(event.button);
    }

    onTouchStart(event) {
        if (event.touches.length > 0) {
            this.touch.active = true;
            this.touch.startX = event.touches[0].clientX;
            this.touch.startY = event.touches[0].clientY;
            this.touch.x = this.touch.startX;
            this.touch.y = this.touch.startY;
            event.preventDefault();
        }
    }

    onTouchMove(event) {
        if (this.touch.active && event.touches.length > 0) {
            this.touch.x = event.touches[0].clientX;
            this.touch.y = event.touches[0].clientY;
            event.preventDefault();
        }
    }

    onTouchEnd(event) {
        if (event.touches.length === 0) {
            this.touch.active = false;
        }
        event.preventDefault();
    }

    onPointerLockChange() {
        this.pointerLocked = (
            document.pointerLockElement === document.body ||
            document.mozPointerLockElement === document.body ||
            document.webkitPointerLockElement === document.body
        );
    }

    onPointerLockError() {
        console.error('Pointer lock error');
        this.pointerLocked = false;
    }

    requestPointerLock(element = document.body) {
        if ('requestPointerLock' in element) {
            element.requestPointerLock();
        } else if ('mozRequestPointerLock' in element) {
            element.mozRequestPointerLock();
        } else if ('webkitRequestPointerLock' in element) {
            element.webkitRequestPointerLock();
        }
    }

    exitPointerLock() {
        if (document.exitPointerLock) {
            document.exitPointerLock();
        } else if (document.mozExitPointerLock) {
            document.mozExitPointerLock();
        } else if (document.webkitExitPointerLock) {
            document.webkitExitPointerLock();
        }
    }

    isKeyDown(key) {
        return this.keys.has(key.toLowerCase());
    }

    isMouseButtonDown(button = 0) {
        return this.mouse.buttons.has(button);
    }

    getMouseDelta() {
        const delta = { x: this.mouse.dx, y: this.mouse.dy };
        this.mouse.dx = 0;
        this.mouse.dy = 0;
        return delta;
    }

    getTouchDelta() {
        if (!this.touch.active) return { x: 0, y: 0 };
        
        return {
            x: this.touch.x - this.touch.startX,
            y: this.touch.y - this.touch.startY
        };
    }

    reset() {
        this.keys.clear();
        this.mouse.buttons.clear();
        this.mouse.dx = 0;
        this.mouse.dy = 0;
        this.touch.active = false;
    }
}

// Audio Manager
class AudioManager {
    constructor(scene) {
        this.scene = scene;
        this.sounds = new Map();
        this.music = null;
        this.masterVolume = 1.0;
        this.soundVolume = 1.0;
        this.musicVolume = 0.5;
        this.muted = false;
        this.audioContext = this.getAudioContext();
        this.initialized = false;
    }

    getAudioContext() {
        return new (window.AudioContext || window.webkitAudioContext)();
    }

    async initialize() {
        if (this.initialized) return;
        
        // Resume audio context on user interaction
        const initAudio = () => {
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            document.removeEventListener('click', initAudio);
            document.removeEventListener('keydown', initAudio);
            document.removeEventListener('touchstart', initAudio);
        };
        
        document.addEventListener('click', initAudio, { once: true });
        document.addEventListener('keydown', initAudio, { once: true });
        document.addEventListener('touchstart', initAudio, { once: true });
        
        this.initialized = true;
    }

    async loadSound(name, options = {}) {
        if (this.sounds.has(name)) return this.sounds.get(name);
        
        const sound = new BABYLON.Sound(
            name,
            options.url || null,
            this.scene,
            null,
            {
                autoplay: false,
                loop: options.loop || false,
                volume: (options.volume || 1.0) * this.soundVolume * this.masterVolume,
                spatialSound: options.spatial || false,
                maxDistance: options.maxDistance || 100,
                refDistance: options.refDistance || 1
            }
        );
        
        this.sounds.set(name, sound);
        return sound;
    }

    async playSound(name, options = {}) {
        await this.initialize();
        
        const sound = this.sounds.get(name) || await this.loadSound(name, options);
        
        if (sound) {
            if (options.position) {
                sound.setPosition(options.position);
                sound.setAttenuationFunction((currentVolume, currentDistance, maxDistance, refDistance, rolloffFactor) => {
                    // Custom attenuation function
                    const distance = Math.max(0.1, currentDistance);
                    return currentVolume * (1 / Math.pow(distance / refDistance, rolloffFactor));
                });
            }
            
            sound.setVolume((options.volume || 1.0) * this.soundVolume * this.masterVolume);
            sound.play();
            return sound;
        }
        
        return null;
    }

    stopSound(name) {
        const sound = this.sounds.get(name);
        if (sound) {
            sound.stop();
        }
    }

    async playMusic(name, options = {}) {
        if (this.music) {
            this.music.stop();
        }
        
        this.music = await this.loadSound(name, { ...options, loop: true, volume: options.volume || 0.5 });
        
        if (this.music) {
            this.music.setVolume(this.musicVolume * this.masterVolume);
            this.music.play();
            return this.music;
        }
        
        return null;
    }

    stopMusic() {
        if (this.music) {
            this.music.stop();
            this.music = null;
        }
    }

    setMasterVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        this.updateVolumes();
    }

    setSoundVolume(volume) {
        this.soundVolume = Math.max(0, Math.min(1, volume));
        this.updateVolumes();
    }

    setMusicVolume(volume) {
        this.musicVolume = Math.max(0, Math.min(1, volume));
        if (this.music) {
            this.music.setVolume(this.musicVolume * this.masterVolume);
        }
    }

    updateVolumes() {
        // Update all sounds
        for (const [name, sound] of this.sounds) {
            if (sound !== this.music) {
                sound.setVolume(sound._volume * this.masterVolume);
            }
        }
        
        // Update music
        if (this.music) {
            this.music.setVolume(this.musicVolume * this.masterVolume);
        }
    }

    toggleMute() {
        this.muted = !this.muted;
        
        if (this.muted) {
            // Store current volumes
            this._prevMasterVolume = this.masterVolume;
            this.setMasterVolume(0);
        } else {
            // Restore volumes
            this.setMasterVolume(this._prevMasterVolume || 0.5);
        }
        
        return this.muted;
    }

    dispose() {
        // Stop and dispose all sounds
        for (const [name, sound] of this.sounds) {
            sound.stop();
            sound.dispose();
        }
        
        this.sounds.clear();
        this.music = null;
        
        // Close audio context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
    }
}

// Export for Node.js/CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CONFIG,
        Entity,
        AssetManager,
        NetworkManager,
        GameState,
        InputManager,
        AudioManager
    };
}
