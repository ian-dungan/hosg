// ===========================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.2.0 (FIXED)
// Fixes: Correct table names, better offline handling
// ===========================================================

function SupabaseService(config) {
    this.config = config || {};
    this.client = null;
    this.isOffline = false;
    
    // 1. DEFINE YOUR CONNECTION VARIABLES
    const supabaseUrl = 'https://vaxfoafjjybwcxwhicla.supabase.co';
    const supabaseKey = 'sb_publishable_zFmHKiJYok_bNJSjUL4DOA_h6XCC1YD';
    
    // 2. Initialize the Supabase Client safely
    if (typeof supabase !== 'undefined') {
        try {
            this.client = supabase.createClient(supabaseUrl, supabaseKey);
            console.log("[Network] Supabase client initialized.");
        } catch (err) {
            console.warn("[Network] Supabase initialization blocked (Tracking Prevention). Switching to Offline Mode.");
            this.client = null;
            this.isOffline = true;
        }
    } else {
        console.warn("[Network] Supabase library not found. Switching to Offline Mode.");
        this.isOffline = true;
    }
}

// Load templates (Skills/NPCs) from DB or Fallback
SupabaseService.prototype.loadTemplates = async function(skillMap, npcMap) {
    console.log("[Network] Loading game templates...");

    // --- 1. Define Offline Fallbacks (Used if DB fails) ---
    const OFFLINE_SKILLS = [
        {
            id: 'Cleave',
            code: 'CLEAVE',
            name: 'Cleave',
            skill_type: 'Attack',
            resource_cost: { mana: 0, stamina: 10 },
            cooldown_ms: 5000,
            effect: { type: 'damage', base_value: 10, physical_scaling: 0.5 }
        },
        {
            id: 'Fireball',
            code: 'FIREBALL',
            name: 'Fireball',
            skill_type: 'Magic',
            resource_cost: { mana: 20, stamina: 0 },
            cooldown_ms: 3000,
            effect: { type: 'damage', base_value: 15, magic_scaling: 0.8 }
        },
        {
            id: 'Heal',
            code: 'HEAL',
            name: 'Heal',
            skill_type: 'Magic',
            resource_cost: { mana: 30, stamina: 0 },
            cooldown_ms: 8000,
            effect: { type: 'heal', base_value: 25 }
        },
        {
            id: 'Bite',
            code: 'BITE',
            name: 'Bite',
            skill_type: 'Attack',
            resource_cost: { mana: 0, stamina: 5 },
            cooldown_ms: 2000,
            effect: { type: 'damage', base_value: 8, physical_scaling: 0.8 }
        }
    ];

    const OFFLINE_NPCS = [
        {
            id: 'Wolf',
            code: 'WOLF',
            name: 'Wolf',
            model: 'wolf', 
            level: 1,
            stats: { maxHealth: 30, attackPower: 5, moveSpeed: 0.18 },
            defaultAbility: 'Bite' 
        }
    ];

    // --- 2. Attempt Fetch from Supabase ---
    if (!this.isOffline && this.client) {
        try {
            // Fetch Skills (FIXED: correct table name)
            const { data: skills, error: skillError } = await this.client.from('hosg_skill_templates').select('*');
            if (!skillError && skills && skills.length > 0) {
                skills.forEach(t => skillMap.set(t.code || t.id, t));
                console.log(`[Network] Loaded ${skills.length} skills from database.`);
            } else {
                console.warn("[Network] No skills loaded from DB, using offline data");
                throw new Error("Skill fetch failed");
            }

            // Fetch NPCs (FIXED: correct table name)
            const { data: npcs, error: npcError } = await this.client.from('hosg_npc_templates').select('*');
            if (!npcError && npcs && npcs.length > 0) {
                npcs.forEach(t => npcMap.set(t.code || t.id, t));
                console.log(`[Network] Loaded ${npcs.length} NPCs from database.`);
            } else {
                console.warn("[Network] No NPCs loaded from DB, using offline data");
                throw new Error("NPC fetch failed");
            }
            
            return; // Success! Exit function.

        } catch (err) {
            console.warn("[Network] Database connection failed. Using offline templates.", err.message || err);
            // Fall through to offline logic below
        }
    }

    // --- 3. Apply Offline Fallbacks ---
    OFFLINE_SKILLS.forEach(t => skillMap.set(t.code || t.id, t));
    OFFLINE_NPCS.forEach(t => npcMap.set(t.code || t.id, t));
    console.log(`[Network] Loaded ${OFFLINE_SKILLS.length} skills and ${OFFLINE_NPCS.length} NPCs from OFFLINE backup.`);
};

SupabaseService.prototype.authenticate = async function () { return { error: "Offline Mode" }; };
SupabaseService.prototype.saveCharacter = async function () { console.log("[Network] Save ignored (Offline)"); };

window.SupabaseService = SupabaseService;
