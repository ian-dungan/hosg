// Networking: Supabase + WebSocket client

class SupabaseService {
  constructor(config) {
    this.config = config || {};
    this.client = null;
    this._init();
  }

  _init() {
    if (typeof window === "undefined") return;

    if (!window.supabase) {
      console.warn("[Supabase] supabase-js CDN script not loaded; client not initialized.");
      return;
    }

    const { createClient } = window.supabase || {};
    if (!createClient) {
      console.warn("[Supabase] createClient not available on global supabase.");
      return;
    }

    try {
      this.client = createClient(this.config.URL, this.config.KEY);
      console.log("[Supabase] client initialized");
    } catch (err) {
      console.error("[Supabase] failed to initialize client", err);
    }
  }

  isReady() {
    return !!this.client;
  }

  // Add your table helpers here later, e.g.:
  // async getProfileById(id) { ... }
  // async upsertProfile(row) { ... }
}

const supabaseService = new SupabaseService(CONFIG.SUPABASE);

class NetworkManager {
  constructor(url) {
    this.url = url || CONFIG.NETWORK.WS_URL;
    this.socket = null;
    this.connected = false;
    this.shouldReconnect = true;
    this.reconnectDelay = CONFIG.NETWORK.RECONNECT_DELAY_MS || 5000;
    this.listeners = {}; // eventName -> Set<handler>
  }

  async connect() {
    if (typeof window === "undefined" || !("WebSocket" in window)) {
      console.error("[Network] WebSocket not supported in this environment");
      return;
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    return new Promise((resolve, reject) => {
      console.log("[Network] Connecting to", this.url);
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.onopen = () => {
        console.log("[Network] Connected");
        this.connected = true;
        this._emit("open");
        resolve();
      };

      socket.onmessage = (event) => {
        this._handleMessage(event);
      };

      socket.onerror = (error) => {
        console.error("[Network] Error", error);
        this._emit("error", error);
      };

      socket.onclose = (event) => {
        console.warn("[Network] Disconnected", event.code, event.reason);
        this.connected = false;
        this._emit("close", event);

        if (this.shouldReconnect) {
          setTimeout(() => {
            this.connect().catch(() => {});
          }, this.reconnectDelay);
        }
      };
    });
  }

  _handleMessage(event) {
    let payload = event.data;

    try {
      payload = JSON.parse(event.data);
    } catch {
      // Not JSON – leave as raw string
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
        console.error("[Network] listener error for", eventName, err);
      }
    }
  }

  send(eventName, data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn("[Network] Cannot send, socket not open");
      return;
    }

    const payload = JSON.stringify({ event: eventName, data });
    this.socket.send(payload);
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
  }
}

window.NetworkManager = NetworkManager;
window.SupabaseService = SupabaseService;
window.supabaseService = supabaseService;
