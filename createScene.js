function createScene() {
    // Create a basic scene
    const canvas = document.getElementById("renderCanvas");
    const engine = new BABYLON.Engine(canvas, true);
    const scene = new BABYLON.Scene(engine);

    // Add a camera
    const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 10, BABYLON.Vector3.Zero(), scene);
    camera.attachControl(canvas, true);

    // Add a light
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    // Add a ground
    const ground = BABYLON.MeshBuilder.CreateGround("ground", {width: 10, height: 10}, scene);

    // Run the render loop
    engine.runRenderLoop(function() {
        scene.render();
    });

    // Handle resize
    window.addEventListener('resize', function() {
        engine.resize();
    });

    return scene;
}

// Make it globally available
window.createScene = createScene;
