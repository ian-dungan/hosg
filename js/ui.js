// UI System
class UIManager {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.player = game.player;
        this.elements = {};
        
        this.init();
    }

    init() {
        this.createHUD();
        this.createInventoryUI();
        this.createQuestLogUI();
        this.setupEventListeners();
    }

    createHUD() {
        // Create a fullscreen UI
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");
        
        // Health bar
        const healthBar = new BABYLON.GUI.Rectangle();
        healthBar.width = "200px";
        healthBar.height = "20px";
        healthBar.color = "white";
        healthBar.thickness = 2;
        healthBar.background = "red";
        healthBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthBar.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        healthBar.left = "20px";
        healthBar.top = "-20px";
        
        // Health text
        const healthText = new BABYLON.GUI.TextBlock();
        healthText.text = "Health: 100/100";
        healthText.color = "white";
        healthText.fontSize = 14;
        healthText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        healthText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        healthBar.addControl(healthText);
        
        // Add to UI
        advancedTexture.addControl(healthBar);
        
        // Store references
        this.elements.healthBar = healthBar;
        this.elements.healthText = healthText;
        
        // Add other HUD elements (mana, stamina, etc.) in a similar way
    }

    createInventoryUI() {
        // Create inventory panel (initially hidden)
        const inventoryPanel = new BABYLON.GUI.Rectangle();
        inventoryPanel.width = "400px";
        inventoryPanel.height = "300px";
        inventoryPanel.color = "white";
        inventoryPanel.thickness = 2;
        inventoryPanel.background = "rgba(0, 0, 0, 0.7)";
        inventoryPanel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        inventoryPanel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        inventoryPanel.isVisible = false;
        
        // Add title
        const title = new BABYLON.GUI.TextBlock();
        title.text = "INVENTORY";
        title.color = "white";
        title.fontSize = 24;
        title.top = "-130px";
        inventoryPanel.addControl(title);
        
        // Add close button
        const closeButton = BABYLON.GUI.Button.CreateSimpleButton("closeButton", "X");
        closeButton.width = "30px";
        closeButton.height = "30px";
        closeButton.color = "white";
        closeButton.background = "red";
        closeButton.cornerRadius = 15;
        closeButton.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        closeButton.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        closeButton.left = "-15px";
        closeButton.top = "15px";
        closeButton.onPointerClickObservable.add(() => {
            inventoryPanel.isVisible = false;
        });
        inventoryPanel.addControl(closeButton);
        
        // Add to UI
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.GetFullscreenUI();
        advancedTexture.addControl(inventoryPanel);
        
        // Store reference
        this.elements.inventoryPanel = inventoryPanel;
    }

    createQuestLogUI() {
        // Similar to inventory UI, create a quest log panel
        // This is a simplified version
        const questPanel = new BABYLON.GUI.Rectangle();
        questPanel.width = "300px";
        questPanel.height = "400px";
        questPanel.color = "white";
        questPanel.thickness = 2;
        questPanel.background = "rgba(0, 0, 0, 0.7)";
        questPanel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        questPanel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        questPanel.top = "50px";
        questPanel.right = "10px";
        questPanel.isVisible = false;
        
        // Add title
        const title = new BABYLON.GUI.TextBlock();
        title.text = "QUESTS";
        title.color = "white";
        title.fontSize = 20;
        title.top = "-180px";
        questPanel.addControl(title);
        
        // Add to UI
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.GetFullscreenUI();
        advancedTexture.addControl(questPanel);
        
        // Store reference
        this.elements.questPanel = questPanel;
    }

    setupEventListeners() {
        // Toggle inventory with 'I' key
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'i') {
                this.toggleInventory();
            } else if (e.key.toLowerCase() === 'l') {
                this.toggleQuestLog();
            }
        });
    }

    toggleInventory() {
        const panel = this.elements.inventoryPanel;
        panel.isVisible = !panel.isVisible;
    }

    toggleQuestLog() {
        const panel = this.elements.questPanel;
        panel.isVisible = !panel.isVisible;
    }

    update() {
        // Update HUD elements
        if (this.player) {
            // Update health
            const healthPercent = (this.player.health / this.player.stats.maxHealth) * 100;
            this.elements.healthBar.width = `${healthPercent * 2}px`;
            this.elements.healthText.text = `Health: ${Math.ceil(this.player.health)}/${this.player.stats.maxHealth}`;
            
            // Update other stats as needed
        }
    }
}

// Crosshair
function createCrosshair(scene) {
    const crosshair = new BABYLON.GUI.Ellipse();
    crosshair.width = "10px";
    crosshair.height = "10px";
    crosshair.color = "white";
    crosshair.thickness = 2;
    
    const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.GetFullscreenUI();
    advancedTexture.addControl(crosshair);
    
    return crosshair;
}
