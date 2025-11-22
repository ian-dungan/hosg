// Heroes of Shady Grove Multiplayer Server v1.0.3
// Simple in-memory WebSocket server using `ws`
// Run with: node hosg_server_1.0.3.js

const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let nextId = 1;
const clients = new Map(); // ws -> { id, state, accountId, characterId }

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
  clients.set(ws, { id, state: null, accountId: null, characterId: null });

  console.log("[MP] Client connected:", id);

  ws.on("message", (data) => {
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
        const player = msg.player || {};
        const accountId = player.accountId || null;
        const characterId = player.characterId || null;

        // Enforce single active connection per hero (by characterId), falling back to (accountId + name)
        if (characterId || accountId) {
          for (const [otherWs, otherClient] of clients) {
            if (otherWs === ws) continue;
            if (!otherClient) continue;

            const sameCharacter = characterId && otherClient.characterId === characterId;
            const sameAccountAndName =
              !sameCharacter &&
              accountId &&
              otherClient.accountId === accountId &&
              otherClient.state &&
              otherClient.state.name &&
              player.name &&
              otherClient.state.name === player.name;

            if (sameCharacter || sameAccountAndName) {
              console.log("[MP] Duplicate login for hero:", player.name || characterId, "kicking old client", otherClient.id);
              try {
                otherWs.close(4001, "Another login for this hero was started.");
              } catch (e) {
                console.warn("[MP] Failed to close old client socket:", e.message);
              }
            }
          }
        }

        client.state = player;
        client.accountId = accountId;
        client.characterId = characterId;

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

  ws.on("close", (code, reason) => {
    const client = clients.get(ws);
    if (!client) return;
    console.log("[MP] Client disconnected:", client.id, "code=", code, "reason=", reason && reason.toString());
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
