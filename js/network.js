// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.12 (PATCHED)
// Fix: Removed SyntaxError (missing parenthesis) in connect method.
// ============================================================

//
// Supabase wrapper
//
function SupabaseService(config) {
    this.config = config || {};
    this.client = null;
    this._init();
}

SupabaseService.prototype._init = function () {
    if (typeof window === "undefined") return;

    var globalConfig = window.SUPABASE_CONFIG || (typeof CONFIG !== "undefined" ? CONFIG.SUPABASE : null);
    if (globalConfig) {
        for (var k in globalConfig) {
            if (Object.prototype.hasOwnProperty.call(globalConfig, k)) {
                this.config[k] = globalConfig[k];
            }
        }
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        console.warn("[Supabase] supabase-js CDN script not loaded; client not initialized.");
        return;
    }

    // Default configuration if not set globally (replace with your actual URL/Key)
    if (!this.config.url) this.config.url = 'YOUR_SUPABASE_URL';
    if (!this.config.key) this.config.key = 'YOUR_SUPABASE_ANON_KEY';

    if (this.config.url === 'YOUR_SUPABASE_URL') {
        console.warn("[Supabase] Using placeholder URL/Key. Please update CONFIG.SUPABASE or window.SUPABASE_CONFIG.");
    }
    
    try {
        this.client = window.supabase.createClient(this.config.url, this.config.key);
        console.log("[Supabase] Client initialized");
    } catch (err) {
        console.error("[Supabase] Failed to create client:", err);
        this.client = null;
    }
};

SupabaseService.prototype.getClient = function () {
    return this.client;
};

SupabaseService.prototype._fetch = async function (tableName, label) {
    if (!this.client) {
        return { error: new Error(`Supabase client not initialized. Failed to fetch ${label}.`) };
    }
    console.log(`[Supabase] Fetching ${label}...`);
    try {
        const { data, error } = await this.client.from(tableName).select('*');
        if (error) {
            console.warn(`[Supabase] Failed to fetch ${label}:`, error);
            return { data: null, error: error };
        }
        return { data: data, error: null };
    } catch (error) {
        console.error(`[Supabase] Unknown error while fetching ${label}:`, error);
        return { data: null, error: error };
    }
};

SupabaseService.prototype.loadTemplates = async function () {
    console.log('[Supabase] Loading all templates...');

    try {
        let result;

        // Fetch Item Templates
        result = await this._fetch('hosg_item_templates', 'item templates');
        if (result.error) throw new Error('Failed to fetch item templates: ' + result.error.message);
        const itemTemplates = result.data;

        // Fetch Skill Templates
        result = await this._fetch('hosg_skill_templates', 'skill templates');
        if (result.error) throw new Error('Failed to fetch skill templates: ' + result.error.message);
        const skillTemplates = result.data;

        // Fetch NPC Templates
        result = await this._fetch('hosg_npc_templates', 'NPC templates');
        if (result.error) throw new Error('Failed to fetch NPC templates: ' + result.error.message);
        const npcTemplates = result.data;

        // Fetch Spawn Points (FIXED: Table name corrected from plural to singular)
        result = await this._fetch('hosg_spawn_point', 'spawn points'); 
        if (result.error) throw new Error('Failed to fetch spawn points: ' + result.error.message);
        const spawnPoints = result.data;

        this.templates = {
            itemTemplates: itemTemplates,
            skillTemplates: skillTemplates,
            npcTemplates: npcTemplates,
            spawnPoints: spawnPoints
        };

        return { success: true };

    } catch (error) {
        console.log(`[Supabase] Failed to load templates:`, error);
        return { success: false, error: error };
    }
};

SupabaseService.prototype.getCharacterData = async function (characterId) {
    if (!this.client) {
        return { error: 'Supabase client not initialized.' };
    }

    try {
        const { data: characterData, error: charError } = await this.client
            .from('hosg_characters')
            .select('*, hosg_character_items(*), hosg_character_equipment(*)')
            .eq('id', characterId)
            .single();

        if (charError) throw charError;

        return { success: true, data: characterData };
    } catch (error) {
        console.error('[Supabase] Failed to get character data:', error.message);
        return { success: false, error: error.message };
    }
};

SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
    if (!this.client) {
        return { success: false, error: 'Supabase client not initialized.' };
    }

    try {
        // 1. Update Character Table (Position, Stats, Health/Mana/Stamina)
        const { error: updateCharError } = await this.client
            .from('hosg_characters')
            .update({
                position_x: state.position.x,
                position_y: state.position.y,
                position_z: state.position.z,
                rotation_y: state.rotation_y,
                health: state.health,
                mana: state.mana,
                stamina: state.stamina,
                stats: state.stats
            })
            .eq('id', characterId);
            
        if (updateCharError) throw updateCharError;

        // 2. Update Inventory (Delete all, then insert new)
        await this.client.from('hosg_character_items').delete().eq('character_id', characterId); 
        const newInventoryData = state.inventory.map(item => ({ ...item, character_id: characterId, id: undefined }));
        if (newInventoryData.length > 0) {
             const { error: insertInvError } = await this.client.from('hosg_character_items').insert(newInventoryData);
            if (insertInvError) throw insertInvError;
        }

        // 3. Update Equipment
        await this.client.from('hosg_character_equipment').delete().eq('character_id', characterId); 
        const newEquipmentData = state.equipment.map(item => ({ ...item, character_id: characterId, id: undefined }));
        if (newEquipmentData.length > 0) {
            const { error: insertEquipError } = await this.client.from('hosg_character_equipment').insert(newEquipmentData);
            if (insertEquipError) throw insertEquipError;
        }

        return { success: true };

    } catch (error) {
        console.error('[Supabase] Failed to save character state:', error.message);
        return { success: false, error: error.message };
    }
};


var supabaseService = new SupabaseService();

//
// Network Manager (WebSocket)
//
function NetworkManager() {
    this.socket = null;
    this.connected = false;
    this.shouldReconnect = true;
    this.supabase = supabaseService;
    this._listeners = {};
}

// Event emitter utility
NetworkManager.prototype._emit = function(eventName, data) {
    if (this._listeners[eventName]) {
        this._listeners[eventName].forEach(listener => listener(data));
    }
};

NetworkManager.prototype.on = function(eventName, callback) {
    if (!this._listeners[eventName]) {
        this._listeners[eventName] = [];
    }
    this._listeners[eventName].push(callback);
};

NetworkManager.prototype.off = function(eventName, callback) {
    if (this._listeners[eventName]) {
        this._listeners[eventName] = this._listeners[eventName].filter(listener => listener !== callback);
    }
};

NetworkManager.prototype.connect = function (url) {
    var self = this;
    return new Promise((resolve, reject) => {
        if (self.socket && self.socket.readyState === WebSocket.OPEN) {
            resolve();
            return;
        }

        self.socket = new WebSocket(url);

        self.socket.onopen = function () {
            self.connected = true;
            console.log("[Network] WebSocket connected:", url);
            self._emit("connected", url);
            resolve();
        };

        self.socket.onmessage = function (event) {
            self._handleMessage(event);
        };

        self.socket.onclose = function (event) {
            self.connected = false;
            console.warn("[Network] WebSocket closed:", event.code, event.reason);
            self._emit("disconnected", event);

            // Reconnect logic
            if (self.shouldReconnect) {
                setTimeout(() => {
                    console.log("[Network] Attempting to reconnect...");
                    self.connect(url);
                }, 5000); 
            }
        };

        self.socket.onerror = function (err) {
            console.error("[Network] WebSocket error:", err);
            self._emit("error", err);
            reject(err);
        };
    });
}; // <-- The original error was a misplaced ')' right here.

NetworkManager.prototype._handleMessage = function (event) {
    var payload = event.data;

    try {
        payload = JSON.parse(event.data);
    } catch (e) {
        // Not JSON - leave as raw string
    }

    this._emit("message", payload);
};

/**
 * Send an event + data. If you just want to send a raw payload, pass `null`
 * as the eventName and the payload as `data`.
 */
NetworkManager.prototype.send = function (eventName, data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        console.warn("[Network] Cannot send, socket not open");
        return false;
    }

    var payload;

    try {
        if (eventName == null) {
            payload = data;
        } else {
            payload = JSON.stringify({ event: eventName, data: data });
        }
    } catch (err) {
        console.error("[Network] Failed to serialize message:", err);
        return false;
    }

    try {
        this.socket.send(payload);
    } catch (err) {
        console.error("[Network] Failed to send message:", err);
        return false;
    }

    return true;
};

NetworkManager.prototype.disconnect = function () {
    this.shouldReconnect = false;
    if (this.socket) {
        this.socket.close();
        this.socket = null;
    }
    this.connected = false;
};

NetworkManager.prototype.dispose = function() {
    this.disconnect();
};

window.SupabaseService = SupabaseService;
window.NetworkManager = NetworkManager;
