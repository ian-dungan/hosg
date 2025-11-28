// Supabase + WebSocket networking

//
// Supabase wrapper
//
class SupabaseService {
  constructor(config) {
    this.config = config || {};
    this.client = null;
    this._init();
  }

  _init() {
    if (typeof window === "undefined") return;

    // Supabase SDK must be loaded from CDN (index.html already includes it)
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      console.warn("[Supabase] supabase-js CDN script not loaded; client not initialized.");
      return;
    }

    if (!this.config.url || !this.config.key) {
      console.warn("[Supabase] Missing URL or key; client not initialized.");
      return;
    }

    const { createClient } = window.supabase;

    try {
      this.client = createClient(this.config.url, this.config.key);
      console.log("[Supabase] client initialized");
    } catch (err) {
      console.error("[Supabase] Failed to create client:", err);
      this.client = null;
    }
  }

  getClient() {
    return this.client;
  }

  dispose() {
    this.client = null;
  }
}

// Global Supabase instance – safe even if SDK or config is missing
const supabaseService = new SupabaseService(window.SUPABASE_CONFIG || {});

//
// NetworkManager – evented WebSocket wrapper
//
function NetworkManager(url, options) {
  if (!(this instanceof NetworkManager)) {
    return new NetworkManager(url, options);
  }

  options = options || {};

  this.url = url;
  this.socket = null;
  this.connected = false;

  this.shouldReconnect = true;
  this.reconnectAttempts = 0;
  this.maxReconnectAttempts =
    options.maxReconnectAttempts != null ? options.maxReconnectAttempts : 5;
  this.reconnectDelay =
    options.reconnectDelay != null ? options.reconnectDelay : 3000;

  this.listeners = {};
}

NetworkManager.prototype.connect = function () {
  const self = this;

  if (typeof window === "undefined" || !("WebSocket" in window)) {
    console.warn("[Network] WebSocket not supported in this environment");
    return Promise.resolve();
  }

  if (self.connected) {
    return Promise.resolve();
  }

  if (self.socket && self.socket.readyState === WebSocket.CONNECTING) {
    // Already connecting; return a promise that resolves on open/error
    return new Promise(function (resolve, reject) {
      self.on("open", function () { resolve(); });
      self.on("error", function (err) { reject(err); });
    });
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
            // Further close/error events will handle logging
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

  var eventName =
    (payload && (payload.event || payload.type || payload.action)) ||
    "message";

  this._emit(eventName, payload);
  this._emit("message", payload);
};

NetworkManager.prototype.on = function (eventName, handler) {
  if (!this.listeners[eventName]) {
    this.listeners[eventName] = new Set();
  }
  this.listeners[eventName].add(handler);
};

NetworkManager.prototype.off = function (eventName, handler) {
  var set = this.listeners[eventName];
  if (!set) return;
  set.delete(handler);
  if (set.size === 0) {
    delete this.listeners[eventName];
  }
};

NetworkManager.prototype._emit = function (eventName, data) {
  var set = this.listeners[eventName];
  if (!set) return;

  set.forEach(function (handler) {
    try {
      handler(data);
    } catch (err) {
      console.error("[Network] Listener error for", eventName, err);
    }
  });
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

  try {
    var payload;

    if (eventName == null) {
      payload = typeof data === "string" ? data : JSON.stringify(data);
    } else {
      payload = JSON.stringify({ event: eventName, data: data });
    }

    this.socket.send(payload);
    return true;
  } catch (err) {
    console.error("[Network] Send error:", err);
    return false;
  }
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

window.SupabaseService = SupabaseService;
window.supabaseService = supabaseService;
window.NetworkManager = NetworkManager;
