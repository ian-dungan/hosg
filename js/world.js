// world.js - Enhanced world with beautiful terrain

// weather.js - Procedural weather system
class WeatherSystem {
    constructor(scene) {
        this.scene = scene;
        this.weatherParticles = null;
        this.weatherType = 'clear';
        this.targetWeather = 'clear';
        this.weatherTransition = 0;
        this.time = 0;
        this.dayNightCycle = 0;
        this.rainSound = null;
        this.windSound = null;
        this.thunderSound = null;
        this.audioContext = null;
        this.init();
    }

    init() {
        // Setup audio context
        this.setupAudio();
        
        // Create weather particle system
        this.createWeatherParticles();
        
        // Start weather cycle
        this.startWeatherCycle();
    }

    setupAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create wind sound (procedural noise)
            this.windSound = this.createWindSound();
            
            // Create rain sound (procedural noise)
            this.rainSound = this.createRainSound();
            
            // Create thunder sound (procedural)
            this.thunderSound = this.createThunderSound();
            
        } catch (e) {
            console.warn('Web Audio API not supported', e);
        }
    }

    createWindSound() {
        // Create wind noise using audio API
        const bufferSize = 4096;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        // Fill the buffer with noise
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        // Create a buffer source node
        const noise = this.audioContext.createBufferSource();
        noise.buffer = noiseBuffer;
        noise.loop = true;
        
        // Create filter for wind effect
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 500;
        
        // Create gain node for volume control
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 0;
        
        // Connect nodes
        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        // Start the noise
        noise.start();
        
        return { gainNode, filter };
    }

    createRainSound() {
        // Similar to wind but with different filter settings
        const bufferSize = 4096;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        const noise = this.audioContext.createBufferSource();
        noise.buffer = noiseBuffer;
        noise.loop = true;
        
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1000;
        filter.Q.value = 0.5;
        
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 0;
        
        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        noise.start();
        
        return { gainNode, filter };
    }

    createThunderSound() {
        // Create an impulse for thunder
        const sampleRate = this.audioContext.sampleRate;
        const duration = 3; // seconds
        const buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate);
        const channelData = buffer.getChannelData(0);
        
        // Create thunder-like sound
        for (let i = 0; i < channelData.length; i++) {
            const t = i / sampleRate;
            // Random impulses with exponential decay
            const impulse = Math.random() > 0.99 ? Math.random() * 0.5 : 0;
            const decay = Math.exp(-t * 2);
            channelData[i] = impulse * decay * (0.5 + 0.5 * Math.sin(t * 50));
        }
        
        return buffer;
    }

    playThunder() {
        if (!this.audioContext) return;
        
        const source = this.audioContext.createBufferSource();
        source.buffer = this.thunderSound;
        
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 0.5;
        
        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        source.start();
        
        // Random rumble after thunder
        if (Math.random() > 0.7) {
            setTimeout(() => this.playThunder(), 1000 + Math.random() * 2000);
        }
    }

    createWeatherParticles() {
        // Create a particle system for rain/snow
        this.weatherParticles = new BABYLON.ParticleSystem("weatherParticles", 5000, this.scene);
        
        // Default to rain settings
        this.weatherParticles.particleTexture = new BABYLON.Texture("data:image/png;base64,...", this.scene);
        this.weatherParticles.emitter = new BABYLON.Vector3(0, 50, 0);
        this.weatherParticles.minEmitBox = new BABYLON.Vector3(-100, 0, -100);
        this.weatherParticles.maxEmitBox = new BABYLON.Vector3(100, 0, 100);
        
        // Common settings
        this.weatherParticles.color1 = new BABYLON.Color4(1, 1, 1, 1);
        this.weatherParticles.color2 = new BABYLON.Color4(1, 1, 1, 0.8);
        this.weatherParticles.colorDead = new BABYLON.Color4(1, 1, 1, 0);
        this.weatherParticles.minSize = 0.1;
        this.weatherParticles.maxSize = 0.5;
        this.weatherParticles.minLifeTime = 2.0;
        this.weatherParticles.maxLifeTime = 5.0;
        this.weatherParticles.emitRate = 0; // Start with no particles
        this.weatherParticles.blendMode = BABYLON.ParticleSystem.BLENDMODE_ONEONE;
        this.weatherParticles.gravity = new BABYLON.Vector3(0, -9.81, 0);
        this.weatherParticles.direction1 = new BABYLON.Vector3(-1, -1, -1);
        this.weatherParticles.direction2 = new BABYLON.Vector3(1, -1, 1);
        this.weatherParticles.minAngularSpeed = 0;
        this.weatherParticles.maxAngularSpeed = Math.PI;
        this.weatherParticles.minEmitPower = 10;
        this.weatherParticles.maxEmitPower = 20;
        this.weatherParticles.updateSpeed = 0.01;
        
        this.weatherParticles.start();
    }

    updateWeatherParticles(weatherType) {
        if (!this.weatherParticles) return;
        
        switch(weatherType) {
            case 'rain':
                this.weatherParticles.particleTexture = this.createRainTexture();
                this.weatherParticles.minEmitBox = new BABYLON.Vector3(-100, 30, -100);
                this.weatherParticles.maxEmitBox = new BABYLON.Vector3(100, 50, 100);
                this.weatherParticles.minSize = 0.1;
                this.weatherParticles.maxSize = 0.3;
                this.weatherParticles.minLifeTime = 1.0;
                this.weatherParticles.maxLifeTime = 2.0;
                this.weatherParticles.direction1 = new BABYLON.Vector3(-0.5, -1, -0.5);
                this.weatherParticles.direction2 = new BABYLON.Vector3(0.5, -1.5, 0.5);
                this.weatherParticles.minEmitPower = 15;
                this.weatherParticles.maxEmitPower = 25;
                this.weatherParticles.emitRate = CONFIG.WORLD.MAX_RAIN_PARTICLES * this.weatherTransition;
                break;
                
            case 'snow':
                this.weatherParticles.particleTexture = this.createSnowTexture();
                this.weatherParticles.minEmitBox = new BABYLON.Vector3(-100, 30, -100);
                this.weatherParticles.maxEmitBox = new BABYLON.Vector3(100, 50, 100);
                this.weatherParticles.minSize = 0.2;
                this.weatherParticles.maxSize = 0.5;
                this.weatherParticles.minLifeTime = 3.0;
                this.weatherParticles.maxLifeTime = 6.0;
                this.weatherParticles.direction1 = new BABYLON.Vector3(-0.25, -0.5, -0.25);
                this.weatherParticles.direction2 = new BABYLON.Vector3(0.25, -0.7, 0.25);
                this.weatherParticles.minEmitPower = 2;
                this.weatherParticles.maxEmitPower = 5;
                this.weatherParticles.emitRate = CONFIG.WORLD.MAX_SNOW_PARTICLES * this.weatherTransition;
                break;
                
            default: // clear
                this.weatherParticles.emitRate = 0;
                break;
        }
    }

    createRainTexture() {
        // Create a simple rain drop texture procedurally
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Transparent background
        ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        ctx.fillRect(0, 0, size, size);
        
        // Draw a simple raindrop shape
        ctx.fillStyle = 'rgba(200, 220, 255, 0.8)';
        ctx.beginPath();
        ctx.ellipse(size/2, size/2, size/4, size/2, 0, 0, Math.PI * 2);
        ctx.fill();
        
        return new BABYLON.Texture(canvas.toDataURL(), this.scene);
    }

    createSnowTexture() {
        // Create a simple snowflake texture procedurally
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Transparent background
        ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        ctx.fillRect(0, 0, size, size);
        
        // Draw a simple snowflake
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 2;
        
        const center = size / 2;
        const radius = size / 3;
        
        // Draw snowflake arms
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const x = center + Math.cos(angle) * radius;
            const y = center + Math.sin(angle) * radius;
            
            ctx.beginPath();
            ctx.moveTo(center, center);
            ctx.lineTo(x, y);
            ctx.stroke();
            
            // Add some branches
            const midX = center + Math.cos(angle) * radius * 0.5;
            const midY = center + Math.sin(angle) * radius * 0.5;
            
            const perpAngle = angle + Math.PI / 2;
            const branchLength = radius * 0.3;
            
            ctx.beginPath();
            ctx.moveTo(midX, midY);
            ctx.lineTo(
                midX + Math.cos(perpAngle) * branchLength,
                midY + Math.sin(perpAngle) * branchLength
            );
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(midX, midY);
            ctx.lineTo(
                midX - Math.cos(perpAngle) * branchLength,
                midY - Math.sin(perpAngle) * branchLength
            );
            ctx.stroke();
        }
        
        return new BABYLON.Texture(canvas.toDataURL(), this.scene);
    }

    startWeatherCycle() {
        // Start with clear weather
        this.setWeather('clear');
        
        // Change weather periodically
        setInterval(() => {
            const weatherTypes = Object.keys(CONFIG.WEATHER.WEATHER_TYPES);
            const currentIndex = weatherTypes.indexOf(this.weatherType);
            const nextIndex = (currentIndex + 1) % weatherTypes.length;
            this.setWeather(weatherTypes[nextIndex]);
        }, CONFIG.WEATHER.CYCLE_DURATION * 1000);
    }

    setWeather(weatherType) {
        if (this.weatherType === weatherType) return;
        
        this.targetWeather = weatherType;
        this.weatherTransition = 0;
        
        // Play weather-specific sounds
        if (weatherType === 'rain' && this.rainSound) {
            this.rainSound.gainNode.gain.linearRampToValueAtTime(
                CONFIG.SOUND.EFFECTS_VOLUME * 0.5,
                this.audioContext.currentTime + 2
            );
            
            // Random thunder during rain
            if (Math.random() > 0.7) {
                setTimeout(() => this.playThunder(), 2000 + Math.random() * 5000);
            }
        } else if (this.rainSound) {
            this.rainSound.gainNode.gain.linearRampToValueAtTime(
                0,
                this.audioContext.currentTime + 2
            );
        }
        
        console.log(`Weather changing to: ${weatherType}`);
    }

    update(deltaTime) {
        // Update weather transition
        if (this.weatherType !== this.targetWeather) {
            this.weatherTransition += CONFIG.WEATHER.TRANSITION_SPEED * deltaTime;
            
            if (this.weatherTransition >= 1) {
                this.weatherTransition = 1;
                this.weatherType = this.targetWeather;
            }
            
            this.updateWeatherParticles(this.targetWeather);
        }
        
        // Update day/night cycle
        CONFIG.WORLD.TIME_OF_DAY = (CONFIG.WORLD.TIME_OF_DAY + CONFIG.WORLD.TIME_SPEED * deltaTime) % 1;
        this.updateDayNightCycle();
    }

    updateDayNightCycle() {
        // Update lighting based on time of day
        const time = CONFIG.WORLD.TIME_OF_DAY;
        const sunIntensity = Math.sin(time * Math.PI) * 0.8 + 0.2; // 0.2 to 1.0
        
        // Update sun direction (rotates around Y axis)
        const sunAngle = time * Math.PI * 2;
        CONFIG.GRAPHICS.LIGHTING.SUN_DIRECTION = new BABYLON.Vector3(
            Math.sin(sunAngle),
            Math.cos(sunAngle * 2) * 0.5, // Higher sun at noon
            Math.cos(sunAngle)
        ).normalize();
        
        // Update ambient light
        CONFIG.GRAPHICS.LIGHTING.AMBIENT_INTENSITY = 0.2 + sunIntensity * 0.4;
        
        // Update fog color based on time of day
        const isDay = time > 0.2 && time < 0.8;
        const fogColor = isDay ? 
            new BABYLON.Color3(0.9, 0.9, 1.0) : // Daytime fog (light blue)
            new BABYLON.Color3(0.1, 0.1, 0.2);   // Nighttime fog (dark blue)
        
        if (this.scene.fogColor) {
            BABYLON.Color3.LerpToRef(
                this.scene.fogColor,
                fogColor,
                0.01,
                this.scene.fogColor
            );
        }
    }

    dispose() {
        if (this.weatherParticles) {
            this.weatherParticles.dispose();
        }
        // Clean up audio
        if (this.audioContext) {
            this.audioContext.close();
        }
    }
}

// Make WeatherSystem globally available
window.WeatherSystem = WeatherSystem;

    async init() {
        await this.createTerrain();
        this.createSkybox();
        this.createEnvironment();
    }

    async createTerrain() {
        // Create a large ground
        this.ground = BABYLON.MeshBuilder.CreateGround('ground', {
            width: 200,
            height: 200,
            subdivisions: 100
        }, this.scene);
        
        // Create a material with procedural textures
        const groundMaterial = new BABYLON.StandardMaterial("groundMaterial", this.scene);
        
        // Create a grass-like texture procedurally
        const grassTexture = new BABYLON.NoiseProceduralTexture("grassNoise", 512, this.scene);
        grassTexture.octaves = 3;
        grassTexture.persistence = 0.8;
        grassTexture.animationSpeedFactor = 0;
        
        // Create a green color for grass
        const grassColor = new BABYLON.Color3(0.2, 0.5, 0.2);
        
        groundMaterial.diffuseTexture = grassTexture;
        groundMaterial.diffuseColor = grassColor;
        
        // Add some bump mapping
        const bumpTexture = new BABYLON.NoiseProceduralTexture("bumpNoise", 512, this.scene);
        bumpTexture.octaves = 4;
        bumpTexture.persistence = 0.2;
        groundMaterial.bumpTexture = bumpTexture;
        groundMaterial.bumpTexture.level = 0.1;
        
        this.ground.material = groundMaterial;
        this.ground.receiveShadows = true;
        
        // Add some height variation
        const positions = this.ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            
            // Generate some hills and valleys
            let height = 0;
            height += Math.sin(x * 0.02) * 2;
            height += Math.cos(z * 0.02) * 2;
            height += Math.sin(x * 0.05) * Math.cos(z * 0.05) * 3;
            
            // Add some random noise
            height += (Math.random() - 0.5) * 0.5;
            
            positions[i + 1] = height;
        }
        
        this.ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        this.ground.convertToFlatShadedMesh();
        
        // Add physics
        this.ground.checkCollisions = true;
        this.ground.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.ground,
            BABYLON.PhysicsImpostor.HeightmapImpostor,
            { mass: 0, restitution: 0.3 },
            this.scene
        );
    }

    createSkybox() {
        // Use a simple color skybox instead of texture
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        
        // Create a gradient sky
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.8); // Blue sky
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        skyboxMaterial.disableLighting = true;
        
        // Add some simple clouds with noise
        const noiseTexture = new BABYLON.NoiseProceduralTexture("clouds", 512, this.scene);
        noiseTexture.animationSpeedFactor = 0.01;
        noiseTexture.persistence = 0.2;
        noiseTexture.brightness = 0.7;
        noiseTexture.octaves = 4;
        
        skyboxMaterial.reflectionTexture = noiseTexture;
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        
        skybox.material = skyboxMaterial;
        return skybox;
    }

    createEnvironment() {
        // Add some trees
        this.addTrees();
        
        // Add some rocks
        this.addRocks();
        
        // Add a water plane
        this.addWater();
    }

    addTrees() {
        // Create a tree prototype
        const createTree = (x, z) => {
            // Trunk
            const trunk = BABYLON.MeshBuilder.CreateCylinder("trunk", {
                height: 2,
                diameterBottom: 0.5,
                diameterTop: 0.3
            }, this.scene);
            trunk.position = new BABYLON.Vector3(x, 1, z);
            
            const trunkMaterial = new BABYLON.StandardMaterial("trunkMaterial", this.scene);
            trunkMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.1);
            trunk.material = trunkMaterial;
            
            // Leaves
            const leaves = BABYLON.MeshBuilder.CreateSphere("leaves", {
                diameter: 3,
                segments: 8
            }, this.scene);
            leaves.position = new BABYLON.Vector3(x, 3.5, z);
            
            const leavesMaterial = new BABYLON.StandardMaterial("leavesMaterial", this.scene);
            leavesMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.1);
            leavesMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
            leaves.material = leavesMaterial;
            
            return [trunk, leaves];
        };
        
        // Add some random trees
        for (let i = 0; i < 50; i++) {
            const x = Math.random() * 180 - 90;
            const z = Math.random() * 180 - 90;
            createTree(x, 0, z);
        }
    }

    addRocks() {
        // Create a rock prototype
        const createRock = (x, z) => {
            const rock = BABYLON.MeshBuilder.CreateIcoSphere("rock", {
                radius: 0.5 + Math.random(),
                subdivisions: 2
            }, this.scene);
            
            rock.position = new BABYLON.Vector3(
                x + (Math.random() - 0.5) * 5,
                0.5,
                z + (Math.random() - 0.5) * 5
            );
            
            rock.rotation = new BABYLON.Vector3(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            
            const rockMaterial = new BABYLON.StandardMaterial("rockMaterial", this.scene);
            rockMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
            rockMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
            rock.material = rockMaterial;
            
            return rock;
        };
        
        // Add some random rocks
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * 180 - 90;
            const z = Math.random() * 180 - 90;
            createRock(x, z);
        }
    }

    addWater() {
        // Create a water material
        const waterMesh = BABYLON.MeshBuilder.CreateGround("water", {
            width: 200,
            height: 200,
            subdivisions: 50
        }, this.scene);
        
        waterMesh.position.y = -0.5; // Slightly below the ground
        
        // Create a simple water material
        const waterMaterial = new BABYLON.StandardMaterial("waterMaterial", this.scene);
        waterMaterial.alpha = 0.7;
        waterMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.5);
        waterMaterial.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        waterMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.3);
        waterMaterial.alphaMode = BABYLON.Engine.ALPHA_COMBINE;
        
        // Add some wave effect
        waterMaterial.bumpTexture = new BABYLON.NoiseProceduralTexture("waterBump", 256, this.scene);
        waterMaterial.bumpTexture.level = 0.1;
        waterMaterial.bumpTexture.animationSpeedFactor = 0.1;
        
        waterMesh.material = waterMaterial;
        
        // Animate the water
        let time = 0;
        this.scene.registerBeforeRender(() => {
            time += 0.01;
            waterMesh.rotation.z = Math.sin(time * 0.1) * 0.1;
            waterMesh.rotation.x = Math.cos(time * 0.05) * 0.1;
        });
    }

    update(deltaTime) {
        // Update any world animations here
    }

    dispose() {
        // Clean up resources
        if (this.ground) {
            this.ground.dispose();
        }
        if (this.environment) {
            this.environment.dispose();
        }
        this.chunks.forEach(chunk => chunk.dispose());
        this.chunks.clear();
    }
}

// Make World globally available
window.World = World;
