class UIManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.chatMessages = [];
    this.notifications = [];
    this.uiElements = {};
  }
  
  init() {
    // Initialize UI elements
    this.initChat();
    this.initHealthBars();
    this.initHotbar();
    this.initCharacterPanel();
    this.initEventListeners();
    
    // Show welcome message
    this.showNotification('Welcome to Heroes of Shady Grove!');
    
    debugLog('UI initialized');
  }
  
  initChat() {
    const chatContainer = document.getElementById('chat-container');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    
    // Store references
    this.uiElements.chatContainer = chatContainer;
    this.uiElements.chatMessages = chatMessages;
    this.uiElements.chatInput = chatInput;
    
    // Handle chat input
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chatInput.value.trim() !== '') {
        const message = chatInput.value.trim();
        
        // Send chat message
        if (this.game.network) {
          this.game.network.sendChatMessage(message);
        }
        
        // Clear input
        chatInput.value = '';
        
        // Focus back to game
        chatInput.blur();
      } else if (e.key === 'Escape') {
        // Cancel chat
        chatInput.value = '';
        chatInput.blur();
      }
    });
    
    // Auto-scroll chat to bottom when new messages arrive
    const observer = new MutationObserver(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
    
    observer.observe(chatMessages, { childList: true });
  }
  
  initHealthBars() {
    // Health and mana bars are already in the HTML
    // We'll just store references to them
    this.uiElements.healthBar = document.getElementById('health-fill');
    this.uiElements.manaBar = document.getElementById('mana-fill');
  }
  
  initHotbar() {
    const hotbar = document.getElementById('hotbar');
    const hotbarSlots = hotbar.querySelectorAll('.hotbar-slot');
    
    // Store references
    this.uiElements.hotbar = hotbar;
    this.uiElements.hotbarSlots = Array.from(hotbarSlots);
    
    // Set up hotbar slots
    hotbarSlots.forEach((slot, index) => {
      const slotNumber = index + 1;
      
      // Set key label
      const keyLabel = document.createElement('div');
      keyLabel.className = 'key';
      keyLabel.textContent = slotNumber === 10 ? '0' : slotNumber;
      slot.appendChild(keyLabel);
      
      // Add click handler
      slot.addEventListener('click', () => {
        this.useHotbarSlot(slotNumber);
      });
    });
  }
  
  initCharacterPanel() {
    const characterPanel = document.getElementById('character-panel');
    const closeButton = document.getElementById('close-character-panel');
    const characterStats = document.getElementById('character-stats');
    
    // Store references
    this.uiElements.characterPanel = characterPanel;
    this.uiElements.characterStats = characterStats;
    
    // Close button
    closeButton.addEventListener('click', () => {
      this.toggleCharacterPanel();
    });
    
    // Initialize character stats
    this.updateCharacterStats();
  }
  
  initEventListeners() {
    // Toggle character panel with 'C' key
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'c' && !e.repeat) {
        this.toggleCharacterPanel();
      }
    });
  }
  
  addChatMessage(sender, message, timestamp = Date.now()) {
    const chatMessages = this.uiElements.chatMessages;
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    // Format timestamp
    const timeString = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Create message HTML
    messageElement.innerHTML = `
      <span class="message-sender">${sender}:</span>
      <span class="message-text">${message}</span>
      <span class="message-time">${timeString}</span>
    `;
    
    // Add message to chat
    chatMessages.appendChild(messageElement);
    
    // Limit number of messages
    while (chatMessages.children.length > 100) {
      chatMessages.removeChild(chatMessages.firstChild);
    }
  }
  
  showNotification(message, duration = 3000) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    
    // Style the notification
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.left = '50%';
    notification.style.transform = 'translateX(-50%)';
    notification.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    notification.style.color = 'white';
    notification.style.padding = '10px 20px';
    notification.style.borderRadius = '5px';
    notification.style.zIndex = '1000';
    notification.style.transition = 'opacity 0.3s';
    
    // Add to document
    document.body.appendChild(notification);
    
    // Remove after duration
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, duration);
    
    // Add to notifications array
    this.notifications.push({
      element: notification,
      timestamp: Date.now(),
      duration: duration
    });
  }
  
  updateHealth(health, maxHealth) {
    const healthPercent = Math.max(0, Math.min(100, (health / maxHealth) * 100));
    this.uiElements.healthBar.style.width = `${healthPercent}%`;
    
    // Update color based on health percentage
    if (healthPercent < 20) {
      this.uiElements.healthBar.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
    } else if (healthPercent < 50) {
      this.uiElements.healthBar.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
    } else {
      this.uiElements.healthBar.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
    }
  }
  
  updateMana(mana, maxMana) {
    const manaPercent = Math.max(0, Math.min(100, (mana / maxMana) * 100));
    this.uiElements.manaBar.style.width = `${manaPercent}%`;
  }
  
  updateHotbar(slot, item) {
    if (slot < 1 || slot > 10) return;
    
    const slotElement = this.uiElements.hotbarSlots[slot - 1];
    if (!slotElement) return;
    
    if (item) {
      // Update slot with item
      slotElement.innerHTML = `
        <div class="item-icon">${item.icon || '?'}</div>
        <div class="item-count">${item.count > 1 ? item.count : ''}</div>
        <div class="key">${slot === 10 ? '0' : slot}</div>
      `;
    } else {
      // Clear slot
      slotElement.innerHTML = `<div class="key">${slot === 10 ? '0' : slot}</div>`;
    }
  }
  
  useHotbarSlot(slot) {
    if (!this.game.player) return;
    
    // Get item in slot
    const item = this.game.player.getHotbarItem(slot);
    if (!item) return;
    
    // Use the item
    this.game.player.useItem(item);
    
    // Update hotbar
    this.updateHotbar(slot, item);
  }
  
  toggleCharacterPanel() {
    const panel = this.uiElements.characterPanel;
    if (panel.style.display === 'block') {
      panel.style.display = 'none';
    } else {
      this.updateCharacterStats();
      panel.style.display = 'block';
    }
  }
  
  updateCharacterStats() {
    if (!this.game.player) return;
    
    const stats = this.game.player.state.stats || {};
    const statsHtml = `
      <div class="stat-row">
        <span class="stat-label">Level:</span>
        <span class="stat-value">${this.game.player.state.level || 1}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Health:</span>
        <span class="stat-value">${Math.floor(this.game.player.state.health || 0)} / ${this.game.player.state.maxHealth || 100}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Mana:</span>
        <span class="stat-value">${Math.floor(this.game.player.state.mana || 0)} / ${this.game.player.state.maxMana || 100}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Strength:</span>
        <span class="stat-value">${stats.strength || 10}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Dexterity:</span>
        <span class="stat-value">${stats.dexterity || 10}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Intelligence:</span>
        <span class="stat-value">${stats.intelligence || 10}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Vitality:</span>
        <span class="stat-value">${stats.vitality || 10}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Luck:</span>
        <span class="stat-value">${stats.luck || 10}</span>
      </div>
    `;
    
    this.uiElements.characterStats.innerHTML = statsHtml;
  }
  
  update(deltaTime) {
    // Update notifications
    this.updateNotifications(deltaTime);
    
    // Update other UI elements as needed
    if (this.game.player) {
      this.updateHealth(this.game.player.state.health, this.game.player.state.maxHealth);
      this.updateMana(this.game.player.state.mana, this.game.player.state.maxMana);
    }
  }
  
  updateNotifications(deltaTime) {
    const now = Date.now();
    const toRemove = [];
    
    // Update notifications
    for (let i = 0; i < this.notifications.length; i++) {
      const notification = this.notifications[i];
      const age = now - notification.timestamp;
      
      if (age >= notification.duration) {
        // Fade out and remove
        if (notification.element.parentNode) {
          notification.element.style.opacity = '0';
          setTimeout(() => {
            if (notification.element.parentNode) {
              notification.element.parentNode.removeChild(notification.element);
            }
          }, 300);
        }
        toRemove.push(i);
      }
    }
    
    // Remove processed notifications
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.notifications.splice(toRemove[i], 1);
    }
  }
  
  // Cleanup
  dispose() {
    // Clean up event listeners
    if (this.uiElements.chatInput) {
      this.uiElements.chatInput.removeEventListener('keydown');
    }
    
    // Remove all notifications
    for (const notification of this.notifications) {
      if (notification.element.parentNode) {
        notification.element.parentNode.removeChild(notification.element);
      }
    }
    this.notifications = [];
    
    // Clear UI elements
    this.uiElements = {};
  }
}
