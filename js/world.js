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

    // ... rest of the World class methods ...
}

// Make World class globally available
window.World = World;
