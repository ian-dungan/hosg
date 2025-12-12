// ============================================================
// HEROES OF SHADY GROVE - GM COMMANDS SYSTEM
// In-game admin tools for spawning, moving, and editing
// ============================================================

class GMCommands {
    constructor(game) {
        this.game = game;
        this.enabled = false;
        this.selectedEntity = null;
        this.dragMode = false;
        this.showGrid = false;
        this.showCoords = true;
        
        // GM-specific UI elements
        this.coordsLabel = null;
        this.selectionBox = null;
        this.gridMesh = null;
        
        // Command history
        this.commandHistory = [];
        this.historyIndex = -1;
        
        this.init();
    }
    
    init() {
        console.log('[GM] Commands system initialized');
        this.checkPermissions();
        this.setupUI();
        this.setupKeyBinds();
    }
    
    // ==================== PERMISSIONS ====================
    
    checkPermissions() {
        // Check if current account is a GM
        if (!window.supabaseService || !window.supabaseService.currentAccount) {
            this.enabled = false;
            return;
        }
        
        const account = window.supabaseService.currentAccount;
        
        // TODO: Add is_gm column to hosg_accounts table
        // For now, enable for specific usernames
        const gmUsernames = ['admin', 'gm', 'ian']; // Add your username here!
        
        if (gmUsernames.includes(account.username.toLowerCase())) {
            this.enabled = true;
            console.log('[GM] ✓ GM mode enabled for', account.username);
            this.showWelcomeMessage();
        } else {
            this.enabled = false;
            console.log('[GM] GM mode not available for this account');
        }
    }
    
    showWelcomeMessage() {
        if (this.game.ui) {
            this.game.ui.showMessage('🛠️ GM Mode Active - Type /help for commands', 5000, 'info');
        }
    }
    
    // ==================== UI SETUP ====================
    
    setupUI() {
        if (!this.enabled) return;
        
        // Create coordinate display
        this.createCoordsDisplay();
        
        // Create GM panel
        this.createGMPanel();
    }
    
    createCoordsDisplay() {
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("gmUI");
        
        // Coordinates label (top-right)
        this.coordsLabel = new BABYLON.GUI.TextBlock();
        this.coordsLabel.text = "X: 0.0, Y: 0.0, Z: 0.0";
        this.coordsLabel.color = "lime";
        this.coordsLabel.fontSize = 14;
        this.coordsLabel.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.coordsLabel.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.coordsLabel.top = "10px";
        this.coordsLabel.left = "-10px";
        advancedTexture.addControl(this.coordsLabel);
    }
    
    createGMPanel() {
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("gmPanel");
        
        // GM Panel (left side)
        const panel = new BABYLON.GUI.StackPanel();
        panel.width = "200px";
        panel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        panel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        panel.top = "100px";
        panel.left = "10px";
        advancedTexture.addControl(panel);
        
        // Title
        const title = new BABYLON.GUI.TextBlock();
        title.text = "🛠️ GM TOOLS";
        title.height = "30px";
        title.color = "gold";
        title.fontSize = 18;
        title.fontWeight = "bold";
        panel.addControl(title);
        
        // Buttons
        this.addButton(panel, "Toggle Grid (G)", () => this.toggleGrid());
        this.addButton(panel, "Toggle Coords (C)", () => this.toggleCoords());
        this.addButton(panel, "Save Spawns", () => this.saveAllSpawns());
        this.addButton(panel, "Clear Selection", () => this.clearSelection());
        this.addButton(panel, "Delete Selected", () => this.deleteSelected());
    }
    
    addButton(panel, text, callback) {
        const button = BABYLON.GUI.Button.CreateSimpleButton("gmBtn_" + text, text);
        button.width = "180px";
        button.height = "30px";
        button.color = "white";
        button.background = "rgba(0, 100, 0, 0.8)";
        button.cornerRadius = 5;
        button.thickness = 2;
        button.fontSize = 12;
        button.paddingTop = "2px";
        button.paddingBottom = "2px";
        
        button.onPointerEnterObservable.add(() => {
            button.background = "rgba(0, 150, 0, 0.9)";
        });
        
        button.onPointerOutObservable.add(() => {
            button.background = "rgba(0, 100, 0, 0.8)";
        });
        
        button.onPointerClickObservable.add(callback);
        
        panel.addControl(button);
    }
    
    // ==================== KEY BINDS ====================
    
    setupKeyBinds() {
        if (!this.enabled) return;
        
        window.addEventListener('keydown', (e) => {
            // Only process if GM mode is enabled
            if (!this.enabled) return;
            
            // Don't process if typing in a text field
            if (document.activeElement.tagName === 'INPUT' || 
                document.activeElement.tagName === 'TEXTAREA') {
                return;
            }
            
            switch(e.key.toLowerCase()) {
                case 'g':
                    if (!e.ctrlKey) this.toggleGrid();
                    break;
                case 'c':
                    if (!e.ctrlKey) this.toggleCoords();
                    break;
                case 'delete':
                    this.deleteSelected();
                    break;
                case 'escape':
                    this.clearSelection();
                    break;
            }
        });
        
        // Click to select entities
        this.game.scene.onPointerDown = (evt, pickResult) => {
            if (!this.enabled || evt.button !== 0) return;
            
            if (pickResult.hit && pickResult.pickedMesh) {
                this.selectEntity(pickResult.pickedMesh);
            }
        };
    }
    
    // ==================== COMMANDS ====================
    
    executeCommand(commandString) {
        if (!this.enabled) {
            console.log('[GM] GM commands not enabled for this account');
            return;
        }
        
        // Add to history
        this.commandHistory.push(commandString);
        this.historyIndex = this.commandHistory.length;
        
        // Parse command
        const parts = commandString.trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);
        
        console.log('[GM] Executing command:', command, args);
        
        switch(command) {
            case '/help':
            case '/commands':
                this.showHelp();
                break;
                
            case '/spawn':
                this.cmdSpawn(args);
                break;
                
            case '/tp':
            case '/teleport':
                this.cmdTeleport(args);
                break;
                
            case '/move':
                this.cmdMove(args);
                break;
                
            case '/delete':
            case '/remove':
                this.cmdDelete(args);
                break;
                
            case '/save':
                this.cmdSave(args);
                break;
                
            case '/list':
                this.cmdList(args);
                break;
                
            case '/select':
                this.cmdSelect(args);
                break;
                
            case '/edit':
                this.cmdEdit(args);
                break;
                
            case '/clear':
                this.clearSelection();
                break;
                
            case '/grid':
                this.toggleGrid();
                break;
                
            default:
                this.showMessage(`Unknown command: ${command}. Type /help for available commands.`, 'error');
        }
    }
    
    // ==================== COMMAND IMPLEMENTATIONS ====================
    
    showHelp() {
        const helpText = `
🛠️ GM COMMANDS:
  
SPAWNING:
  /spawn <type> [x] [y] [z]     - Spawn entity at position
    Examples: /spawn wolf
              /spawn goblin 50 2 -30
              /spawn merchant
  
MOVEMENT:
  /tp <x> <y> <z>               - Teleport to coordinates
  /move <x> <y> <z>             - Move selected entity
  
SELECTION:
  /select <id|nearest>          - Select entity
  /clear                        - Clear selection
  Click entity to select
  
EDITING:
  /edit <property> <value>      - Edit selected entity
    Examples: /edit name "Boss Wolf"
              /edit level 10
              /edit health 500
  
DATABASE:
  /save                         - Save selected entity to DB
  /save all                     - Save all spawns to DB
  /save character               - Manually save your character
  /delete                       - Delete selected entity
  
VISUAL:
  /grid                         - Toggle coordinate grid
  /list [type]                  - List all entities
  
HOTKEYS:
  G - Toggle grid
  C - Toggle coordinates
  Delete - Delete selected
  Esc - Clear selection
        `.trim();
        
        console.log(helpText);
        this.showMessage('Commands listed in console (F12)', 'info');
    }
    
    cmdSpawn(args) {
        if (args.length === 0) {
            this.showMessage('Usage: /spawn <type> [x] [y] [z]', 'error');
            return;
        }
        
        const type = args[0].toLowerCase();
        let x, y, z;
        
        if (args.length >= 3) {
            x = parseFloat(args[1]);
            y = parseFloat(args[2]);  
            z = parseFloat(args[3]);
        } else {
            // Spawn in front of player
            const player = this.game.player;
            if (!player || !player.mesh) {
                this.showMessage('Player not found', 'error');
                return;
            }
            
            const forward = player.mesh.forward;
            x = player.mesh.position.x + forward.x * 5;
            y = player.mesh.position.y;
            z = player.mesh.position.z + forward.z * 5;
        }
        
        // Get terrain height
        y = this.game.world.getHeightAt(x, z) + 2;
        
        const position = new BABYLON.Vector3(x, y, z);
        
        // Determine if it's an enemy or NPC
        const enemyTypes = ['wolf', 'goblin', 'bear', 'bandit'];
        const npcTypes = ['merchant', 'guard', 'villager'];
        
        let entity;
        if (enemyTypes.includes(type)) {
            entity = new Enemy(this.game.scene, position, Date.now(), type);
            this.game.world.enemies.push(entity);
            this.showMessage(`✓ Spawned ${type} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`, 'success');
        } else if (npcTypes.includes(type)) {
            entity = new NPC(this.game.scene, position, Date.now(), type);
            this.game.world.npcs.push(entity);
            this.showMessage(`✓ Spawned ${type} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`, 'success');
        } else {
            this.showMessage(`Unknown entity type: ${type}`, 'error');
            return;
        }
        
        // Auto-select spawned entity
        if (entity && entity.mesh) {
            this.selectEntity(entity.mesh);
        }
    }
    
    cmdTeleport(args) {
        if (args.length < 3) {
            this.showMessage('Usage: /tp <x> <y> <z>', 'error');
            return;
        }
        
        const x = parseFloat(args[0]);
        const y = parseFloat(args[1]);
        const z = parseFloat(args[2]);
        
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            this.showMessage('Invalid coordinates', 'error');
            return;
        }
        
        if (this.game.player && this.game.player.mesh) {
            this.game.player.mesh.position.set(x, y, z);
            this.showMessage(`✓ Teleported to (${x}, ${y}, ${z})`, 'success');
        }
    }
    
    cmdMove(args) {
        if (!this.selectedEntity) {
            this.showMessage('No entity selected', 'error');
            return;
        }
        
        if (args.length < 3) {
            this.showMessage('Usage: /move <x> <y> <z>', 'error');
            return;
        }
        
        const x = parseFloat(args[0]);
        const y = parseFloat(args[1]);
        const z = parseFloat(args[2]);
        
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            this.showMessage('Invalid coordinates', 'error');
            return;
        }
        
        const mesh = this.selectedEntity;
        mesh.position.set(x, y, z);
        
        this.showMessage(`✓ Moved entity to (${x}, ${y}, ${z})`, 'success');
    }
    
    cmdDelete(args) {
        if (!this.selectedEntity) {
            this.showMessage('No entity selected. Use /delete or click an entity first.', 'error');
            return;
        }
        
        this.deleteSelected();
    }
    
    async cmdSave(args) {
        // /save character - save player character
        if (args.length > 0 && args[0].toLowerCase() === 'character') {
            if (this.game.saveCharacter) {
                this.showMessage('Saving character...', 'info');
                try {
                    await this.game.saveCharacter();
                    this.showMessage('✓ Character saved successfully', 'success');
                } catch (error) {
                    this.showMessage('✗ Character save failed: ' + error.message, 'error');
                }
            }
            return;
        }
        
        // /save all - save all spawns
        if (args.length > 0 && args[0].toLowerCase() === 'all') {
            await this.saveAllSpawns();
            return;
        }
        
        // /save - save selected entity
        if (!this.selectedEntity) {
            this.showMessage('Usage: /save [character|all] or select an entity first', 'error');
            return;
        }
        
        await this.saveEntityToDatabase(this.selectedEntity);
    }
    
    cmdList(args) {
        const type = args.length > 0 ? args[0].toLowerCase() : 'all';
        
        let entities = [];
        
        if (type === 'all' || type === 'npc') {
            this.game.world.npcs.forEach((npc, i) => {
                if (npc.mesh) {
                    const pos = npc.mesh.position;
                    entities.push(`NPC ${i}: ${npc.name || 'Unknown'} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
                }
            });
        }
        
        if (type === 'all' || type === 'enemy') {
            this.game.world.enemies.forEach((enemy, i) => {
                if (enemy.mesh) {
                    const pos = enemy.mesh.position;
                    entities.push(`Enemy ${i}: ${enemy.name || 'Unknown'} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
                }
            });
        }
        
        console.log('=== ENTITY LIST ===');
        entities.forEach(e => console.log(e));
        console.log(`Total: ${entities.length} entities`);
        
        this.showMessage(`Listed ${entities.length} entities in console`, 'info');
    }
    
    cmdSelect(args) {
        if (args.length === 0) {
            this.showMessage('Usage: /select <id|nearest>', 'error');
            return;
        }
        
        const target = args[0].toLowerCase();
        
        if (target === 'nearest') {
            this.selectNearestEntity();
        } else {
            const id = parseInt(target);
            this.selectEntityById(id);
        }
    }
    
    cmdEdit(args) {
        if (!this.selectedEntity) {
            this.showMessage('No entity selected', 'error');
            return;
        }
        
        if (args.length < 2) {
            this.showMessage('Usage: /edit <property> <value>', 'error');
            return;
        }
        
        const property = args[0].toLowerCase();
        const value = args.slice(1).join(' ');
        
        // Find the entity object from the mesh
        const entity = this.getEntityFromMesh(this.selectedEntity);
        
        if (!entity) {
            this.showMessage('Could not find entity data', 'error');
            return;
        }
        
        // Edit property
        switch(property) {
            case 'name':
                entity.name = value.replace(/['"]/g, '');
                this.showMessage(`✓ Set name to: ${entity.name}`, 'success');
                break;
            case 'level':
                entity.level = parseInt(value);
                this.showMessage(`✓ Set level to: ${entity.level}`, 'success');
                break;
            case 'health':
            case 'hp':
                entity.health = parseFloat(value);
                if (entity.maxHealth < entity.health) {
                    entity.maxHealth = entity.health;
                }
                this.showMessage(`✓ Set health to: ${entity.health}`, 'success');
                break;
            case 'damage':
            case 'attack':
                entity.damage = parseFloat(value);
                this.showMessage(`✓ Set damage to: ${entity.damage}`, 'success');
                break;
            default:
                this.showMessage(`Unknown property: ${property}`, 'error');
        }
    }
    
    // ==================== ENTITY MANAGEMENT ====================
    
    selectEntity(mesh) {
        // Clear previous selection
        this.clearSelection();
        
        // Highlight selected mesh
        this.selectedEntity = mesh;
        
        // Create selection box
        this.createSelectionBox(mesh);
        
        // Get entity info
        const entity = this.getEntityFromMesh(mesh);
        if (entity) {
            const pos = mesh.position;
            this.showMessage(
                `Selected: ${entity.name || 'Unknown'} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`,
                'info'
            );
        }
    }
    
    createSelectionBox(mesh) {
        // Create a wireframe box around the selected mesh
        const boundingInfo = mesh.getBoundingInfo();
        const size = boundingInfo.boundingBox.extendSize.scale(2);
        
        this.selectionBox = BABYLON.MeshBuilder.CreateBox("selectionBox", {
            width: size.x,
            height: size.y,
            depth: size.z
        }, this.game.scene);
        
        this.selectionBox.position = mesh.position.clone();
        this.selectionBox.position.y += size.y / 2;
        
        const mat = new BABYLON.StandardMaterial("selectionMat", this.game.scene);
        mat.emissiveColor = new BABYLON.Color3(0, 1, 0);
        mat.wireframe = true;
        this.selectionBox.material = mat;
        this.selectionBox.isPickable = false;
        
        // Make it follow the mesh
        this.selectionBox.parent = mesh;
    }
    
    clearSelection() {
        this.selectedEntity = null;
        
        if (this.selectionBox) {
            this.selectionBox.dispose();
            this.selectionBox = null;
        }
    }
    
    deleteSelected() {
        if (!this.selectedEntity) {
            this.showMessage('No entity selected', 'error');
            return;
        }
        
        const entity = this.getEntityFromMesh(this.selectedEntity);
        
        if (entity) {
            // Remove from world arrays
            const npcIndex = this.game.world.npcs.indexOf(entity);
            if (npcIndex !== -1) {
                this.game.world.npcs.splice(npcIndex, 1);
            }
            
            const enemyIndex = this.game.world.enemies.indexOf(entity);
            if (enemyIndex !== -1) {
                this.game.world.enemies.splice(enemyIndex, 1);
            }
            
            // Dispose mesh
            if (entity.mesh) {
                entity.mesh.dispose();
            }
            
            this.showMessage(`✓ Deleted entity`, 'success');
        }
        
        this.clearSelection();
    }
    
    selectNearestEntity() {
        if (!this.game.player || !this.game.player.mesh) return;
        
        const playerPos = this.game.player.mesh.position;
        let nearest = null;
        let nearestDist = Infinity;
        
        // Check all entities
        const allEntities = [...this.game.world.npcs, ...this.game.world.enemies];
        
        allEntities.forEach(entity => {
            if (!entity.mesh) return;
            
            const dist = BABYLON.Vector3.Distance(playerPos, entity.mesh.position);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = entity.mesh;
            }
        });
        
        if (nearest) {
            this.selectEntity(nearest);
        } else {
            this.showMessage('No entities found', 'error');
        }
    }
    
    selectEntityById(id) {
        // Try NPCs first
        if (id < this.game.world.npcs.length) {
            const npc = this.game.world.npcs[id];
            if (npc && npc.mesh) {
                this.selectEntity(npc.mesh);
                return;
            }
        }
        
        // Then enemies
        const enemyId = id - this.game.world.npcs.length;
        if (enemyId >= 0 && enemyId < this.game.world.enemies.length) {
            const enemy = this.game.world.enemies[enemyId];
            if (enemy && enemy.mesh) {
                this.selectEntity(enemy.mesh);
                return;
            }
        }
        
        this.showMessage(`Entity ${id} not found`, 'error');
    }
    
    getEntityFromMesh(mesh) {
        // Search NPCs
        for (const npc of this.game.world.npcs) {
            if (npc.mesh === mesh) return npc;
        }
        
        // Search enemies
        for (const enemy of this.game.world.enemies) {
            if (enemy.mesh === mesh) return enemy;
        }
        
        return null;
    }
    
    // ==================== DATABASE OPERATIONS ====================
    
    async saveEntityToDatabase(mesh) {
        const entity = this.getEntityFromMesh(mesh);
        if (!entity) {
            this.showMessage('Entity not found', 'error');
            return;
        }
        
        if (!window.supabaseService || !window.supabaseService.client) {
            this.showMessage('Database not available', 'error');
            return;
        }
        
        const pos = mesh.position;
        
        // Determine if NPC or Enemy
        const isNPC = this.game.world.npcs.includes(entity);
        const faction = isNPC ? 'friendly' : 'hostile';
        
        try {
            // First, ensure template exists
            const templateCode = entity.type || (isNPC ? 'villager' : 'wolf');
            
            // Insert spawn point
            const { data, error } = await window.supabaseService.client
                .from('hosg_npc_spawns')
                .insert({
                    npc_template_id: await this.getTemplateId(templateCode, faction),
                    zone_id: 1,
                    position_x: pos.x,
                    position_y: pos.y,
                    position_z: pos.z,
                    respawn_seconds: 120,
                    max_spawn: 1,
                    spawn_radius: 0
                })
                .select()
                .single();
            
            if (error) throw error;
            
            this.showMessage(`✓ Saved to database (ID: ${data.id})`, 'success');
            
        } catch (error) {
            console.error('[GM] Failed to save:', error);
            this.showMessage(`Failed to save: ${error.message}`, 'error');
        }
    }
    
    async saveAllSpawns() {
        if (!window.supabaseService || !window.supabaseService.client) {
            this.showMessage('Database not available', 'error');
            return;
        }
        
        this.showMessage('Saving all spawns...', 'info');
        
        let saved = 0;
        
        // Save all NPCs
        for (const npc of this.game.world.npcs) {
            if (npc.mesh) {
                await this.saveEntityToDatabase(npc.mesh);
                saved++;
            }
        }
        
        // Save all enemies
        for (const enemy of this.game.world.enemies) {
            if (enemy.mesh) {
                await this.saveEntityToDatabase(enemy.mesh);
                saved++;
            }
        }
        
        this.showMessage(`✓ Saved ${saved} spawns to database`, 'success');
    }
    
    async getTemplateId(code, faction) {
        // Try to find existing template
        const { data } = await window.supabaseService.client
            .from('hosg_npc_templates')
            .select('id')
            .eq('code', code)
            .single();
        
        if (data) return data.id;
        
        // Return default IDs
        const defaults = {
            'merchant': 1,
            'guard': 2,
            'villager': 3,
            'wolf': 10,
            'goblin': 11
        };
        
        return defaults[code] || (faction === 'friendly' ? 1 : 10);
    }
    
    // ==================== VISUAL HELPERS ====================
    
    toggleGrid() {
        this.showGrid = !this.showGrid;
        
        if (this.showGrid) {
            this.createGrid();
            this.showMessage('✓ Grid enabled', 'info');
        } else {
            this.removeGrid();
            this.showMessage('✓ Grid disabled', 'info');
        }
    }
    
    createGrid() {
        if (this.gridMesh) return;
        
        const size = 200;
        const divisions = 20;
        
        this.gridMesh = BABYLON.MeshBuilder.CreateGround("grid", {
            width: size,
            height: size,
            subdivisions: divisions
        }, this.game.scene);
        
        const mat = new BABYLON.StandardMaterial("gridMat", this.game.scene);
        mat.wireframe = true;
        mat.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        mat.alpha = 0.3;
        this.gridMesh.material = mat;
        this.gridMesh.position.y = 0.01; // Slightly above ground
        this.gridMesh.isPickable = false;
    }
    
    removeGrid() {
        if (this.gridMesh) {
            this.gridMesh.dispose();
            this.gridMesh = null;
        }
    }
    
    toggleCoords() {
        this.showCoords = !this.showCoords;
        
        if (this.coordsLabel) {
            this.coordsLabel.isVisible = this.showCoords;
        }
        
        this.showMessage(this.showCoords ? '✓ Coordinates enabled' : '✓ Coordinates disabled', 'info');
    }
    
    // ==================== UPDATE LOOP ====================
    
    update() {
        if (!this.enabled) return;
        
        // Update coordinate display
        if (this.showCoords && this.coordsLabel && this.game.player && this.game.player.mesh) {
            const pos = this.game.player.mesh.position;
            this.coordsLabel.text = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
        }
        
        // Update selection box position
        if (this.selectionBox && this.selectedEntity) {
            this.selectionBox.position.copyFrom(this.selectedEntity.position);
        }
    }
    
    // ==================== UTILITIES ====================
    
    showMessage(message, type = 'info') {
        console.log(`[GM] ${message}`);
        
        if (this.game.ui && this.game.ui.showMessage) {
            this.game.ui.showMessage(message, 3000, type);
        }
    }
    
    dispose() {
        this.clearSelection();
        this.removeGrid();
        
        if (this.coordsLabel) {
            this.coordsLabel.dispose();
        }
    }
}

// Export
window.GMCommands = GMCommands;
console.log('[GM] GMCommands class loaded');
