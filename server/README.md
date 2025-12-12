# Heroes of Shady Grove - Multiplayer Server

WebSocket server for real-time multiplayer MMORPG gameplay.

## Features

- ✅ Real-time player position synchronization
- ✅ Room-based multiplayer (multiple game instances)
- ✅ Chat system
- ✅ Player join/leave notifications
- ✅ Automatic reconnection handling
- ✅ Heartbeat system (keep-alive)
- ✅ Health check endpoint

## Quick Start

### Local Testing

```bash
npm install
npm start
```

Server runs on: `http://localhost:8080`

Test: `http://localhost:8080/health`

### Deploy to Render.com (Free)

1. Push this folder to GitHub
2. Create Web Service on Render.com
3. Configure:
   - Build: `npm install`
   - Start: `npm start`
   - Instance: Free
4. Done! Get your URL: `wss://YOUR-APP.onrender.com`

See `../DEPLOY_TO_RENDER.md` for detailed instructions.

## API

### WebSocket Messages

**Client → Server:**
```javascript
// Join room
{
  type: 'join',
  roomId: 'default_room',
  characterName: 'PlayerName',
  characterId: 'char_123',
  level: 5,
  position: { x: 0, y: 5, z: 0 },
  rotation: 0
}

// Position update
{
  type: 'position',
  position: { x: 10, y: 5, z: 20 },
  rotation: 1.57
}

// Chat message
{
  type: 'chat',
  message: 'Hello world!'
}
```

**Server → Client:**
```javascript
// Welcome (on connect)
{
  type: 'welcome',
  sessionId: 'session_123',
  serverTime: 1234567890
}

// Room joined
{
  type: 'joined',
  roomId: 'default_room',
  playersOnline: 3
}

// Existing players
{
  type: 'players',
  players: [
    {
      sessionId: 'session_456',
      characterName: 'OtherPlayer',
      level: 10,
      position: { x: 5, y: 5, z: 5 },
      rotation: 0
    }
  ]
}

// Player joined
{
  type: 'player_joined',
  player: { sessionId, characterName, level, position, rotation }
}

// Player left
{
  type: 'player_left',
  sessionId: 'session_789'
}

// Position update
{
  type: 'position',
  sessionId: 'session_456',
  position: { x: 10, y: 5, z: 20 },
  rotation: 1.57
}

// Chat message
{
  type: 'chat',
  sessionId: 'session_456',
  characterName: 'PlayerName',
  message: 'Hello!',
  timestamp: 1234567890
}
```

### HTTP Endpoints

**GET /**
- Returns server info (HTML)
- Shows players online, rooms active

**GET /health**
- Health check endpoint (JSON)
- Returns: `{ status, players, rooms, uptime }`

## Configuration

Edit `index.js` to configure:

```javascript
const PORT = process.env.PORT || 8080;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const POSITION_UPDATE_RATE = 100; // 100ms
```

## Monitoring

View logs:
- Render.com: Dashboard → Your service → Logs
- Local: Terminal output

Check health:
- `https://YOUR-APP.onrender.com/health`

## Architecture

```
Client connects
    ↓
Server assigns sessionId
    ↓
Client sends 'join' with character info
    ↓
Server adds to room
    ↓
Server sends existing players
    ↓
Server broadcasts new player to others
    ↓
Client sends position updates (10/sec)
    ↓
Server broadcasts to room
    ↓
Other clients update player positions
```

## Room System

- Players join rooms (default: 'default_room')
- Only see players in same room
- Future: Zone-based rooms (zone_1, zone_2, etc.)
- Rooms auto-deleted when empty

## Performance

**Free Tier (Render.com):**
- 512 MB RAM
- Shared CPU
- ~20-30 concurrent players
- Sleeps after 15 min idle

**Paid Tier ($7/month):**
- 512 MB RAM
- Dedicated CPU
- Always-on (no sleep)
- 100+ concurrent players

## Development

**Test locally:**
```bash
npm start
```

**Update client URL:**
```javascript
// js/core.js
WS_URL: 'ws://localhost:8080'
```

**Watch logs:**
```
[Server] ✓ Running on port 8080
[Connect] New connection: session_123 from 127.0.0.1
[Join] PlayerName joined room: default_room
```

## Deployment

**Push updates:**
```bash
git add .
git commit -m "Update server"
git push
```

Render auto-deploys in 1-2 minutes.

## Troubleshooting

**Can't connect:**
- Check URL is correct (wss:// not ws://)
- Check server is running (Render dashboard)
- Check health endpoint

**Players can't see each other:**
- Check both in same room
- Check server logs for join messages
- Check positions being sent

**Server crashing:**
- Check logs for errors
- Check dependencies installed
- Check Node version (16+)

## License

MIT

## Support

See main repo README for support info.
