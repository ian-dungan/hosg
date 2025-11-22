// Heroes of Shady Grove Multiplayer Server v1.0.3
// Simple in-memory WebSocket server using `ws`
// Run with: node hosg_server_1.0.3.js

const WebSocket = require("ws");

const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || null;
let dbPool = null;

if (DATABASE_URL) {
  dbPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") || DATABASE_URL.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false }
  });
  initDatabase().catch((err) => {
    console.error("[DB] Failed to initialize database:", err.message);
  });
} else {
  console.warn("[DB] DATABASE_URL not set; running without server-side character persistence.");
}

async function initDatabase() {
  if (!dbPool) return;
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS hosg_characters (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("[DB] Database schema ready (hosg_characters).");
}

async function dbLoadCharacterByName(name) {
  if (!dbPool || !name) return null;
  const res = await dbPool.query(
    "SELECT data FROM hosg_characters WHERE name = $1 LIMIT 1",
    [name]
  );
  if (!res.rows.length) return null;
  return res.rows[0].data;
}

async function dbUpsertCharacterFromState(player) {
  if (!dbPool || !player || !player.name) return;
  const name = player.name.toString().substring(0, 64);
  const data = {
    name: player.name,
    role: player.role || null,
    appearance: player.appearance || null,
    stats: player.stats || null,
    position: player.position || null,
    rotationY: typeof player.rotationY === "number" ? player.rotationY : 0
  };
  await dbPool.query(
    `INSERT INTO hosg_characters(name, data)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (name)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [name, data]
  );
}

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let nextId = 1;
const clients = new Map(); // ws -> { id, state }

function broadcast(obj, exceptWs = null) {
  const data = JSON.stringify(obj);
  for (const [ws] of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (exceptWs && ws === exceptWs) continue;
    ws.send(data);
  }
}

wss.on("connection", (ws) => {
  const id = nextId++;
  clients.set(ws, { id, state: null });

  console.log("[MP] Client connected:", id);

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    if (!msg || !msg.type) return;

    const client = clients.get(ws);
    if (!client) return;

    switch (msg.type) {
      case "hello": {
        const incoming = msg.player || {};
        let resolved = incoming;

        if (dbPool && incoming && incoming.name) {
          try {
            const stored = await dbLoadCharacterByName(incoming.name);
            if (stored && typeof stored === "object") {
              resolved = Object.assign({}, incoming, stored);
            } else {
              await dbUpsertCharacterFromState(incoming);
            }
          } catch (err) {
            console.warn("[DB] hello handler error:", err.message);
          }
        }

        client.state = resolved;

        // Send welcome snapshot back to this client
        const snapshot = [];
        for (const [otherWs, c] of clients) {
          if (!c.state) continue;
          snapshot.push({ id: c.id, player: c.state });
        }
        ws.send(JSON.stringify({ type: "welcome", id: client.id, players: snapshot }));

        // Notify everyone else that this player joined
        broadcast(
          { type: "playerJoined", id: client.id, player: client.state },
          ws
        );
        break;
      }
      case "state": {
        // Update this client's state and broadcast to others
        client.state = msg.player || client.state;
        broadcast(
          { type: "state", id: client.id, player: client.state },
          ws
        );

        if (dbPool && client.state && client.state.name) {
          dbUpsertCharacterFromState(client.state).catch((err) => {
            console.warn("[DB] state upsert error:", err.message);
          });
        }
        break;
      }
      case "chat": {
        const text = (msg.text || "").toString().substring(0, 200);
        if (!text) return;
        const fromName =
          (client.state && client.state.name) ? client.state.name : "Hero";
        broadcast({
          type: "chat",
          from: fromName,
          text
        });
        break;
      }
      default:
        break;
    }
  });

  ws.on("close", () => {
    const client = clients.get(ws);
    if (!client) return;
    console.log("[MP] Client disconnected:", client.id);
    clients.delete(ws);
    broadcast({ type: "playerLeft", id: client.id });
  });

  ws.on("error", (err) => {
    console.warn("[MP] Socket error:", err.message);
  });
});

wss.on("listening", () => {
  console.log(`[MP] Heroes of Shady Grove server listening on ws://localhost:${PORT}`);
});
