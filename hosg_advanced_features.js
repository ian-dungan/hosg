// File: hosg_enhanced_features.js
// ============================================================
// HEROES OF SHADY GROVE - ENHANCED FEATURES v4.0
// ============================================================
// At the top of hosg_advanced_features.js
if (window.gameState && window.gameState.scene) {
    const scene = window.gameState.scene;
    
    // Your existing code that uses the scene
    // For example:
    const camera = new BABYLON.ArcRotateCamera(...);
    camera.attachControl(canvas, true);
    // ... rest of your code
} else {
    console.error("Scene not initialized when loading hosg_advanced_features.js");
}

// If you need to expose any functions to be called after scene initialization
function initAdvancedFeatures(scene) {
    // Initialize features that require the scene
    // This will be called from the main initialization
}
// Initialize if not exists
if (!window.GameSystems) {
    window.GameSystems = {
        npcManager: null,
        combat: null,
        sound: null,
        inventory: null,
        quests: null,
        skills: null,
        world: null,
        init: function() { console.log("[GameSystems] Initialized"); }
    };
}

// ==================== WORLD SYSTEM ====================
class WorldSystem {
    constructor(scene) {
        this.scene = scene;
        this.zones = new Map();
        this.currentZone = null;
        this.terrain = null;
        this.weatherSystem = null;
        this.timeSystem = null;
    }

    async loadZone(zoneId) {
        try {
            // Load zone data from Supabase
            const { data: zoneData, error } = await supabase
                .from('zones')
                .select('*')
                .eq('id', zoneId)
                .single();

            if (error) throw error;
            if (!zoneData) throw new Error('Zone not found');

            // Unload current zone if exists
            if (this.currentZone) {
                this.unloadZone();
            }

            // Create zone
            this.currentZone = {
                id: zoneData.id,
                name: zoneData.name,
                levelRange: [zoneData.min_level, zoneData.max_level],
                isPvP: zoneData.is_pvp,
                isDungeon: zoneData.is_dungeon,
                spawnPoints: zoneData.spawn_points || []
            };

            // Load terrain
            await this.loadTerrain(zoneData.terrain_data);
            
            // Load zone-specific assets
            await this.loadZoneAssets(zoneData.asset_pack);
            
            // Initialize weather system for this zone
            this.weatherSystem = new WeatherSystem(this.scene, zoneData.weather_settings);
            
            // Initialize time system
            this.timeSystem = new TimeSystem(zoneData.time_settings);
            
            console.log(`[World] Loaded zone: ${zoneData.name}`);
            return true;
        } catch (error) {
            console.error('[World] Error loading zone:', error);
            return false;
        }
    }

    // ... (other world system methods)
}

// ==================== CLASS SYSTEM ====================
class ClassSystem {
    constructor() {
        this.classes = new Map();
        this.loaded = false;
    }

    async loadClasses() {
        if (this.loaded) return;

        try {
            const { data: classes, error } = await supabase
                .from('classes')
                .select('*');

            if (error) throw error;

            for (const cls of classes) {
                this.classes.set(cls.id, {
                    id: cls.id,
                    name: cls.name,
                    description: cls.description,
                    baseStats: cls.base_stats,
                    statGrowth: cls.stat_growth,
                    abilities: []
                });
            }

            // Load abilities for each class
            await this.loadAbilities();
            this.loaded = true;
            console.log(`[ClassSystem] Loaded ${this.classes.size} classes`);
        } catch (error) {
            console.error('[ClassSystem] Error loading classes:', error);
        }
    }

    // ... (other class system methods)
}

// ==================== COMBAT SYSTEM ENHANCEMENTS ====================
class EnhancedCombatSystem {
    constructor(combatSystem) {
        this.combat = combatSystem;
        this.abilities = new Map();
        this.statusEffects = new Map();
        this.combatLog = [];
        this.combatMetrics = {
            damageDealt: 0,
            damageTaken: 0,
            healingDone: 0,
            kills: 0,
            deaths: 0
        };
    }

    async loadAbilities() {
        try {
            const { data: abilities, error } = await supabase
                .from('abilities')
                .select('*');

            if (error) throw error;

            for (const ability of abilities) {
                this.abilities.set(ability.id, {
                    id: ability.id,
                    name: ability.name,
                    description: ability.description,
                    classId: ability.class_id,
                    levelRequired: ability.level_required,
                    cooldown: ability.cooldown,
                    resourceCost: ability.resource_cost,
                    effects: ability.effects,
                    targetType: ability.target_type,
                    range: ability.range,
                    areaOfEffect: ability.area_of_effect,
                    animation: ability.animation
                });
            }
            console.log(`[Combat] Loaded ${this.abilities.size} abilities`);
        } catch (error) {
            console.error('[Combat] Error loading abilities:', error);
        }
    }

    // ... (other combat system methods)
}

// ==================== QUEST SYSTEM ENHANCEMENTS ====================
class EnhancedQuestSystem {
    constructor() {
        this.activeQuests = new Map();
        this.completedQuests = new Set();
        this.questTemplates = new Map();
        this.questGivers = new Map();
    }

    async loadQuests() {
        try {
            // Load quest templates
            const { data: quests, error: questError } = await supabase
                .from('quests')
                .select('*');

            if (questError) throw questError;

            // Load quest objectives
            const { data: objectives, error: objError } = await supabase
                .from('quest_objectives')
                .select('*');

            if (objError) throw objError;

            // Organize objectives by quest
            const objectivesByQuest = new Map();
            for (const obj of objectives) {
                if (!objectivesByQuest.has(obj.quest_id)) {
                    objectivesByQuest.set(obj.quest_id, []);
                }
                objectivesByQuest.get(obj.quest_id).push(obj);
            }

            // Build quest templates
            for (const quest of quests) {
                this.questTemplates.set(quest.id, {
                    ...quest,
                    objectives: objectivesByQuest.get(quest.id) || []
                });
            }

            console.log(`[QuestSystem] Loaded ${this.questTemplates.size} quest templates`);
        } catch (error) {
            console.error('[QuestSystem] Error loading quests:', error);
        }
    }

    // ... (other quest system methods)
}

// ==================== INVENTORY & ITEMS ====================
class EnhancedInventorySystem {
    constructor() {
        this.items = new Map();
        this.equipmentSlots = {
            head: null,
            chest: null,
            legs: null,
            feet: null,
            hands: null,
            weapon: null,
            offhand: null,
            neck: null,
            ring1: null,
            ring2: null,
            trinket1: null,
            trinket2: null
        };
        this.bank = new Map();
        this.currency = {
            gold: 0,
            silver: 0,
            copper: 0,
            tokens: 0
        };
    }

    // ... (inventory system methods)
}

// ==================== MULTIPLAYER SYSTEM ====================
class MultiplayerSystem {
    constructor() {
        this.players = new Map();
        this.parties = new Map();
        this.raids = new Map();
        this.tradeRequests = new Map();
    }

    // ... (multiplayer system methods)
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize Supabase
        if (typeof supabase === 'undefined') {
            console.error('Supabase not initialized');
            return;
        }

        // Initialize game systems
        window.GameSystems.world = new WorldSystem(scene);
        window.GameSystems.classes = new ClassSystem();
        window.GameSystems.combat = new EnhancedCombatSystem(window.GameSystems.combat || {});
        window.GameSystems.quests = new EnhancedQuestSystem();
        window.GameSystems.inventory = new EnhancedInventorySystem();
        window.GameSystems.multiplayer = new MultiplayerSystem();

        // Load game data
        await Promise.all([
            window.GameSystems.classes.loadClasses(),
            window.GameSystems.combat.loadAbilities(),
            window.GameSystems.quests.loadQuests()
        ]);

        console.log('[Game] All systems initialized successfully');
    } catch (error) {
        console.error('[Game] Initialization error:', error);
    }
});

// ==================== HELPER FUNCTIONS ====================
function getRandomLoot(level, rarity) {
    // Implement loot generation logic
}

function calculateStatGrowth(base, growth, level) {
    return Math.floor(base + (growth * (level - 1)));
}

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        WorldSystem,
        ClassSystem,
        EnhancedCombatSystem,
        EnhancedQuestSystem,
        EnhancedInventorySystem,
        MultiplayerSystem
    };
}
