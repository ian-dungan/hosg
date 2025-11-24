// ============================================================
// HEROES OF SHADY GROVE - INTEGRATION HELPERS v3.0
// Copy these functions into your index.html <script> section
// ============================================================

// ==================== LOOT PICKUP ====================
function checkLootPickup(playerPos) {
  if (!scene || !window.GameSystems?.loot) return;
  
  const lootBags = scene.meshes.filter(m => m.metadata?.isLootBag);
  
  for (const bag of lootBags) {
    const dist = BABYLON.Vector3.Distance(playerPos, bag.position);
    
    if (dist < 2) {
      // Pickup loot
      const loot = bag.metadata.loot;
      loot.forEach(item => {
        GameSystems.inventory.addItem(item);
        
        if (item.type === 'gold') {
          showNotification(`+${item.amount} gold`);
          GameSystems.events?.trigger('gold_gained', { amount: item.amount });
        } else {
          showNotification(`Looted: ${item.name || item.type}`);
          GameSystems.events?.trigger('item_looted');
        }
      });
      
      GameSystems.sound.play('loot');
      
      // Remove bag
      if (bag.metadata.observer) {
        scene.onBeforeRenderObservable.remove(bag.metadata.observer);
      }
      bag.dispose();
    }
  }
}

// ==================== DUNGEON PORTAL ====================
function checkDungeonPortal(playerPos) {
  if (!scene || !window.AdvancedSystems?.dungeons) return;
  
  const portals = scene.meshes.filter(m => m.metadata?.isDungeonPortal);
  
  for (const portal of portals) {
    const dist = BABYLON.Vector3.Distance(playerPos, portal.position);
    
    if (dist < 3) {
      // Show prompt
      if (!document.getElementById('dungeon-prompt')) {
        const prompt = document.createElement('div');
        prompt.id = 'dungeon-prompt';
        prompt.style.cssText = `
          position: fixed;
          bottom: 120px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(10, 15, 35, 0.95);
          border: 2px solid #ffe164;
          border-radius: 8px;
          padding: 12px 20px;
          font-size: 14px;
          color: #ffe164;
          z-index: 200;
        `;
        prompt.innerHTML = 'Press <strong>E</strong> to enter dungeon';
        document.body.appendChild(prompt);
      }
      
      // Listen for E key
      document.addEventListener('keydown', function enterDungeon(e) {
        if (e.key === 'e' || e.key === 'E') {
          AdvancedSystems.dungeons.enterDungeon(portal.metadata.dungeonId, heroBody);
          const prompt = document.getElementById('dungeon-prompt');
          if (prompt) prompt.remove();
          document.removeEventListener('keydown', enterDungeon);
        }
      });
      
      return; // Only show one prompt at a time
    }
  }
  
  // Remove prompt if far from portal
  const prompt = document.getElementById('dungeon-prompt');
  if (prompt) prompt.remove();
}

// ==================== ENHANCED ENEMY DEATH ====================
// Replace the handleDeath function in combat system with this:
function enhancedHandleDeath(victim, killer) {
  console.log(`${victim.name} was defeated by ${killer.name}`);
  
  const oldLevel = killer.stats.level;
  
  // Award XP
  const xpGain = victim.stats.level * 10;
  killer.stats.xp = (killer.stats.xp || 0) + xpGain;
  
  // Check level up
  const xpNeeded = 100 * Math.pow(killer.stats.level, 1.8);
  if (killer.stats.xp >= xpNeeded) {
    killer.stats.level++;
    killer.stats.xp = 0;
    killer.stats.maxHp += 10;
    killer.stats.maxMp += 5;
    killer.stats.attack += 2;
    killer.stats.defense += 1;
    killer.stats.hp = killer.stats.maxHp;
    killer.stats.mp = killer.stats.maxMp;
    
    GameSystems.sound?.play('levelup');
    GameSystems.skillTree?.addSkillPoints(2);
    GameSystems.events?.trigger('level_up', { level: killer.stats.level });
    
    showNotification(`Level up! You are now level ${killer.stats.level}! +2 Skill Points`);
    console.log(`${killer.name} leveled up to ${killer.stats.level}!`);
  }
  
  // Drop loot
  if (victim.type === 'enemy' && victim.position && GameSystems.loot) {
    const loot = GameSystems.loot.rollLoot(victim.level, victim.isBoss);
    if (loot.length > 0) {
      GameSystems.loot.spawnLootBag(victim.position, loot);
    }
  }
  
  // Update quest progress
  if (GameSystems.quests) {
    const enemyType = victim.id.split('_')[1]; // wolf, goblin, etc
    GameSystems.quests.updateProgress(enemyType, 1);
    updateQuestUI();
  }
  
  // Update achievements
  if (GameSystems.events) {
    GameSystems.events.trigger('enemy_killed', {
      enemyType: victim.id.split('_')[1],
      isBoss: victim.isBoss
    });
  }
  
  // Respawn enemy
  if (victim.mesh && victim.mesh.root) {
    victim.mesh.root.setEnabled(false);
    setTimeout(() => {
      victim.stats.hp = victim.stats.maxHp;
      victim.mesh.root.setEnabled(true);
    }, 30000);
  }
}

// ==================== INITIALIZATION ====================
function initializeGameSystems(scene, heroBody) {
  // Initialize core systems
  GameSystems.init(scene, hosgSupabase);
  
  // Initialize advanced systems
  if (window.AdvancedSystems) {
    AdvancedSystems.init(scene, GameSystems.npcManager, GameSystems.combat);
  }
  
  // Replace combat death handler
  if (GameSystems.combat) {
    GameSystems.combat.handleDeath = enhancedHandleDeath;
  }
  
  // Spawn enemies
  GameSystems.spawnTestEnemies(scene).then(() => {
    console.log('[HOSG] All enemies spawned');
  });
  
  // Auto-accept starter quest
  if (GameSystems.quests) {
    GameSystems.quests.acceptQuest('starter_1');
    showNotification('Quest: Wolf Hunter accepted!');
  }
  
  console.log('[HOSG] All systems initialized');
}

// ==================== GAME LOOP INTEGRATION ====================
function setupEnhancedGameLoop(scene, heroBody) {
  let lastUpdate = Date.now();
  
  scene.onBeforeRenderObservable.add(function () {
    const now = Date.now();
    const deltaTime = now - lastUpdate;
    lastUpdate = now;
    
    // Update advanced systems
    if (window.AdvancedSystems) {
      AdvancedSystems.update(deltaTime);
    }
    
    // Update minimap
    if (typeof updateMinimap === 'function' && GameSystems.npcManager) {
      const enemies = Array.from(GameSystems.npcManager.enemies.values());
      updateMinimap(heroBody.position, enemies);
    }
    
    // Check loot pickup
    if (typeof checkLootPickup === 'function') {
      checkLootPickup(heroBody.position);
    }
    
    // Check dungeon portals
    if (typeof checkDungeonPortal === 'function') {
      checkDungeonPortal(heroBody.position);
    }
    
    // Update time display
    if (AdvancedSystems?.dayNight) {
      const timeEl = document.getElementById('time-display');
      if (timeEl) {
        timeEl.textContent = AdvancedSystems.dayNight.getTimeString();
      }
    }
  });
}

// ==================== HOTKEY SETUP ====================
function setupEnhancedHotkeys() {
  document.addEventListener('keydown', function(e) {
    // Inventory
    if (e.key === 'i' || e.key === 'I') {
      document.getElementById('btn-inventory')?.click();
    }
    
    // Quests
    else if (e.key === 'q' || e.key === 'Q') {
      document.getElementById('btn-quests')?.click();
    }
    
    // Skills
    else if (e.key === 'k' || e.key === 'K') {
      document.getElementById('btn-skills')?.click();
    }
    
    // Skills 1-4
    else if (e.key >= '1' && e.key <= '4') {
      window.useHotbarSkill(parseInt(e.key));
    }
    
    // Target
    else if (e.key === 'Tab') {
      e.preventDefault();
      targetNearestEnemy();
    }
    
    // Clear target
    else if (e.key === 'Escape') {
      GameSystems.currentTarget = null;
      clearTargetHighlight();
      if (window.appendChat) {
        appendChat("Target cleared.");
      }
    }
  });
}

// ==================== COMPLETE SETUP ====================
// Call this after scene is created:
/*
const scene = createScene();
const heroBody = scene.heroBody; // Your hero mesh

// Setup everything
initializeGameSystems(scene, heroBody);
setupEnhancedGameLoop(scene, heroBody);
setupEnhancedHotkeys();

// Start render loop
engine.runRenderLoop(function () {
  scene.render();
});
*/

console.log('[Integration] Helper functions loaded');
