// ===========================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATOR v1.0.1 (FIXED)
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
        this.skillTemplates = new Map();
        this.npcTemplates = new Map();
    }

    init() {
        console.log("[Game] Initialized.");
        if (this.ui) {
            this.ui.showMessage("Welcome to Heroes of Shady Grove!", 3000, 'info');
        }
    }

    run() {
        this._running = true;
        this.engine.runRenderLoop(() => {
            if (!this._running) return;
            
            const deltaTime = this.engine.getDeltaTime() / 1000;

            if (this.player && !this.player.isDead) {
                this.player.update(deltaTime);
            }
            
            if (this.world) {
                this.world.update(deltaTime);
            }
            
            if (this.ui && this.player) {
                this.ui.update(this.player);
            }

            this.scene.render();
        });
    }
    
    stop() {
        this._running = false;
    }
}
window.Game = Game;
