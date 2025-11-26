class World {
    constructor(scene) {
        this.scene = scene;
        this.ground = null;
        this.skybox = null;
        this.water = null;
        this.trees = [];
        this.rocks = [];
        this.weatherSystem = null;
        this.sun = null;
        this.moon = null;
        this.stars = null;
        
        // Initialize world
        this.init();
    }

    async init() {
        try {
            // Create terrain
            await this.createTerrain();
            
            // Create skybox
            this.createSkybox();
            
            // Create water
            this.createWater();
            
            // Add environment objects
            this.populateEnvironment();
            
            // Setup day/night cycle
            this.setupDayNightCycle();
            
            console.log('World initialized');
        } catch (error) {
            console.error('Error initializing world:', error);
        }
    }

    async createTerrain() {
        // Create ground
        this.ground = BABYLON.MeshBuilder.CreateGround('ground', {
            width: CONFIG.WORLD.TERRAIN.WIDTH,
            height: CONFIG.WORLD.TERRAIN.HEIGHT,
            subdivisions: CONFIG.WORLD.TERRAIN.SUBDIVISIONS,
            updatable: true
        }, this.scene);
        
        // Enable physics
        this.ground.checkCollisions = true;
        this.ground.receiveShadows = true;
        
        // Create material
        const material = new BABYLON.StandardMaterial('groundMaterial', this.scene);
        
        // Create procedural texture for ground
        const groundTexture = new BABYLON.NoiseProceduralTexture('groundNoise', 256, this.scene);
        groundTexture.animationSpeedFactor = 0;
        groundTexture.persistence = 0.2;
        groundTexture.brightness = 0.7;
        groundTexture.octaves = 4;
        
        // Create grass texture
        const grassTexture = this.createProceduralGrassTexture(512);
        material.diffuseTexture = grassTexture;
        material.diffuseTexture.uScale = material.diffuseTexture.vScale = 20;
        
        // Add bump map
        material.bumpTexture = groundTexture;
        material.bumpTexture.level = 0.2;
        
        // Set material properties
        material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        material.specularPower = 10;
        
        // Apply material
        this.ground.material = material;
        
        // Add physics
        this.ground.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.ground,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { mass: 0, restitution: 0.2, friction: 0.8 },
            this.scene
        );
        
        // Generate height map
        this.generateHeightMap();
    }

    createProceduralGrassTexture(size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, size);
        gradient.addColorStop(0, '#2c5e1a');
        gradient.addColorStop(0.4, '#3a7d24');
        gradient.addColorStop(0.6, '#4c9a2a');
        gradient.addColorStop(1, '#5cb85c');
        
        // Fill with gradient
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        
        // Add noise for variation
        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            // Add subtle noise
            const noise = Math.random() * 30 - 15;
            data[i] = Math.min(255, Math.max(0, data[i] + noise));     // R
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise)); // G
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise)); // B
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        // Create texture from canvas
        return new BABYLON.Texture(canvas.toDataURL(), this.scene);
    }

    generateHeightMap() {
        // Generate height data
        const positions = this.ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            
            // Generate height using multiple noise functions
            let height = 0;
            
            // Large scale terrain features
            height += this.simplexNoise(x * 0.01, z * 0.01) * 10;
            
            // Medium scale details
            height += this.simplexNoise(x * 0.05, z * 0.05) * 3;
            
            // Small details
            height += this.simplexNoise(x * 0.2, z * 0.2) * 0.5;
            
            // Apply height
            positions[i + 1] = height;
        }
        
        // Update ground mesh
        this.ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        
        // Update normals for lighting
        this.ground.updateVerticesData(BABYLON.VertexBuffer.NormalKind, null);
    }

    simplexNoise(x, y) {
        // Simple 2D simplex noise implementation
        const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
        const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
        
        const s = (x + y) * F2;
        const i = Math.floor(x + s);
        const j = Math.floor(y + s);
        
        const t = (i + j) * G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = x - X0;
        const y0 = y - Y0;
        
        let i1, j1;
        if (x0 > y0) {
            i1 = 1;
            j1 = 0;
        } else {
            i1 = 0;
            j1 = 1;
        }
        
        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + 2.0 * G2;
        const y2 = y0 - 1.0 + 2.0 * G2;
        
        // Random gradient at each corner
        const n0 = this.grad(i, j, x0, y0);
        const n1 = this.grad(i + i1, j + j1, x1, y1);
        const n2 = this.grad(i + 1, j + 1, x2, y2);
        
        // Combine contributions
        let value = 0.5 * (n0 + n1 + n2);
        return Math.max(-1, Math.min(1, value));
    }

    grad(hash, x, y) {
        const h = hash & 15;
        const grad = 1 + (h & 7);
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : 0);
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    createSkybox() {
        // Create procedural skybox
        const skybox = BABYLON.MeshBuilder.CreateBox('skyBox', { size: 1000 }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial('skyBox', this.scene);
        
        // Create gradient texture for sky
        const skyTexture = this.createSkyGradientTexture(512, 256);
        skyboxMaterial.reflectionTexture = skyTexture;
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        skyboxMaterial.disableLighting = true;
        
        // Apply material
        skybox.material = skyboxMaterial;
        skybox.infiniteDistance = true;
        
        this.skybox = skybox;
    }

    createSkyGradientTexture(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(0.4, '#16213e');
        gradient.addColorStop(0.6, '#0f3460');
        gradient.addColorStop(0.8, '#533483');
        gradient.addColorStop(1, '#e94560');
        
        // Fill with gradient
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        
        // Add stars
        this.addStarsToSky(ctx, width, height, 200);
        
        // Add sun/moon
        this.addCelestialBodies(ctx, width, height);
        
        // Create texture from canvas
        return new BABYLON.Texture(canvas.toDataURL(), this.scene);
    }

    addStarsToSky(ctx, width, height, count) {
        ctx.fillStyle = '#ffffff';
        
        for (let i = 0; i < count; i++) {
            const x = Math.random() * width;
            const y = Math.random() * (height * 0.8); // Only in upper part
            const size = Math.random() * 1.5;
            
            // Make some stars brighter
            const opacity = Math.random() * 0.8 + 0.2;
            ctx.globalAlpha = opacity;
            
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.globalAlpha = 1.0;
    }

    addCelestialBodies(ctx, width, height) {
        // Draw sun
        const sunX = width * 0.7;
        const sunY = height * 0.3;
        const sunRadius = 30;
        
        const sunGradient = ctx.createRadialGradient(
            sunX, sunY, 0,
            sunX, sunY, sunRadius * 2
        );
        sunGradient.addColorStop(0, 'rgba(255, 255, 200, 0.8)');
        sunGradient.addColorStop(0.6, 'rgba(255, 200, 100, 0.6)');
        sunGradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
        
        ctx.fillStyle = sunGradient;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunRadius * 2, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw moon
        const moonX = width * 0.3;
        const moonY = height * 0.2;
        const moonRadius = 15;
        
        ctx.fillStyle = '#f0f0f0';
        ctx.beginPath();
        ctx.arc(moonX, moonY, moonRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    createWater() {
        // Create water mesh
        this.water = BABYLON.MeshBuilder.CreateGround('water', {
            width: CONFIG.WORLD.TERRAIN.WIDTH * 1.5,
            height: CONFIG.WORLD.TERRAIN.HEIGHT * 1.5,
            subdivisions: 1
        }, this.scene);
        
        // Position water slightly below ground level
        this.water.position.y = -1;
        
        // Create water material
        const waterMaterial = new BABYLON.StandardMaterial('waterMaterial', this.scene);
        waterMaterial.alpha = 0.8;
        waterMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.8);
        waterMaterial.specularColor = new BABYLON.Color3(0.8, 0.9, 1.0);
        waterMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.2, 0.3);
        waterMaterial.alpha = 0.8;
        
        // Add bump texture for waves
        const noiseTexture = new BABYLON.NoiseProceduralTexture('waterNoise', 256, this.scene);
        noiseTexture.animationSpeedFactor = 0.1;
        noiseTexture.persistence = 0.2;
        waterMaterial.bumpTexture = noiseTexture;
        waterMaterial.bumpTexture.level = 0.5;
        
        // Apply material
        this.water.material = waterMaterial;
    }

    populateEnvironment() {
        // Add trees
        this.addTrees(50);
        
        // Add rocks
        this.addRocks(30);
    }

    addTrees(count) {
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * CONFIG.WORLD.TERRAIN.WIDTH * 0.9;
            const z = (Math.random() - 0.5) * CONFIG.WORLD.TERRAIN.HEIGHT * 0.9;
            
            // Get height at position
            const ray = new BABYLON.Ray(
                new BABYLON.Vector3(x, 100, z),
                new BABYLON.Vector3(0, -1, 0),
                200
            );
            
            const hit = this.scene.pickWithRay(ray);
            if (hit.pickedPoint) {
                const height = hit.pickedPoint.y;
                
                // Only place trees above water level
                if (height > 0) {
                    const tree = this.createTree(x, height, z);
                    this.trees.push(tree);
                }
            }
        }
    }

    createTree(x, y, z) {
        // Create trunk
        const trunk = BABYLON.MeshBuilder.CreateCylinder('trunk', {
            height: 2 + Math.random() * 2,
            diameterBottom: 0.5,
            diameterTop: 0.3
        }, this.scene);
        
        // Position trunk
        trunk.position.set(x, y + 1, z);
        
        // Create leaves
        const leaves = BABYLON.MeshBuilder.CreateSphere('leaves', {
            diameter: 3 + Math.random() * 2,
            segments: 8
        }, this.scene);
        
        // Position leaves above trunk
        leaves.position.set(x, y + 3 + Math.random(), z);
        
        // Create materials
        const trunkMaterial = new BABYLON.StandardMaterial('trunkMaterial', this.scene);
        trunkMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.1);
        
        const leavesMaterial = new BABYLON.StandardMaterial('leavesMaterial', this.scene);
        leavesMaterial.diffuseColor = new BABYLON.Color3(
            0.1 + Math.random() * 0.2,
            0.4 + Math.random() * 0.3,
            0.1 + Math.random() * 0.2
        );
        
        // Apply materials
        trunk.material = trunkMaterial;
        leaves.material = leavesMaterial;
        
        // Group trunk and leaves
        const tree = new BABYLON.TransformNode('tree');
        trunk.parent = tree;
        leaves.parent = tree;
        
        return tree;
    }

    addRocks(count) {
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * CONFIG.WORLD.TERRAIN.WIDTH * 0.9;
            const z = (Math.random() - 0.5) * CONFIG.WORLD.TERRAIN.HEIGHT * 0.9;
            
            // Get height at position
            const ray = new BABYLON.Ray(
                new BABYLON.Vector3(x, 100, z),
                new BABYLON.Vector3(0, -1, 0),
                200
            );
            
            const hit = this.scene.pickWithRay(ray);
            if (hit.pickedPoint) {
                const height = hit.pickedPoint.y;
                
                // Only place rocks above water level
                if (height > 0) {
                    const rock = this.createRock(x, height, z);
                    this.rocks.push(rock);
                }
            }
        }
    }

    createRock(x, y, z) {
        // Create rock
        const rock = BABYLON.MeshBuilder.CreateIcoSphere('rock', {
            radius: 0.5 + Math.random(),
            subdivisions: 2
        }, this.scene);
        
        // Position and rotate randomly
        rock.position.set(x, y, z);
        rock.rotation.x = Math.random() * Math.PI * 2;
        rock.rotation.y = Math.random() * Math.PI * 2;
        rock.rotation.z = Math.random() * Math.PI * 2;
        
        // Scale non-uniformly for more natural look
        rock.scaling.y = 0.5 + Math.random() * 0.5;
        rock.scaling.x = 0.7 + Math.random() * 0.6;
        rock.scaling.z = 0.7 + Math.random() * 0.6;
        
        // Create material
        const rockMaterial = new BABYLON.StandardMaterial('rockMaterial', this.scene);
        rockMaterial.diffuseColor = new BABYLON.Color3(
            0.3 + Math.random() * 0.3,
            0.3 + Math.random() * 0.3,
            0.3 + Math.random() * 0.3
        );
        rockMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        
        // Add bump map
        const noiseTexture = new BABYLON.NoiseProceduralTexture('rockNoise', 64, this.scene);
        noiseTexture.animationSpeedFactor = 0;
        rockMaterial.bumpTexture = noiseTexture;
        rockMaterial.bumpTexture.level = 0.5;
        
        // Apply material
        rock.material = rockMaterial;
        
        return rock;
    }

    setupDayNightCycle() {
        // Create sun
        this.sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -1, 1), this.scene);
        this.sun.position = new BABYLON.Vector3(0, 100, 0);
        this.sun.intensity = 1.0;
        this.sun.diffuse = new BABYLON.Color3(1, 1, 0.9);
        this.sun.specular = new BABYLON.Color3(1, 1, 0.8);
        
        // Create moon
        this.moon = new BABYLON.DirectionalLight('moon', new BABYLON.Vector3(1, -1, -1), this.scene);
        this.moon.position = new BABYLON.Vector3(0, 100, 0);
        this.moon.intensity = 0;
        this.moon.diffuse = new BABYLON.Color3(0.8, 0.8, 1.0);
        this.moon.specular = new BABYLON.Color3(0.1, 0.1, 0.2);
        
        // Create stars
        this.createStars();
    }

    createStars() {
        // Create starfield
        const starCount = 1000;
        const stars = new BABYLON.PointsCloudSystem('stars', 1, this.scene);
        
        // Add stars
        for (let i = 0; i < starCount; i++) {
            // Random position on a sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            
            const x = Math.sin(phi) * Math.cos(theta) * 500;
            const y = Math.sin(phi) * Math.sin(theta) * 500;
            const z = Math.cos(phi) * 500;
            
            // Random size and brightness
            const size = 0.1 + Math.random() * 0.5;
            const brightness = 0.5 + Math.random() * 0.5;
            
            stars.addPoints(1, {
                position: new BABYLON.Vector3(x, y, z),
                color: new BABYLON.Color4(brightness, brightness, brightness, 1),
                size: size
            });
        }
        
        // Build the starfield
        stars.buildMeshAsync().then(() => {
            this.stars = stars.mesh;
        });
    }

    update(deltaTime) {
        // Update day/night cycle
        this.updateDayNightCycle(deltaTime);
        
        // Update water animation
        if (this.water && this.water.material && this.water.material.bumpTexture) {
            this.water.material.bumpTexture.time += deltaTime * 0.01;
        }
    }

    updateDayNightCycle(deltaTime) {
        // Update time of day
        CONFIG.WORLD.TIME_OF_DAY = (CONFIG.WORLD.TIME_OF_DAY + deltaTime * CONFIG.WORLD.TIME_SPEED) % 1;
        
        // Calculate sun and moon positions
        const time = CONFIG.WORLD.TIME_OF_DAY;
        const angle = time * Math.PI * 2;
        
        // Update sun position
        this.sun.direction = new BABYLON.Vector3(
            Math.cos(angle),
            Math.sin(angle),
            Math.cos(angle) * 0.5
        ).normalize();
        
        // Update moon position (opposite of sun)
        this.moon.direction = this.sun.direction.negate();
        
        // Update lighting based on time of day
        const isDay = time > 0.2 && time < 0.8;
        const dayFactor = isDay ? 
            Math.sin((time - 0.25) * Math.PI * 2) * 0.5 + 0.5 : 
            0;
        
        const nightFactor = !isDay ? 
            Math.sin((time - 0.75) * Math.PI * 2) * 0.5 + 0.5 : 
            0;
        
        // Update light intensities
        this.sun.intensity = dayFactor * CONFIG.GRAPHICS.LIGHTING.SUN_INTENSITY;
        this.moon.intensity = nightFactor * 0.5;
        
        // Update ambient light
        const ambientIntensity = 0.3 + 0.7 * dayFactor + 0.1 * nightFactor;
        this.scene.ambientColor = new BABYLON.Color3(
            ambientIntensity * 0.6,
            ambientIntensity * 0.7,
            ambientIntensity
        );
        
        // Update fog
        const fogDensity = 0.001 + (1 - dayFactor) * 0.004;
        this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP;
        this.scene.fogDensity = fogDensity;
        this.scene.fogColor = new BABYLON.Color3(
            0.8 * (1 - nightFactor * 0.5),
            0.8 * (1 - nightFactor * 0.3),
            0.9 * (1 - nightFactor * 0.1)
        );
        
        // Update skybox visibility
        if (this.skybox) {
            this.skybox.visibility = 0.2 + dayFactor * 0.8;
        }
        
        // Update stars visibility
        if (this.stars) {
            this.stars.visibility = 1 - dayFactor;
        }
    }

    dispose() {
        // Clean up resources
        if (this.ground) {
            this.ground.dispose();
        }
        if (this.skybox) {
            this.skybox.dispose();
        }
        if (this.water) {
            this.water.dispose();
        }
        if (this.sun) {
            this.sun.dispose();
        }
        if (this.moon) {
            this.moon.dispose();
        }
        if (this.stars) {
            this.stars.dispose();
        }
        if (this.weatherSystem) {
            this.weatherSystem.dispose();
        }
        
        // Dispose trees
        this.trees.forEach(tree => tree.dispose());
        this.trees = [];
        
        // Dispose rocks
        this.rocks.forEach(rock => rock.dispose());
        this.rocks = [];
    }
}

// Make World class globally available
window.World = World;
