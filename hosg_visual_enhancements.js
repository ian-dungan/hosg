// ============================================================
// HEROES OF SHADY GROVE - VISUAL ENHANCEMENTS v2.0
// Advanced lighting, particles, and post-processing
// Upload this file to GitHub as: hosg_visual_enhancements.js
// ============================================================

class VisualEnhancer {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.pipeline = null;
  }

  initializeEnhancements() {
    this.setupRenderingPipeline();
    this.setupDynamicLighting();
    this.setupVolumetrics();
    this.createAmbientParticles();
  }

  setupRenderingPipeline() {
    this.pipeline = new BABYLON.DefaultRenderingPipeline("default", true, this.scene, [this.camera]);

    this.pipeline.samples = 4;
    this.pipeline.fxaaEnabled = true;

    this.pipeline.bloomEnabled = true;
    this.pipeline.bloomThreshold = 0.7;
    this.pipeline.bloomWeight = 0.4;
    this.pipeline.bloomKernel = 64;
    this.pipeline.bloomScale = 0.5;

    this.pipeline.imageProcessingEnabled = true;
    this.pipeline.imageProcessing.contrast = 1.2;
    this.pipeline.imageProcessing.exposure = 1.1;
    this.pipeline.imageProcessing.toneMappingEnabled = true;
    this.pipeline.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;

    this.pipeline.imageProcessing.vignetteEnabled = true;
    this.pipeline.imageProcessing.vignetteWeight = 1.5;
    this.pipeline.imageProcessing.vignetteStretch = 0.5;
    this.pipeline.imageProcessing.vignetteCameraFov = 0.8;

    this.pipeline.sharpenEnabled = true;
    this.pipeline.sharpen.edgeAmount = 0.3;

    console.log("[Visuals] Rendering pipeline initialized");
  }

  setupDynamicLighting() {
    const scene = this.scene;
    if (scene.lights) {
      scene.lights.forEach(light => {
        if (light.name === 'sun') {
          light.intensity = 1.2;
          light.shadowMinZ = 1;
          light.shadowMaxZ = 500;
        }
      });
    }

    const hemi = scene.lights.find(l => l.name === 'hemi');
    if (hemi) {
      hemi.intensity = 0.7;
      hemi.groundColor = new BABYLON.Color3(0.3, 0.25, 0.2);
    }
  }

  setupVolumetrics() {
    const scene = this.scene;
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.001;
    scene.fogColor = new BABYLON.Color3(0.85, 0.88, 0.95);
  }

  createAmbientParticles() {
    const scene = this.scene;
    const particles = new BABYLON.ParticleSystem("ambient", 1000, scene);
    particles.particleTexture = new BABYLON.Texture("https://assets.babylonjs.com/textures/flare.png", scene);
    
    particles.minSize = 0.1;
    particles.maxSize = 0.3;
    particles.minLifeTime = 5;
    particles.maxLifeTime = 10;
    particles.emitRate = 20;
    particles.createSphereEmitter(200);
    particles.color1 = new BABYLON.Color4(1, 1, 0.8, 0.3);
    particles.color2 = new BABYLON.Color4(1, 1, 1, 0.1);
    particles.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    particles.minEmitPower = 0.1;
    particles.maxEmitPower = 0.3;
    particles.updateSpeed = 0.01;
    particles.start();
    
    return particles;
  }

  createWeatherEffect(type) {
    const scene = this.scene;
    let particles;
    
    switch (type) {
      case 'rain': particles = this.createRain(); break;
      case 'snow': particles = this.createSnow(); break;
      case 'ash': particles = this.createAsh(); break;
      case 'sparkles': particles = this.createSparkles(); break;
      default: return null;
    }
    
    return particles;
  }

  createRain() {
    const scene = this.scene;
    const rain = new BABYLON.ParticleSystem("rain", 5000, scene);
    rain.particleTexture = new BABYLON.Texture("https://assets.babylonjs.com/textures/flare.png", scene);
    rain.minSize = 0.1;
    rain.maxSize = 0.2;
    rain.minLifeTime = 0.5;
    rain.maxLifeTime = 1;
    rain.emitRate = 1000;
    rain.createBoxEmitter(new BABYLON.Vector3(-100, 0, -1), new BABYLON.Vector3(100, 0, 1),
      new BABYLON.Vector3(-100, 50, -100), new BABYLON.Vector3(100, 50, 100));
    rain.color1 = new BABYLON.Color4(0.6, 0.6, 0.8, 0.6);
    rain.color2 = new BABYLON.Color4(0.7, 0.7, 0.9, 0.3);
    rain.gravity = new BABYLON.Vector3(0, -50, 0);
    rain.start();
    return rain;
  }

  createSnow() {
    const scene = this.scene;
    const snow = new BABYLON.ParticleSystem("snow", 3000, scene);
    snow.particleTexture = new BABYLON.Texture("https://assets.babylonjs.com/textures/flare.png", scene);
    snow.minSize = 0.3;
    snow.maxSize = 0.8;
    snow.minLifeTime = 5;
    snow.maxLifeTime = 10;
    snow.emitRate = 300;
    snow.createBoxEmitter(new BABYLON.Vector3(-1, 0, -1), new BABYLON.Vector3(1, 0, 1),
      new BABYLON.Vector3(-100, 80, -100), new BABYLON.Vector3(100, 80, 100));
    snow.color1 = new BABYLON.Color4(1, 1, 1, 0.8);
    snow.color2 = new BABYLON.Color4(0.95, 0.95, 1, 0.5);
    snow.gravity = new BABYLON.Vector3(0, -2, 0);
    snow.start();
    return snow;
  }

  createAsh() {
    const scene = this.scene;
    const ash = new BABYLON.ParticleSystem("ash", 2000, scene);
    ash.particleTexture = new BABYLON.Texture("https://assets.babylonjs.com/textures/flare.png", scene);
    ash.minSize = 0.2;
    ash.maxSize = 0.6;
    ash.minLifeTime = 8;
    ash.maxLifeTime = 15;
    ash.emitRate = 150;
    ash.createBoxEmitter(new BABYLON.Vector3(-1, 0, -1), new BABYLON.Vector3(1, 0, 1),
      new BABYLON.Vector3(-100, 60, -100), new BABYLON.Vector3(100, 60, 100));
    ash.color1 = new BABYLON.Color4(0.3, 0.3, 0.3, 0.6);
    ash.color2 = new BABYLON.Color4(0.2, 0.2, 0.2, 0.3);
    ash.gravity = new BABYLON.Vector3(0, -0.5, 0);
    ash.start();
    return ash;
  }

  createSparkles() {
    const scene = this.scene;
    const sparkles = new BABYLON.ParticleSystem("sparkles", 500, scene);
    sparkles.particleTexture = new BABYLON.Texture("https://assets.babylonjs.com/textures/flare.png", scene);
    sparkles.minSize = 0.3;
    sparkles.maxSize = 1;
    sparkles.minLifeTime = 2;
    sparkles.maxLifeTime = 5;
    sparkles.emitRate = 50;
    sparkles.createSphereEmitter(150);
    sparkles.color1 = new BABYLON.Color4(0.8, 0.6, 1, 0.8);
    sparkles.color2 = new BABYLON.Color4(0.6, 0.8, 1, 0.3);
    sparkles.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    sparkles.minEmitPower = 0.2;
    sparkles.maxEmitPower = 0.5;
    sparkles.start();
    return sparkles;
  }

  adjustForBiome(biome) {
    const scene = this.scene;
    const biomeConfigs = {
      grassland: { fogDensity: 0.0005, fogColor: new BABYLON.Color3(0.85, 0.88, 0.92), hemiIntensity: 0.7, sunIntensity: 1.2 },
      forest: { fogDensity: 0.002, fogColor: new BABYLON.Color3(0.7, 0.8, 0.75), hemiIntensity: 0.5, sunIntensity: 0.9 },
      desert: { fogDensity: 0.0003, fogColor: new BABYLON.Color3(0.95, 0.9, 0.8), hemiIntensity: 0.8, sunIntensity: 1.4 },
      snow: { fogDensity: 0.001, fogColor: new BABYLON.Color3(0.9, 0.9, 0.95), hemiIntensity: 0.9, sunIntensity: 1.1 },
      swamp: { fogDensity: 0.003, fogColor: new BABYLON.Color3(0.65, 0.7, 0.65), hemiIntensity: 0.4, sunIntensity: 0.7 },
      volcanic: { fogDensity: 0.002, fogColor: new BABYLON.Color3(0.5, 0.4, 0.4), hemiIntensity: 0.5, sunIntensity: 0.8 },
      corrupted: { fogDensity: 0.0025, fogColor: new BABYLON.Color3(0.5, 0.4, 0.6), hemiIntensity: 0.3, sunIntensity: 0.6 }
    };
    
    const config = biomeConfigs[biome] || biomeConfigs.grassland;
    scene.fogDensity = config.fogDensity;
    scene.fogColor = config.fogColor;
    
    const hemi = scene.lights.find(l => l.name === 'hemi');
    if (hemi) hemi.intensity = config.hemiIntensity;
    
    const sun = scene.lights.find(l => l.name === 'sun');
    if (sun) sun.intensity = config.sunIntensity;
  }

  setTimeOfDay(hour) {
    const scene = this.scene;
    const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    const sun = scene.lights.find(l => l.name === 'sun');
    
    if (sun) {
      sun.direction = new BABYLON.Vector3(Math.cos(angle), -Math.sin(angle), -0.3);
      
      if (hour >= 6 && hour <= 18) {
        sun.intensity = 1.2;
        scene.clearColor = new BABYLON.Color3(0.5, 0.7, 0.9);
      } else {
        sun.intensity = 0.2;
        scene.clearColor = new BABYLON.Color3(0.05, 0.05, 0.15);
      }
    }
  }

  createMagicCircle(position, radius, color) {
    const scene = this.scene;
    const circle = BABYLON.MeshBuilder.CreateDisc("magicCircle", { radius: radius, tessellation: 64 }, scene);
    circle.position = position.clone();
    circle.position.y = 0.1;
    circle.rotation.x = Math.PI / 2;
    
    const mat = new BABYLON.StandardMaterial("magicCircleMat", scene);
    mat.emissiveColor = color;
    mat.alpha = 0.6;
    circle.material = mat;
    
    let time = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      time += scene.getEngine().getDeltaTime() / 1000;
      circle.rotation.y = time;
      mat.alpha = 0.4 + Math.sin(time * 3) * 0.2;
      
      if (time > 3) {
        scene.onBeforeRenderObservable.remove(obs);
        circle.dispose();
      }
    });
    
    return circle;
  }
}

window.VisualEnhancer = VisualEnhancer;
console.log("[Visuals] Visual enhancer loaded");
