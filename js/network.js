// Networking helpers, guarded to avoid redeclaration when scripts reload.
(function (global) {
  if (global.NetworkManager) {
    console.warn('[Network] Existing NetworkManager detected; skipping redefinition.');
    return;
  }

  const CONFIG = global.CONFIG || {};

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
// Simple WebSocket-based network manager
//
function NetworkManager(url, options) {
  options = options || {};
  this.url = url;
  this.socket = null;
  this.connected = false;
  this.listeners = {};

  this.shouldReconnect = options.shouldReconnect !== false;
  var defaultDelay = (typeof CONFIG !== "undefined" && CONFIG.NETWORK && CONFIG.NETWORK.RECONNECT_DELAY_MS) ? CONFIG.NETWORK.RECONNECT_DELAY_MS : 5000;
  this.reconnectDelay = options.reconnectDelay || defaultDelay;
  this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
  this.reconnectAttempts = 0;
}

NetworkManager.prototype.on = function (eventName, handler) {
  if (!this.listeners[eventName]) {
    this.listeners[eventName] = [];
  }
  this.listeners[eventName].push(handler);
};

NetworkManager.prototype._emit = function (eventName, payload) {
  var list = this.listeners[eventName];
  if (!list || !list.length) return;
  for (var i = 0; i < list.length; i++) {
    try {
      list[i](payload);
    } catch (err) {
      console.error("[Network] Listener for '" + eventName + "' threw:", err);
    }
  }
};

NetworkManager.prototype.connect = function () {
  var self = this;

  if (!self.url) {
    var err = new Error("WebSocket URL not configured");
    console.error("[Network] " + err.message);
    return Promise.reject(err);
  }

  if (self.socket && (self.socket.readyState === WebSocket.OPEN || self.socket.readyState === WebSocket.CONNECTING)) {
    return Promise.resolve();
  }

  return new Promise(function (resolve, reject) {
    try {
      self.socket = new WebSocket(self.url);
    } catch (err) {
      self._emit("error", err);
      reject(err);
      return;
    }

    self.socket.addEventListener("open", function () {
      self.connected = true;
      self.reconnectAttempts = 0;
      console.log("[Network] Connected to", self.url);
      self._emit("open");
      resolve();
    });

    self.socket.addEventListener("message", function (event) {
      self._handleMessage(event);
    });

    self.socket.addEventListener("close", function (event) {
      self.connected = false;
      self.socket = null;
      console.log("[Network] Disconnected", event);
      self._emit("close", event);

      if (!self.shouldReconnect) return;

      if (self.reconnectAttempts < self.maxReconnectAttempts) {
        self.reconnectAttempts += 1;
        var delay = self.reconnectDelay;
        console.log(
          "[Network] Reconnecting in " +
            delay +
            "ms (attempt " +
            self.reconnectAttempts +
            "/" +
            self.maxReconnectAttempts +
            ")"
        );
        setTimeout(function () {
          self.connect().catch(function () {
            // Errors will be handled by error/close events
          });
        }, delay);
      } else {
        console.warn("[Network] Max reconnect attempts reached");
        self._emit("maxReconnectReached");
      }
    });

    self.socket.addEventListener("error", function (err) {
      console.error("[Network] WebSocket error:", err);
      self._emit("error", err);
    });
  });
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

NetworkManager.prototype.dispose = function () {
  this.disconnect();
  this.listeners = {};
};

  global.SupabaseService = SupabaseService;
  global.supabaseService = supabaseService;
  global.NetworkManager = NetworkManager;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SupabaseService, NetworkManager, supabaseService };
  }
})(typeof window !== 'undefined' ? window : globalThis);

