// ===========================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.2.0 (STORAGE BYPASS FIX)
// Fix: CRITICALLY sets 'auth.storage: null' to bypass browser tracking prevention
//      and allow the Supabase client to initialize and query the database.
// ===========================================================

function SupabaseService(config) {
    this.config = config || {};
    this.client = null;
    this.isOffline = false; // We'll keep this flag but hope to avoid setting it

    // 1. DEFINE YOUR CONNECTION VARIABLES
    // Note: It's safer to use the window global config if you set it in index.html,
    // but we'll use the hardcoded values here since they are confirmed correct.
    const supabaseUrl = 'https://vaxfoafjjybwcxwhicla.supabase.co';
    const supabaseKey = 'sb_publishable_zFmHKiJYok_bNJSjUL4DOA_h6XCC1YD';
    
    // --- 2. Initialize the Supabase Client SAFELY ---
    if (typeof supabase !== 'undefined') {
        try {
            // CRITICAL FIX: Explicitly set storage to null to prevent browser security errors.
            this.client = supabase.createClient(supabaseUrl, supabaseKey, {
                auth: {
                    storage: null // Tells the SDK not to use local storage/cookies
                }
            });
            console.log("[Network] Supabase client initialized successfully (Storage Bypassed).");

        } catch (err) {
            // This is unlikely to be hit with the fix above, but kept for robustness.
            console.error("[Network] Supabase initialization failed. Switching to OFFLINE MODE.", err);
            this.client = null;
            this.isOffline = true;
        }
    } else {
        console.error("[Network] Supabase client library not found. Check your HTML imports.");
        this.isOffline = true;
    }
}

// Load templates (Skills/NPCs) from DB or Fallback
SupabaseService.prototype.loadTemplates = async function(skillMap, npcMap) {
    console.log("[Network] Loading game templates...");

    // --- 1. Define Offline Fallbacks ---
    const OFFLINE_SKILLS = [
        { id: 'Cleave', code: 'CLEAVE', name: 'Cleave', skill_type: 'Attack', resource_cost: { mana: 0, stamina: 10 }, cooldown_ms: 5000, effect: { type: 'damage', base_value: 10, physical_scaling: 0.5 } },
        { id: 'Fireball', code: 'FIREBALL', name: 'Fireball', skill_type: 'Magic', resource_cost: { mana: 20, stamina: 0 }, cooldown_ms: 3000, effect: { type: 'damage', base_value: 15, magic_scaling: 0.8 } },
        { id: 'Heal', code: 'HEAL', name: 'Heal', skill_type: 'Magic', resource_cost: { mana: 30, stamina: 0 }, cooldown_ms: 8000, effect: { type: 'heal', base_value: 25 } }
    ];

    const OFFLINE_NPCS = [
        { id: 'Wolf', name: 'Wolf', model: 'wolf', level: 1, stats: { maxHealth: 30, attackPower: 5, moveSpeed: 0.18 }, defaultAbility: 'Bite' }
    ];

    // --- 2. Attempt Fetch from Supabase ---
    if (!this.isOffline && this.client) {
        try {
            // Fetch Skills
            let { data: skills, error: skillError } = await this.client.from('hosg_skills').select('*');
            if (skillError) throw skillError;
            skills.forEach(t => skillMap.set(t.id, t));
            console.log(`[Network] Loaded ${skills.length} skills from database.`);
            
            // Fetch NPCs
            let { data: npcs, error: npcError } = await this.client.from('hosg_npc_templates').select('*');
            if (npcError) throw npcError;
            npcs.forEach(t => npcMap.set(t.id, t));
            console.log(`[Network] Loaded ${npcs.length} NPCs from database.`);
            
            return; // Success!

        } catch (err) {
            console.warn("[Network] Database query failed or table access is denied. Falling back to offline templates.", err.message || err);
            this.isOffline = true;
            // Fall through to offline logic
        }
    }

    // --- 3. Apply Offline Fallbacks ---
    if (this.isOffline) {
        OFFLINE_SKILLS.forEach(t => skillMap.set(t.id, t));
        OFFLINE_NPCS.forEach(t => npcMap.set(t.id, t));
        console.log("[Network] Loaded templates from OFFLINE backup.");
        this.scene?.game?.ui?.showMessage("Warning: Running in Offline Mode (Storage Blocked)", 5000, 'error');
    }
};

SupabaseService.prototype.authenticate = async function () { return { error: "Storage Disabled" }; };
SupabaseService.prototype.saveCharacter = async function () { console.log("[Network] Save ignored (Storage Disabled)"); };

window.SupabaseService = SupabaseService;
