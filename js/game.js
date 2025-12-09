// ===========================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATOR
// ===========================================================

class Game {
    constructor(engine, scene, world, player, ui) {
        this.engine = engine;
        this.scene = scene;
        this.world = world;
        this.player = player;
        this.ui = ui;
        this._running = false;
        this.assetManager = null;
    }

    init() {
        console.log("[Game] Initialized.");
        if (this.ui) this.ui.showMessage("Welcome to Heroes of Shady Grove!", 5000);
    }

    run() {
        this._running = true;
        this.engine.runRenderLoop(() => {
            if (!this._running) return;
            
            const deltaTime = this.engine.getDeltaTime() / 1000;

            if (this.player) this.player.update(deltaTime);
            if (this.world) this.world.update(deltaTime);
            if (this.ui && this.player) this.ui.update(this.player);

            this.scene.render();
        });
    }
}
window.Game = Game;
