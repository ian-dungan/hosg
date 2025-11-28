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
    this.url = url;
    this.socket = null;
    this.connected = false;
  }

  connect() {
    if (this.connected || this.socket) return;

    this.socket = new WebSocket(this.url);

    this.socket.addEventListener('open', () => {
      this.connected = true;
      console.log('[Network] Connected to', this.url);
    });

    this.socket.addEventListener('message', (event) => {
      // Handle messages from server
      // console.log('[Network] Message:', event.data);
    });

    this.socket.addEventListener('close', () => {
      this.connected = false;
      this.socket = null;
      console.log('[Network] Disconnected');
    });

    this.socket.addEventListener('error', (err) => {
      console.error('[Network] WebSocket error:', err);
    });
  }

  send(data) {
    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(data));
  }

  disconnect() {
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

// Expose globally if other scripts need it
window.NetworkManager = NetworkManager;


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
