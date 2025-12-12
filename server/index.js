// ============================================================================
// HEROES OF SHADY GROVE - MULTIPLAYER SERVER
// WebSocket server for real-time multiplayer
// ============================================================================

const WebSocket = require('ws');
const http = require('http');

// Configuration
const PORT = process.env.PORT || 8080;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const POSITION_UPDATE_RATE = 100; // Send position updates every 100ms

// Game state
const players = new Map(); // sessionId -> player data
const rooms = new Map(); // roomId -> Set of player sessionIds

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      players: players.size,
      rooms: rooms.size,
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Heroes of Shady Grove Multiplayer Server\n' +
            `Players Online: ${players.size}\n` +
            `Rooms: ${rooms.size}`);
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

console.log('='.repeat(60));
console.log('Heroes of Shady Grove - Multiplayer Server');
console.log('='.repeat(60));

// Helper: Broadcast to all players in a room except sender
function broadcastToRoom(roomId, senderId, data) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  room.forEach(playerId => {
    if (playerId !== senderId) {
      const player = players.get(playerId);
      if (player && player.ws && player.ws.readyState === WebSocket.OPEN) {
        try {
          player.ws.send(JSON.stringify(data));
        } catch (err) {
          console.error(`[Broadcast] Failed to send to ${playerId}:`, err.message);
        }
      }
    }
  });
}

// Helper: Broadcast to all players in a room including sender
function broadcastToRoomAll(roomId, data) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  room.forEach(playerId => {
    const player = players.get(playerId);
    if (player && player.ws && player.ws.readyState === WebSocket.OPEN) {
      try {
        player.ws.send(JSON.stringify(data));
      } catch (err) {
        console.error(`[Broadcast] Failed to send to ${playerId}:`, err.message);
      }
    }
  });
}

// Helper: Get all players in a room
function getPlayersInRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  
  const playerList = [];
  room.forEach(playerId => {
    const player = players.get(playerId);
    if (player) {
      playerList.push({
        sessionId: player.sessionId,
        characterName: player.characterName,
        characterId: player.characterId,
        position: player.position,
        rotation: player.rotation,
        level: player.level
      });
    }
  });
  
  return playerList;
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const sessionId = generateSessionId();
  const ipAddress = req.socket.remoteAddress;
  
  console.log(`[Connect] New connection: ${sessionId} from ${ipAddress}`);
  
  // Initialize player data
  const playerData = {
    sessionId,
    ws,
    ipAddress,
    roomId: null,
    characterName: null,
    characterId: null,
    position: { x: 0, y: 5, z: 0 },
    rotation: 0,
    level: 1,
    isAlive: true,
    lastHeartbeat: Date.now(),
    connectedAt: Date.now()
  };
  
  players.set(sessionId, playerData);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    sessionId: sessionId,
    serverTime: Date.now()
  }));
  
  // Message handler
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(sessionId, message);
    } catch (err) {
      console.error(`[Message] Parse error from ${sessionId}:`, err.message);
    }
  });
  
  // Disconnection handler
  ws.on('close', () => {
    handleDisconnect(sessionId);
  });
  
  // Error handler
  ws.on('error', (err) => {
    console.error(`[Error] WebSocket error for ${sessionId}:`, err.message);
  });
  
  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    const player = players.get(sessionId);
    if (player) {
      player.lastHeartbeat = Date.now();
    }
  });
});

// Message handler
function handleMessage(sessionId, message) {
  const player = players.get(sessionId);
  if (!player) return;
  
  switch (message.type) {
    case 'join':
      handleJoin(sessionId, message);
      break;
      
    case 'position':
      handlePosition(sessionId, message);
      break;
      
    case 'chat':
      handleChat(sessionId, message);
      break;
      
    case 'action':
      handleAction(sessionId, message);
      break;
      
    case 'heartbeat':
      player.lastHeartbeat = Date.now();
      break;
      
    default:
      console.log(`[Message] Unknown type from ${sessionId}: ${message.type}`);
  }
}

// Join room handler
function handleJoin(sessionId, message) {
  const player = players.get(sessionId);
  if (!player) return;
  
  const roomId = message.roomId || 'default_room';
  const characterName = message.characterName || 'Adventurer';
  const characterId = message.characterId;
  
  // Update player data
  player.roomId = roomId;
  player.characterName = characterName;
  player.characterId = characterId;
  player.level = message.level || 1;
  
  if (message.position) {
    player.position = message.position;
  }
  
  // Add to room
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  rooms.get(roomId).add(sessionId);
  
  console.log(`[Join] ${characterName} (${sessionId}) joined room: ${roomId}`);
  
  // Send existing players in room
  const existingPlayers = getPlayersInRoom(roomId).filter(p => p.sessionId !== sessionId);
  player.ws.send(JSON.stringify({
    type: 'players',
    players: existingPlayers
  }));
  
  // Notify others of new player
  broadcastToRoom(roomId, sessionId, {
    type: 'player_joined',
    player: {
      sessionId: player.sessionId,
      characterName: player.characterName,
      characterId: player.characterId,
      position: player.position,
      rotation: player.rotation,
      level: player.level
    }
  });
  
  // Send join confirmation
  player.ws.send(JSON.stringify({
    type: 'joined',
    roomId: roomId,
    playersOnline: rooms.get(roomId).size
  }));
}

// Position update handler
function handlePosition(sessionId, message) {
  const player = players.get(sessionId);
  if (!player || !player.roomId) return;
  
  // Update player position
  if (message.position) {
    player.position = message.position;
  }
  if (message.rotation !== undefined) {
    player.rotation = message.rotation;
  }
  
  // Broadcast to room
  broadcastToRoom(player.roomId, sessionId, {
    type: 'position',
    sessionId: sessionId,
    position: player.position,
    rotation: player.rotation
  });
}

// Chat handler
function handleChat(sessionId, message) {
  const player = players.get(sessionId);
  if (!player || !player.roomId) return;
  
  const chatMessage = {
    type: 'chat',
    sessionId: sessionId,
    characterName: player.characterName,
    message: message.message,
    timestamp: Date.now()
  };
  
  console.log(`[Chat] ${player.characterName}: ${message.message}`);
  
  // Broadcast to room (including sender)
  broadcastToRoomAll(player.roomId, chatMessage);
}

// Action handler (for future use - combat, emotes, etc.)
function handleAction(sessionId, message) {
  const player = players.get(sessionId);
  if (!player || !player.roomId) return;
  
  broadcastToRoom(player.roomId, sessionId, {
    type: 'action',
    sessionId: sessionId,
    action: message.action,
    data: message.data
  });
}

// Disconnect handler
function handleDisconnect(sessionId) {
  const player = players.get(sessionId);
  if (!player) return;
  
  console.log(`[Disconnect] ${player.characterName || sessionId} disconnected`);
  
  // Notify room
  if (player.roomId) {
    broadcastToRoom(player.roomId, sessionId, {
      type: 'player_left',
      sessionId: sessionId
    });
    
    // Remove from room
    const room = rooms.get(player.roomId);
    if (room) {
      room.delete(sessionId);
      if (room.size === 0) {
        rooms.delete(player.roomId);
        console.log(`[Room] ${player.roomId} is now empty and removed`);
      }
    }
  }
  
  // Remove player
  players.delete(sessionId);
}

// Heartbeat check
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('[Heartbeat] Terminating dead connection');
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// Clean up dead players
setInterval(() => {
  const now = Date.now();
  const timeout = 60000; // 60 seconds
  
  players.forEach((player, sessionId) => {
    if (now - player.lastHeartbeat > timeout) {
      console.log(`[Cleanup] Removing inactive player: ${sessionId}`);
      handleDisconnect(sessionId);
      if (player.ws) {
        player.ws.terminate();
      }
    }
  });
}, 30000); // Check every 30 seconds

// Utility: Generate session ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Server cleanup on exit
wss.on('close', () => {
  clearInterval(heartbeatInterval);
  console.log('[Server] WebSocket server closed');
});

// Start server
server.listen(PORT, () => {
  console.log(`[Server] ✓ Running on port ${PORT}`);
  console.log(`[Server] WebSocket: ws://localhost:${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  console.log('='.repeat(60));
});

// Handle process termination
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});
