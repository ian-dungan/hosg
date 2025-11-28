// Supabase + WebSocket networking

class SupabaseService {
  constructor(config) {
    this.config = config || {};
    this.client = null;
    this._init();
  }

  _init() {
    if (typeof window === 'undefined') return;

    // Supabase SDK must be loaded from CDN
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.warn('[Supabase] supabase-js CDN script not loaded; client not initialized.');
      return;
    }

    const { createClient } = window.supabase;

    try {
      this.client = createClient(this.config.url, this.config.key);
      console.log('[Supabase] client initialized');
    } catch (err) {
      console.error('[Supabase] Failed to create client:', err);
      this.client = null;
    }
  }

  getClient() {
    return this.client;
  }
}

// Global Supabase instance – safe even if SDK is missing
window.supabaseService = new SupabaseService(
  window.SUPABASE_CONFIG || {
    url: 'https://vaxfoafjjybwcxwhicla.supabase.co',
    key: 'sb_publishable_zFmHKiJYok_bNJSjUL4DOA_h6XCC1YD'
  }
);


class NetworkManager {
  constructor(url) {
    this.url = url || CONFIG.NETWORK.WS_URL;
    this.socket = null;
    this.connected = false;
    this.shouldReconnect = true;
    this.reconnectDelay = CONFIG.NETWORK.RECONNECT_DELAY_MS || 5000;
    this.listeners = {}; // eventName -> Set<handler>
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  async connect() {
    if (typeof window === "undefined" || !("WebSocket" in window)) {
      console.error("[Network] WebSocket not supported in this environment");
      return Promise.reject(new Error("WebSocket not supported"));
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      console.log("[Network] Connecting to", this.url);
      
      try {
        const socket = new WebSocket(this.url);
        this.socket = socket;

        const timeout = setTimeout(() => {
          if (socket.readyState !== WebSocket.OPEN) {
            socket.close();
            reject(new Error("Connection timeout"));
          }
        }, CONFIG.NETWORK.TIMEOUT);

        socket.onopen = () => {
          clearTimeout(timeout);
          console.log("[Network] Connected successfully");
          this.connected = true;
          this.reconnectAttempts = 0;
          this._emit("open");
          resolve();
        };

        socket.onmessage = (event) => {
          this._handleMessage(event);
        };

        socket.onerror = (error) => {
          clearTimeout(timeout);
          console.error("[Network] WebSocket error", error);
          this._emit("error", error);
        };

        socket.onclose = (event) => {
          clearTimeout(timeout);
          console.warn("[Network] Disconnected", event.code, event.reason);
          this.connected = false;
          this._emit("close", event);

          if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
            console.log(`[Network] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
              this.connect().catch(() => {});
            }, delay);
          } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error("[Network] Max reconnection attempts reached");
            this._emit("maxReconnectReached");
          }
        };
      } catch (err) {
        console.error("[Network] Failed to create WebSocket:", err);
        reject(err);
      }
    });
  }

  _handleMessage(event) {
    let payload = event.data;

    try {
      payload = JSON.parse(event.data);
    } catch {
      // Not JSON - leave as raw string
    }

    const eventName =
      (payload && (payload.event || payload.type || payload.action)) ||
      "message";

    this._emit(eventName, payload);
    this._emit("message", payload);
  }

  on(eventName, handler) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = new Set();
    }
    this.listeners[eventName].add(handler);
  }

  off(eventName, handler) {
    const set = this.listeners[eventName];
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      delete this.listeners[eventName];
    }
  }

  _emit(eventName, data) {
    const set = this.listeners[eventName];
    if (!set) return;

    for (const handler of set) {
      try {
        handler(data);
      } catch (err) {
        console.error("[Network] Listener error for", eventName, err);
      }
    }
  }

  send(eventName, data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn("[Network] Cannot send, socket not open");
      return false;
    }

    try {
      const payload = JSON.stringify({ event: eventName, data });
      this.socket.send(payload);
      return true;
    } catch (err) {
      console.error("[Network] Send error:", err);
      return false;
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
  }

  dispose() {
    this.disconnect();
    this.listeners = {};
  }
}

window.NetworkManager = NetworkManager;
window.SupabaseService = SupabaseService;
window.supabaseService = supabaseService;
