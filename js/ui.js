class UIManager {
    constructor(game) {
        this.game = game;
        this.elements = {};
        this.chatMessages = [];
        this.maxChatMessages = 100;
        this.notifications = [];
        this.activePanel = null;
    }
    
    init() {
        // Cache DOM elements
        this.cacheElements();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Initialize UI components
        this.initChat();
        this.initInventory();
        this.initQuestLog();
        this.initSettings();
        
        // Show HUD
        this.showHUD();
    }
    
    cacheElements() {
        // Cache frequently accessed elements
        this.elements = {
            // HUD
            hud: document.getElementById('hud'),
            healthBar: document.getElementById('health-fill'),
            manaBar: document.getElementById('mana-fill'),
            playerLevel: document.getElementById('player-level'),
            quickSlots: document.getElementById('quick-slots'),
            minimap: document.getElementById('minimap'),
            
            // Chat
            chatContainer: document.getElementById('chat-container'),
            chatMessages: document.getElementById('chat-messages'),
            chatInput: document.getElementById('chat-input'),
            sendChat: document.getElementById('send-chat'),
            
            // Panels
            panels: {
                inventory: document.getElementById('inventory-panel'),
                character: document.getElementById('character-panel'),
                quests: document.getElementById('quests-panel'),
                skills: document.getElementById('skills-panel'),
                map: document.getElementById('map-panel'),
                settings: document.getElementById('settings-panel')
            },
            
            // Buttons
            buttons: {
                toggleInventory: document.getElementById('btn-inventory'),
                toggleCharacter: document.getElementById('btn-character'),
                toggleQuests: document.getElementById('btn-quests'),
                toggleSkills: document.getElementById('btn-skills'),
                toggleMap: document.getElementById('btn-map'),
                toggleSettings: document.getElementById('btn-settings')
            }
        };
    }
    
    setupEventListeners() {
        const { buttons } = this.elements;
        
        // Toggle panels
        if (buttons.toggleInventory) {
            buttons.toggleInventory.addEventListener('click', () => this.togglePanel('inventory'));
        }
        if (buttons.toggleCharacter) {
            buttons.toggleCharacter.addEventListener('click', () => this.togglePanel('character'));
        }
        if (buttons.toggleQuests) {
            buttons.toggleQuests.addEventListener('click', () => this.togglePanel('quests'));
        }
        if (buttons.toggleSkills) {
            buttons.toggleSkills.addEventListener('click', () => this.togglePanel('skills'));
        }
        if (buttons.toggleMap) {
            buttons.toggleMap.addEventListener('click', () => this.togglePanel('map'));
        }
        if (buttons.toggleSettings) {
            buttons.toggleSettings.addEventListener('click', () => this.togglePanel('settings'));
        }
        
        // Chat input
        if (this.elements.chatInput) {
            this.elements.chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.sendChatMessage();
                }
            });
        }
        
        if (this.elements.sendChat) {
            this.elements.sendChat.addEventListener('click', () => this.sendChatMessage());
        }
        
        // Close buttons
        document.querySelectorAll('.panel-close').forEach(btn => {
            btn.addEventListener('click', () => this.closeAllPanels());
        });
    }
    
    initChat() {
        // Add some welcome messages
        this.addChatMessage('System', 'Welcome to the game!', true);
        this.addChatMessage('System', 'Type /help for a list of commands.', true);
    }
    
    initInventory() {
        // Initialize inventory UI
        // This would be populated when the player's inventory is loaded
    }
    
    initQuestLog() {
        // Initialize quest log UI
        // This would be populated when quests are loaded
    }
    
    initSettings() {
        // Initialize settings UI
        const settings = this.loadSettings();
        
        // Apply settings
        this.applySettings(settings);
    }
    
    loadSettings() {
        // Load settings from localStorage or use defaults
        const defaultSettings = {
            graphics: {
                quality: 'high',
                shadows: true,
                particles: true,
                viewDistance: 1000
            },
            audio: {
                masterVolume: 1.0,
                musicVolume: 0.7,
                effectsVolume: 1.0,
                voiceVolume: 1.0
            },
            controls: {
                invertY: false,
                mouseSensitivity: 1.0,
                keyBindings: {
                    forward: 'KeyW',
                    backward: 'KeyS',
                    left: 'KeyA',
                    right: 'KeyD',
                    jump: 'Space',
                    interact: 'KeyE',
                    inventory: 'KeyI',
                    character: 'KeyC',
                    quests: 'KeyL',
                    map: 'KeyM',
                    settings: 'Escape'
                }
            }
        };
        
        try {
            const savedSettings = localStorage.getItem('gameSettings');
            if (savedSettings) {
                return { ...defaultSettings, ...JSON.parse(savedSettings) };
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
        
        return defaultSettings;
    }
    
    saveSettings(settings) {
        try {
            localStorage.setItem('gameSettings', JSON.stringify(settings));
            this.applySettings(settings);
            return true;
        } catch (error) {
            console.error('Failed to save settings:', error);
            return false;
        }
    }
    
    applySettings(settings) {
        // Apply graphics settings
        if (settings.graphics) {
            // In a real game, this would adjust the graphics quality
            console.log('Applying graphics settings:', settings.graphics);
        }
        
        // Apply audio settings
        if (settings.audio && this.game.audio) {
            this.game.audio.setMasterVolume(settings.audio.masterVolume);
            this.game.audio.setMusicVolume(settings.audio.musicVolume);
            this.game.audio.setEffectsVolume(settings.audio.effectsVolume);
            this.game.audio.setVoiceVolume(settings.audio.voiceVolume);
        }
        
        // Apply control settings
        if (settings.controls) {
            // In a real game, this would update the control bindings
            console.log('Applying control settings:', settings.controls);
        }
    }
    
    showHUD() {
        if (this.elements.hud) {
            this.elements.hud.style.display = 'flex';
        }
    }
    
    hideHUD() {
        if (this.elements.hud) {
            this.elements.hud.style.display = 'none';
        }
    }
    
    togglePanel(panelName) {
        const panel = this.elements.panels[panelName];
        if (!panel) return;
        
        // If clicking the same panel's button, toggle it
        if (this.activePanel === panel) {
            this.closeAllPanels();
            return;
        }
        
        // Close all panels first
        this.closeAllPanels();
        
        // Show the selected panel
        panel.style.display = 'block';
        this.activePanel = panel;
        
        // Pause the game if in a menu
        if (panelName !== 'hud') {
            this.game.setPaused(true);
        } else {
            this.game.setPaused(false);
        }
    }
    
    closeAllPanels() {
        // Hide all panels
        Object.values(this.elements.panels).forEach(panel => {
            if (panel) panel.style.display = 'none';
        });
        
        this.activePanel = null;
        this.game.setPaused(false);
    }
    
    updatePlayerStats() {
        if (!this.game.player) return;
        
        const { stats } = this.game.player;
        
        // Update health bar
        if (this.elements.healthBar) {
            const healthPercent = (stats.health / stats.maxHealth) * 100;
            this.elements.healthBar.style.width = `${healthPercent}%`;
        }
        
        // Update mana bar
        if (this.elements.manaBar) {
            const manaPercent = (stats.mana / stats.maxMana) * 100;
            this.elements.manaBar.style.width = `${manaPercent}%`;
        }
        
        // Update level
        if (this.elements.playerLevel) {
            this.elements.playerLevel.textContent = stats.level;
        }
    }
    
    addChatMessage(sender, message, isSystem = false) {
        if (!this.elements.chatMessages) return;
        
        // Create message element
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${isSystem ? 'system' : ''}`;
        
        // Add sender name if not a system message
        if (!isSystem) {
            const senderEl = document.createElement('span');
            senderEl.className = 'chat-sender';
            senderEl.textContent = `${sender}: `;
            messageEl.appendChild(senderEl);
        }
        
        // Add message text
        const textEl = document.createTextNode(message);
        messageEl.appendChild(textEl);
        
        // Add to chat
        this.elements.chatMessages.appendChild(messageEl);
        
        // Limit number of messages
        this.chatMessages.push(messageEl);
        if (this.chatMessages.length > this.maxChatMessages) {
            const oldMessage = this.chatMessages.shift();
            if (oldMessage.parentNode === this.elements.chatMessages) {
                this.elements.chatMessages.removeChild(oldMessage);
            }
        }
        
        // Auto-scroll to bottom
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }
    
    sendChatMessage() {
        const input = this.elements.chatInput;
        if (!input || !input.value.trim()) return;
        
        const message = input.value.trim();
        input.value = '';
        
        // Handle commands
        if (message.startsWith('/')) {
            this.handleChatCommand(message);
            return;
        }
        
        // Send chat message to server
        if (this.game.network) {
            this.game.network.sendChatMessage(message);
        }
        
        // Add to local chat
        this.addChatMessage('You', message);
    }
    
    handleChatCommand(command) {
        const parts = command.slice(1).split(' ');
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);
        
        switch (cmd) {
            case 'help':
                this.showHelp();
                break;
                
            case 'emote':
                this.handleEmote(args[0]);
                break;
                
            case 'me':
                this.handleEmoteAction(args.join(' '));
                break;
                
            case 'clear':
                this.clearChat();
                break;
                
            default:
                this.addChatMessage('System', `Unknown command: /${cmd}`, true);
        }
    }
    
    showHelp() {
        const helpText = [
            'Available commands:',
            '/help - Show this help',
            '/emote [emote] - Perform an emote',
            '/me [action] - Describe an action',
            '/clear - Clear the chat window'
        ];
        
        helpText.forEach(line => {
            this.addChatMessage('System', line, true);
        });
    }
    
    handleEmote(emote) {
        // In a real game, this would play an emote animation
        const validEmotes = ['wave', 'dance', 'laugh', 'cry', 'bow'];
        
        if (validEmotes.includes(emote)) {
            this.addChatMessage('You', `*${emote}s*`);
            
            // Notify other players
            if (this.game.network) {
                this.game.network.send({
                    type: 'emote',
                    emote: emote
                });
            }
        } else {
            this.addChatMessage('System', `Unknown emote: ${emote}. Try: ${validEmotes.join(', ')}`, true);
        }
    }
    
    handleEmoteAction(action) {
        if (!action) {
            this.addChatMessage('System', 'Usage: /me [action]', true);
            return;
        }
        
        this.addChatMessage('You', `*${action}*`);
        
        // Notify other players
        if (this.game.network) {
            this.game.network.send({
                type: 'emote_action',
                action: action
            });
        }
    }
    
    clearChat() {
        if (this.elements.chatMessages) {
            this.elements.chatMessages.innerHTML = '';
            this.chatMessages = [];
        }
    }
    
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add to notifications container or body
        const container = document.getElementById('notifications') || document.body;
        container.appendChild(notification);
        
        // Auto-remove after delay
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
    
    showDialogue(npc, text, options = []) {
        // In a real game, this would show a dialogue UI
        console.log(`[DIALOGUE] ${npc.name}: ${text}`);
        if (options.length > 0) {
            console.log('Options:', options);
        }
        
        // For now, just show in chat
        this.addChatMessage(npc.name, text);
    }
    
    showMerchantUI(npc) {
        // In a real game, this would show a merchant UI
        console.log(`[MERCHANT] Showing ${npc.name}'s wares`);
        this.addChatMessage('System', `${npc.name} says: "Take a look at my wares!"`, true);
    }
    
    update(deltaTime) {
        // Update any UI animations or timers
    }
    
    // Clean up
    dispose() {
        // Remove event listeners
        if (this.elements.chatInput) {
            this.elements.chatInput.removeEventListener('keydown', this.handleChatInput);
        }
        
        // Clear any intervals or timeouts
        // ...
        
        // Clear references
        this.elements = {};
        this.chatMessages = [];
        this.notifications = [];
        this.activePanel = null;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIManager;
}
