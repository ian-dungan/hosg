createSkybox() {
        const skyboxConfig = CONFIG.WORLD.SKYBOX;
        if (skyboxConfig.PATH) {
            const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: skyboxConfig.SIZE }, this.scene);
            const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
            skyboxMaterial.backFaceCulling = false;
            skyboxMaterial.disableLighting = true;
            skybox.material = skyboxMaterial;
            skybox.infiniteDistance = true;
            skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture(skyboxConfig.PATH, this.scene);
            skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        }
        
        // Setup PBR Environment
        const envTexturePath = CONFIG.ASSETS.BASE_PATH + "textures/environment/ibl/room.env";
        
        // CRITICAL FIX: Use the correct method for loading .env files
        const hdrTexture = BABYLON.CubeTexture.CreateFromPrefilteredData(envTexturePath, this.scene);
        
        this.scene.environmentTexture = hdrTexture;
        this.scene.imageProcessingConfiguration.exposure = skyboxConfig.EXPOSURE;
        this.scene.imageProcessingConfiguration.contrast = skyboxConfig.CONTRAST;
    }
