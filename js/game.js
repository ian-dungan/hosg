// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.16 (ES5 SAFE)
// Converted to ES5 syntax to avoid class/arrow parse issues in
// legacy browsers while preserving run/render loop behavior.
// ============================================================

function Game(engine, scene, world, player, ui) {
    this.engine = engine;
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.ui = ui;
    this._running = false;
    this._lastFrameTime = 0;
}

Game.prototype.init = function () {
    console.log('[Bootstrap] Game components successfully initialized.');
};

Game.prototype.run = function () {
    if (!this.engine || !this.scene) {
        console.error('[Game] Cannot run: engine or scene missing.');
        return;
    }

    var self = this;
    this._running = true;
    this._lastFrameTime = performance.now();

    this.engine.runRenderLoop(function () {
        var currentTime = performance.now();
        var deltaTime = (currentTime - self._lastFrameTime) / 1000;
        self._lastFrameTime = currentTime;

        if (!self._running) return;

        if (self.player && typeof self.player.update === 'function') self.player.update(deltaTime);
        if (self.world && typeof self.world.update === 'function') self.world.update(deltaTime);
        if (self.ui && typeof self.ui.update === 'function') self.ui.update(self.player);

        if (self.scene && typeof self.scene.render === 'function') {
            self.scene.render();
        }
    });

    if (this.ui && typeof this.ui.showMessage === 'function') {
        this.ui.showMessage('Welcome to Heroes of Shady Grove! (Persistence Active)', 3000);
    }
};

// Optional stop helper for completeness
Game.prototype.stop = function () {
    this._running = false;
};

window.Game = Game;

