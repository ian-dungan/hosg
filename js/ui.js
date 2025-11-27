// UI Manager
class UIManager {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.player = game.player;
        
        // UI elements
        this.canvas = null;
        this.gui = null;
        this.healthBar = null;
        this.manaBar = null;
        this.staminaBar = null;
        this.minimap = null;
        this.inventoryUI = null;
        this.questLogUI = null;
        this.dialogueUI = null;
        this.hud = null;
        
        // State
        this.isInventoryOpen = false;
        this.isPaused = false;
        this.isInDialogue = false;
        this.currentDialogue = null;
        
        // Initialize
        this.init();
    }

    init() {
        // Get the canvas
        this.canvas = this.scene.getEngine().getRenderingCanvas();
        
        // Create GUI
        this.gui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
        
        // Create HUD
        this.createHUD();
        
        // Create inventory UI (initially hidden)
        this.createInventoryUI();
        
        // Create quest log UI (initially hidden)
        this.createQuestLogUI();
        
        // Create dialogue UI (initially hidden)
        this.createDialogueUI();
        
        // Create pause menu (initially hidden)
        this.createPauseMenu();
        
        // Event listeners
        this.setupEventListeners();
    }

    createHUD() {
        // Create a container for the HUD
        this.hud = new BABYLON.GUI.Rectangle('hud');
        this.hud.width = '100%';
        this.hud.height = '100%';
        this.hud.thickness = 0;
        this.hud.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hud.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.gui.addControl(this.hud);
        
        // Health bar
        this.healthBar = this.createStatusBar(
            'healthBar',
            'HP',
            new BABYLON.Color4(1, 0.2, 0.2, 1),
            200,
            20,
            10,
            10
        );
        this.hud.addControl(this.healthBar.container);
        
        // Mana bar
        this.manaBar = this.createStatusBar(
            'manaBar',
            'MP',
            new BABYLON.Color4(0.2, 0.5, 1, 1),
            200,
            20,
            10,
            40
        );
        this.hud.addControl(this.manaBar.container);
        
        // Stamina bar
        this.staminaBar = this.createStatusBar(
            'staminaBar',
            'SP',
            new BABYLON.Color4(0.2, 1, 0.2, 1),
            200,
            20,
            10,
            70
        );
        this.hud.addControl(this.staminaBar.container);
        
        // Mini-map
        this.createMinimap(150, 150, 10, 10);
    }

    createStatusBar(id, label, color, width, height, left, top) {
        const container = new BABYLON.GUI.Rectangle(`${id}Container`);
        container.width = `${width}px`;
        container.height = `${height + 20}px`;
        container.color = 'white';
        container.thickness = 1;
        container.background = '#222222';
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.left = `${left}px`;
        container.top = `${top}px`;
        
        // Label
        const labelText = new BABYLON.GUI.TextBlock(`${id}Label`, label);
        labelText.color = 'white';
        labelText.fontSize = 14;
        labelText.left = '5px';
        labelText.top = '0px';
        labelText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        labelText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.addControl(labelText);
        
        // Background
        const background = new BABYLON.GUI.Rectangle(`${id}Background`);
        background.width = '100%';
        background.height = `${height}px`;
        background.color = 'black';
        background.thickness = 0;
        background.background = '#444444';
        background.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        background.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        background.left = '0px';
        background.top = '20px';
        container.addControl(background);
        
        // Fill
        const fill = new BABYLON.GUI.Rectangle(`${id}Fill`);
        fill.width = '100%';
        fill.height = '100%';
        fill.color = 'transparent';
        fill.thickness = 0;
        fill.background = '#FF0000';
        fill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        fill.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        background.addControl(fill);
        
        // Value text
        const valueText = new BABYLON.GUI.TextBlock(`${id}Value`, '100/100');
        valueText.color = 'white';
        valueText.fontSize = 12;
        valueText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        valueText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        background.addControl(valueText);
        
        // Set initial color
        fill.background = `
