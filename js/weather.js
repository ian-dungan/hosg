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
