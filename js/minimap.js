// minimap.js - Procedural minimap system
class MiniMap {
    constructor(scene, player, world) {
        this.scene = scene;
        this.player = player;
        this.world = world;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.texture = null;
        this.plane = null;
        this.init();
    }

    init() {
        // Create minimap canvas
        this.canvas.width = 256;
        this.canvas.height = 256;
        
        // Create a plane for the minimap
        this.plane = BABYLON.MeshBuilder.CreatePlane('minimap', {
            width: 5,
            height: 5
        }, this.scene);
        
        // Position the minimap in the top-right corner
        this.plane.position = new BABYLON.Vector3(7, 5, 0);
        this.plane.rotation = new BABYLON.Vector3(Math.PI / 2, 0, 0);
        
        // Create a material for the minimap
        const material = new BABYLON.StandardMaterial('minimapMaterial', this.scene);
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        material.disableLighting = true;
        material.backFaceCulling = false;
        
        // Create a dynamic texture from canvas
        this.texture = new BABYLON.DynamicTexture('minimapTexture', {
            width: this.canvas.width,
            height: this.canvas.height
        }, this.scene);
        
        material.diffuseTexture = this.texture;
        this.plane.material = material;
        
        // Draw initial minimap
        this.drawMinimap();
    }

    drawMinimap() {
        const ctx = this.ctx;
        const size = this.canvas.width;
        const halfSize = size / 2;
        
        // Clear canvas
        ctx.clearRect(0, 0, size, size);
        
        // Draw background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, size, size);
        
        // Draw grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        
        const gridSize = 10;
        const cellSize = size / gridSize;
        
        for (let i = 0; i <= gridSize; i++) {
            // Vertical line
            ctx.beginPath();
            ctx.moveTo(i * cellSize, 0);
            ctx.lineTo(i * cellSize, size);
            ctx.stroke();
            
            // Horizontal line
            ctx.beginPath();
            ctx.moveTo(0, i * cellSize);
            ctx.lineTo(size, i * cellSize);
            ctx.stroke();
        }
        
        // Draw player position (center of minimap)
        ctx.fillStyle = '#FF0000';
        ctx.beginPath();
        ctx.arc(halfSize, halfSize, 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw player direction
        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(halfSize, halfSize);
        ctx.lineTo(
            halfSize + Math.sin(-this.player.mesh.rotation.y) * 20,
            halfSize + Math.cos(-this.player.mesh.rotation.y) * 20
        );
        ctx.stroke();
        
        // Update the texture
        this.texture.update();
    }

    update() {
        this.drawMinimap();
    }

    dispose() {
        if (this.plane) {
            this.plane.dispose();
        }
        if (this.texture) {
            this.texture.dispose();
        }
    }
}

// Make MiniMap globally available
window.MiniMap = MiniMap;
