// In your Game class, update the init method:
async init() {
    try {
        // Setup camera
        this.setupCamera();
        
        // Setup lighting
        this.setupLighting();
        
        // Create skybox
        this.world.createSkybox();
        
        // Load any additional assets
        await this.loadAssets();
        
        // Start the game loop
        this.engine.runRenderLoop(() => this.update());
        
        // Handle window resize
        window.addEventListener('resize', () => this.engine.resize());
        
        console.log('Game initialized successfully');
    } catch (error) {
        console.error('Error initializing game:', error);
    }
}

// Update the setupLighting method to better suit the outdoor scene
setupLighting() {
    // Hemispheric light to simulate sky light
    const hemiLight = new BABYLON.HemisphericLight(
        'hemiLight',
        new BABYLON.Vector3(0, 1, 0),
        this.scene
    );
    hemiLight.intensity = 0.8;
    hemiLight.specular = new BABYLON.Color3(0, 0, 0); // No specular from hemi light
    
    // Directional light to simulate sun
    this.sunLight = new BABYLON.DirectionalLight(
        'sunLight',
        new BABYLON.Vector3(1, -1, 1),
        this.scene
    );
    this.sunLight.intensity = 0.9;
    this.sunLight.position = new BABYLON.Vector3(0, 50, 0);
    
    // Enable shadows
    this.sunLight.shadowEnabled = true;
    const shadowGenerator = new BABYLON.ShadowGenerator(1024, this.sunLight);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 32;
}
