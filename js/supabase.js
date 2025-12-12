// Supabase Database Service
// Handles all database operations for Heroes of Shady Grove

class SupabaseService {
    constructor() {
        // Supabase configuration
        this.supabaseUrl = 'https://vaxfoafjjybwcxwhicla.supabase.co';
        this.supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZheGZvYWZqanlid2N4d2hpY2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3OTQzODUsImV4cCI6MjA3OTM3MDM4NX0.jicdzNbleedqsvzmLZkNvGlIbjR8laXVasuKKRR-Hb4';
        
        this.client = null;
        this.currentSession = null;
        this.currentAccount = null;
        this.currentCharacter = null;
        
        this.init();
    }
    
    init() {
        // Initialize Supabase client
        if (typeof supabase === 'undefined') {
            console.error('[SupabaseService] Supabase library not loaded!');
            console.error('[SupabaseService] Add: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>');
            return;
        }
        
        this.client = supabase.createClient(this.supabaseUrl, this.supabaseKey);
        console.log('[SupabaseService] ✓ Initialized');
        
        // Check for existing session
        this.loadSession();
    }
    
    // =============================================
    // AUTHENTICATION
    // =============================================
    
    async register(username, password) {
        try {
            // Validate username
            if (!username || username.length < 3) {
                throw new Error('Username must be at least 3 characters');
            }
            
            if (!/^[a-zA-Z0-9]+$/.test(username)) {
                throw new Error('Username can only contain letters and numbers');
            }
            
            // Check if username exists
            const { data: existing } = await this.client
                .from('hosg_accounts')
                .select('id')
                .eq('username', username)
                .single();
            
            if (existing) {
                throw new Error('Username already exists');
            }
            
            // Hash password (simple hash - in production use proper bcrypt)
            const passwordHash = await this.hashPassword(password);
            
            // Create dummy email since schema requires it
            const email = `${username}@hosg.local`;
            
            // Create account
            const { data: account, error } = await this.client
                .from('hosg_accounts')
                .insert({
                    username: username,
                    email: email,
                    password_hash: passwordHash,
                    last_login_at: new Date().toISOString()
                })
                .select()
                .single();
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Account created:', username);
            
            // Auto-login after registration
            return await this.login(username, password);
            
        } catch (error) {
            console.error('[SupabaseService] Registration failed:', error);
            throw error;
        }
    }
    
    async login(username, password) {
        try {
            // Get account
            const { data: account, error } = await this.client
                .from('hosg_accounts')
                .select('*')
                .eq('username', username)
                .single();
            
            if (error || !account) {
                throw new Error('Invalid username or password');
            }
            
            // Check if banned
            if (account.is_banned) {
                throw new Error(`Account banned: ${account.banned_reason || 'No reason provided'}`);
            }
            
            // Verify password
            const passwordHash = await this.hashPassword(password);
            if (passwordHash !== account.password_hash) {
                throw new Error('Invalid username or password');
            }
            
            // Update last login
            await this.client
                .from('hosg_accounts')
                .update({ last_login_at: new Date().toISOString() })
                .eq('id', account.id);
            
            // Create session token
            const token = this.generateToken();
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour session
            
            const { data: session, error: sessionError } = await this.client
                .from('hosg_account_sessions')
                .insert({
                    account_id: account.id,
                    token: token,
                    expires_at: expiresAt.toISOString(),
                    last_seen_at: new Date().toISOString()
                })
                .select()
                .single();
            
            if (sessionError) throw sessionError;
            
            // Store session locally
            this.currentSession = session;
            this.currentAccount = account;
            localStorage.setItem('hosg_session_token', token);
            localStorage.setItem('hosg_account_id', account.id);
            
            console.log('[SupabaseService] ✓ Logged in:', username);
            
            return { account, session };
            
        } catch (error) {
            console.error('[SupabaseService] Login failed:', error);
            throw error;
        }
    }
    
    async logout() {
        try {
            if (this.currentSession) {
                // Delete session from database
                await this.client
                    .from('hosg_account_sessions')
                    .delete()
                    .eq('token', this.currentSession.token);
            }
            
            // Clear local data
            this.currentSession = null;
            this.currentAccount = null;
            this.currentCharacter = null;
            localStorage.removeItem('hosg_session_token');
            localStorage.removeItem('hosg_account_id');
            localStorage.removeItem('hosg_character_id');
            
            console.log('[SupabaseService] ✓ Logged out');
            
        } catch (error) {
            console.error('[SupabaseService] Logout error:', error);
        }
    }
    
    async loadSession() {
        try {
            const token = localStorage.getItem('hosg_session_token');
            const accountId = localStorage.getItem('hosg_account_id');
            
            if (!token || !accountId) return false;
            
            // Verify session is valid
            const { data: session, error } = await this.client
                .from('hosg_account_sessions')
                .select('*')
                .eq('token', token)
                .eq('account_id', accountId)
                .single();
            
            if (error || !session) {
                this.logout();
                return false;
            }
            
            // Check if expired
            if (new Date(session.expires_at) < new Date()) {
                this.logout();
                return false;
            }
            
            // Load account
            const { data: account } = await this.client
                .from('hosg_accounts')
                .select('*')
                .eq('id', accountId)
                .single();
            
            if (!account || account.is_banned) {
                this.logout();
                return false;
            }
            
            // Update last seen
            await this.client
                .from('hosg_account_sessions')
                .update({ last_seen_at: new Date().toISOString() })
                .eq('token', token);
            
            this.currentSession = session;
            this.currentAccount = account;
            
            console.log('[SupabaseService] ✓ Session restored:', account.username);
            return true;
            
        } catch (error) {
            console.error('[SupabaseService] Session load error:', error);
            return false;
        }
    }
    
    // =============================================
    // CHARACTERS
    // =============================================
    
    async getCharacters() {
        if (!this.currentAccount) throw new Error('Not logged in');
        
        try {
            const { data: characters, error } = await this.client
                .from('hosg_characters')
                .select('*')
                .eq('user_id', this.currentAccount.id)
                .order('name');
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Loaded', characters.length, 'characters');
            return characters || [];
            
        } catch (error) {
            console.error('[SupabaseService] Failed to load characters:', error);
            throw error;
        }
    }
    
    async createCharacter(name) {
        if (!this.currentAccount) throw new Error('Not logged in');
        
        try {
            // Validate name
            if (!name || name.length < 3) {
                throw new Error('Character name must be at least 3 characters');
            }
            
            if (!/^[a-zA-Z0-9]+$/.test(name)) {
                throw new Error('Character name can only contain letters and numbers');
            }
            
            // Check if name exists (globally unique)
            const { data: existing } = await this.client
                .from('hosg_characters')
                .select('id')
                .eq('name', name)
                .single();
            
            if (existing) {
                throw new Error('Character name already exists');
            }
            
            // Check character limit (10 max)
            const { data: existingChars } = await this.client
                .from('hosg_characters')
                .select('id')
                .eq('user_id', this.currentAccount.id);
            
            if (existingChars && existingChars.length >= 10) {
                throw new Error('Maximum 10 characters per account');
            }
            
            // Create character with default starting values
            const { data: character, error } = await this.client
                .from('hosg_characters')
                .insert({
                    user_id: this.currentAccount.id,
                    name: name,
                    level: 1,
                    position_x: 0,
                    position_y: 5,
                    position_z: 0,
                    rotation_y: 0,
                    health: 100,
                    mana: 50,
                    stamina: 100,
                    stats: {
                        xp: 0,
                        gold: 0,
                        strength: 10,
                        agility: 10,
                        intelligence: 10
                    }
                })
                .select()
                .single();
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Character created:', name);
            return character;
            
        } catch (error) {
            console.error('[SupabaseService] Failed to create character:', error);
            throw error;
        }
    }
    
    async selectCharacter(characterId) {
        if (!this.currentAccount) throw new Error('Not logged in');
        
        try {
            const { data: character, error } = await this.client
                .from('hosg_characters')
                .select('*')
                .eq('id', characterId)
                .eq('user_id', this.currentAccount.id)
                .single();
            
            if (error || !character) {
                throw new Error('Character not found');
            }
            
            this.currentCharacter = character;
            localStorage.setItem('hosg_character_id', characterId);
            
            console.log('[SupabaseService] ✓ Character selected:', character.name);
            return character;
            
        } catch (error) {
            console.error('[SupabaseService] Failed to select character:', error);
            throw error;
        }
    }
    
    async deleteCharacter(characterId) {
        if (!this.currentAccount) throw new Error('Not logged in');
        
        try {
            const { error } = await this.client
                .from('hosg_characters')
                .delete()
                .eq('id', characterId)
                .eq('user_id', this.currentAccount.id);
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Character deleted');
            
        } catch (error) {
            console.error('[SupabaseService] Failed to delete character:', error);
            throw error;
        }
    }
    
    async saveCharacter(characterData) {
        if (!this.currentCharacter) throw new Error('No character selected');
        
        try {
            const { error } = await this.client
                .from('hosg_characters')
                .update({
                    level: characterData.level,
                    position_x: characterData.position.x,
                    position_y: characterData.position.y,
                    position_z: characterData.position.z,
                    rotation_y: characterData.rotation,
                    health: characterData.health,
                    mana: characterData.mana,
                    stamina: characterData.stamina,
                    stats: characterData.stats
                })
                .eq('id', this.currentCharacter.id);
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Character saved');
            
        } catch (error) {
            console.error('[SupabaseService] Failed to save character:', error);
            throw error;
        }
    }
    
    // =============================================
    // NPC & ENEMY SPAWNS
    // =============================================
    
    async getNPCSpawns(zoneId = 1) {
        try {
            const { data, error } = await this.client
                .from('hosg_npc_spawns')
                .select(`
                    *,
                    template:hosg_npc_templates(*)
                `)
                .eq('zone_id', zoneId);
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Loaded', data?.length || 0, 'NPC spawns for zone', zoneId);
            return data || [];
            
        } catch (error) {
            console.error('[SupabaseService] Failed to load NPC spawns:', error);
            return [];
        }
    }
    
    async getEnemySpawns(zoneId = 1) {
        try {
            // Enemies are NPCs with faction 'hostile'
            const { data, error } = await this.client
                .from('hosg_npc_spawns')
                .select(`
                    *,
                    template:hosg_npc_templates(*)
                `)
                .eq('zone_id', zoneId)
                .eq('template.faction', 'hostile');
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Loaded', data?.length || 0, 'enemy spawns for zone', zoneId);
            return data || [];
            
        } catch (error) {
            console.error('[SupabaseService] Failed to load enemy spawns:', error);
            return [];
        }
    }
    
    async getFriendlyNPCSpawns(zoneId = 1) {
        try {
            // Friendly NPCs
            const { data, error } = await this.client
                .from('hosg_npc_spawns')
                .select(`
                    *,
                    template:hosg_npc_templates(*)
                `)
                .eq('zone_id', zoneId)
                .eq('template.faction', 'friendly');
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Loaded', data?.length || 0, 'friendly NPC spawns for zone', zoneId);
            return data || [];
            
        } catch (error) {
            console.error('[SupabaseService] Failed to load friendly NPC spawns:', error);
            return [];
        }
    }
    
    // =============================================
    // INVENTORY & ITEMS
    // =============================================
    
    async getCharacterInventory() {
        if (!this.currentCharacter) {
            console.warn('[SupabaseService] No character selected');
            return [];
        }
        
        try {
            const { data, error } = await this.client
                .from('hosg_character_items')
                .select(`
                    *,
                    template:hosg_item_templates(*)
                `)
                .eq('character_id', this.currentCharacter.id)
                .eq('location_type', 'inventory')
                .order('slot_index');
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Loaded', data?.length || 0, 'inventory items');
            return data || [];
            
        } catch (error) {
            console.error('[SupabaseService] Failed to load inventory:', error);
            return [];
        }
    }
    
    async saveInventory(inventoryData) {
        if (!this.currentCharacter) throw new Error('No character selected');
        
        try {
            // Delete existing inventory
            await this.client
                .from('hosg_character_items')
                .delete()
                .eq('character_id', this.currentCharacter.id)
                .eq('location_type', 'inventory');
            
            // Insert new inventory
            if (inventoryData.length > 0) {
                const itemsToInsert = inventoryData.map(item => ({
                    character_id: this.currentCharacter.id,
                    item_template_id: item.item_template_id,
                    quantity: item.quantity,
                    slot_index: item.slot_index,
                    location_type: 'inventory'
                }));
                
                const { error } = await this.client
                    .from('hosg_character_items')
                    .insert(itemsToInsert);
                
                if (error) throw error;
            }
            
            console.log('[SupabaseService] ✓ Inventory saved');
            
        } catch (error) {
            console.error('[SupabaseService] Failed to save inventory:', error);
            throw error;
        }
    }
    
    // =============================================
    // QUESTS
    // =============================================
    
    async getCharacterQuests() {
        if (!this.currentCharacter) return [];
        
        try {
            const { data, error } = await this.client
                .from('hosg_character_quests')
                .select(`
                    *,
                    template:hosg_quest_templates(*)
                `)
                .eq('character_id', this.currentCharacter.id);
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Loaded', data?.length || 0, 'quests');
            return data || [];
            
        } catch (error) {
            console.error('[SupabaseService] Failed to load quests:', error);
            return [];
        }
    }
    
    async startQuest(questId) {
        if (!this.currentCharacter) throw new Error('No character selected');
        
        try {
            const { data, error } = await this.client
                .from('hosg_character_quests')
                .insert({
                    character_id: this.currentCharacter.id,
                    quest_id: questId,
                    status: 'active',
                    progress: {}
                })
                .select(`
                    *,
                    template:hosg_quest_templates(*)
                `)
                .single();
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Quest started:', data.template.name);
            return data;
            
        } catch (error) {
            console.error('[SupabaseService] Failed to start quest:', error);
            throw error;
        }
    }
    
    async updateQuestProgress(questId, progress) {
        try {
            const { error } = await this.client
                .from('hosg_character_quests')
                .update({ progress })
                .eq('id', questId);
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Quest progress updated');
            
        } catch (error) {
            console.error('[SupabaseService] Failed to update quest progress:', error);
            throw error;
        }
    }
    
    async completeQuest(questId) {
        try {
            const { error } = await this.client
                .from('hosg_character_quests')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString()
                })
                .eq('id', questId);
            
            if (error) throw error;
            
            console.log('[SupabaseService] ✓ Quest completed');
            
        } catch (error) {
            console.error('[SupabaseService] Failed to complete quest:', error);
            throw error;
        }
    }
    
    // =============================================
    // UTILITIES
    // =============================================
    
    async hashPassword(password) {
        // Simple hash for demo - use proper bcrypt in production
        const encoder = new TextEncoder();
        const data = encoder.encode(password + 'hosg_salt_2024');
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    generateToken() {
        return 'hosg_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
    
    isLoggedIn() {
        return !!this.currentAccount;
    }
    
    hasCharacter() {
        return !!this.currentCharacter;
    }
}

// Create global instance
window.supabaseService = new SupabaseService();
console.log('[SupabaseService] Service initialized');
