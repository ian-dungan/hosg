// Supabase + WebSocket networking

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

  // Prefer explicit SUPABASE_CONFIG first, then CONFIG.SUPABASE if available
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

  if (!this.config.url || !this.config.key) {
    console.warn("[Supabase] Missing URL or key; client not initialized.");
    return;
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

var supabaseService = new SupabaseService();

//
// Network Manager (WebSocket)
//

/**
 * Event Emitter stub for simple event handling
 */
function Emitter() {
  this._listeners = {};
}

Emitter.prototype.on = function (eventName, listener) {
  if (!this._listeners[eventName]) {
    this._listeners[eventName] = [];
  }
  this._listeners[eventName].push(listener);
};

Emitter.prototype.off = function (eventName, listener) {
  if (!this._listeners[eventName]) return;
  this._listeners[eventName] = this._listeners[eventName].filter(l => l !== listener);
};

Emitter.prototype._emit = function (eventName, data) {
  if (this._listeners[eventName]) {
    this._listeners[eventName].forEach(listener => {
      try {
        listener(data);
      } catch (err) {
        console.error(`[Network] Error in listener for ${eventName}:`, err);
      }
    });
  }
};


/**
 * @param {Game} game
 * @param {string} url
 */
function NetworkManager(game, url) {
  Emitter.call(this); // Initialize as an event emitter

  this.game = game;
  this.url = url;
  this.socket = null;
  this.connected = false;
  this.shouldReconnect = true;
  this.reconnectTimeout = 1000;
  this.maxReconnectTimeout = 30000;

  this._init();
}

// Inherit Emitter prototype
NetworkManager.prototype = Object.create(Emitter.prototype);
NetworkManager.prototype.constructor = NetworkManager;


NetworkManager.prototype._init = function () {
  this.supabase = supabaseService;
};

NetworkManager.prototype.connect = function () {
  if (this.connected || this.socket) {
    console.warn("[Network] Already connected or connecting.");
    return;
  }

  this.shouldReconnect = true;

  return new Promise((resolve, reject) => {
    try {
      this.socket = new WebSocket(this.url);
    } catch (err) {
      console.error("[Network] Failed to create WebSocket:", err);
      this._emit("error", err);
      this._reconnect();
      return reject(err);
    }

    var self = this;

    this.socket.onopen = function () {
      self.connected = true;
      self.reconnectTimeout = 1000; // Reset timeout on success
      console.log("[Network] ✅ Connected to server.");
      self._emit("connect");
      resolve();
    };

    this.socket.onmessage = function (event) {
      self._handleMessage(event);
    };

    this.socket.onclose = function (event) {
      self.connected = false;
      console.log("[Network] Disconnected from server.", event.code, event.reason);
      self._emit("disconnect", event);
      self.socket = null;
      if (self.shouldReconnect) {
        self._reconnect();
      }
    };

    this.socket.onerror = function (err) {
      console.error("[Network] WebSocket error:", err);
      self._emit("error", err);
    };
  });
};

NetworkManager.prototype._reconnect = function () {
  if (!this.shouldReconnect) return;

  var self = this;
  console.log(`[Network] Attempting to reconnect in ${this.reconnectTimeout / 1000}s...`);

  setTimeout(() => {
    if (self.shouldReconnect) {
      self.connect();
      self.reconnectTimeout = Math.min(self.reconnectTimeout * 2, self.maxReconnectTimeout);
    }
  }, this.reconnectTimeout);
};


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
 * as the eventName and the payload as `data` or pass a single data object.
 */
NetworkManager.prototype.send = function (eventName, data) {
  if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
    console.warn("[Network] Cannot send, socket not open");
    return false;
  }

  var payload;

  try {
    if (arguments.length === 1) {
        payload = JSON.stringify(eventName); // Assume eventName is the raw data object
    } else if (eventName == null) {
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

NetworkManager.prototype.dispose = function () {
  this.disconnect();
  this._listeners = {};
};
