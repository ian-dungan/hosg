// network.js
// WebSocket networking for multiplayer


//
// Network Manager
//
function NetworkManager(game, url) {
  var self = this;

  this.game = game;
  // Fallback to CONFIG.NETWORK.WS_URL if no URL is provided
  this.url = url || (typeof CONFIG !== 'undefined' && CONFIG.NETWORK ? CONFIG.NETWORK.WS_URL : null);
  
  if (!this.url) {
      console.error("[Network] No WebSocket URL provided in constructor or CONFIG.");
      return;
  }

  this.socket = null;
  this.connected = false;
  this.shouldReconnect = true;
  this.reconnectAttempt = 0;
  this.reconnectTimeout = null;

  this._handlers = {};

  // Attach to game events if necessary
  if (this.game && typeof this.game.on === "function") {
    this.game.on("playerCreated", function(player) {
        // If we connect before the player is created, try a new connection with the ID
        if (!self.connected) {
            self.connect();
        }
    });
  }
}

NetworkManager.prototype.on = function (eventName, handler) {
  if (!this._handlers[eventName]) {
    this._handlers[eventName] = [];
  }
  this._handlers[eventName].push(handler);
};

NetworkManager.prototype._emit = function (eventName, data) {
  if (this._handlers[eventName]) {
    this._handlers[eventName].forEach(function (handler) {
      handler(data);
    });
  }
};

NetworkManager.prototype.connect = function () {
  var self = this;
  this.shouldReconnect = true;
  this.reconnectTimeout = null;

  var maxAttempts = 10;
  if (this.reconnectAttempt >= maxAttempts) {
    console.warn("[Network] Max reconnection attempts reached. Giving up.");
    return;
  }
  
  // Use query parameter for game/room ID instead of appending to the path.
  var baseWSSUrl = this.url; // e.g., 'wss://hosg.onrender.com'
  var roomOrPlayerId = (this.game && this.game.player && this.game.player.id) ? 
                 this.game.player.id : 
                 'default_game';

  var serverUrl = baseWSSUrl;
  
  // Append ID as a query string (e.g., ?gameId=default_game)
  if (roomOrPlayerId) {
      // Check if the base URL already has a query string
      serverUrl += (serverUrl.includes('?') ? '&' : '?') + 'gameId=' + roomOrPlayerId;
  }
  
  console.log("[Network] Connecting to WebSocket:", serverUrl); // Log the new URL

  try {
    this.socket = new WebSocket(serverUrl);
  } catch (err) {
    console.error("[Network] Failed to create WebSocket:", err);
    return;
  }

  this.socket.onopen = function () {
    self.connected = true;
    self.reconnectAttempt = 0;
    console.log("[Network] Connected to server:", serverUrl);
    self._emit("connected");
  };

  this.socket.onmessage = function (event) {
    self._handleMessage(event);
  };

  this.socket.onclose = function (event) {
    self.connected = false;
    console.log("[Network] Disconnected from server.", event.code, event.reason);
    self._emit("disconnected", event);

    if (self.shouldReconnect) {
      self.reconnectAttempt++;
      var delay = Math.min(1000 * Math.pow(2, self.reconnectAttempt), 30000); // Exponential backoff up to 30s
      console.log("[Network] Attempting to reconnect in " + delay / 1000 + "s...");
      self.reconnectTimeout = setTimeout(function () {
        self.connect();
      }, delay);
    }
  };

  this.socket.onerror = function (err) {
    console.error("[Network] WebSocket error:", err);
    self._emit("error", err);
  };
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
  clearTimeout(this.reconnectTimeout);
  this.reconnectAttempt = 0;
};

NetworkManager.prototype.dispose = function () {
  this.disconnect();
  this._handlers = {};
  console.log("[Network] Disposed.");
};

// Export for Node.js/CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkManager;
}
