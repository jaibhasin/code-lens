/* eslint-disable @typescript-eslint/no-require-imports */
const { WebSocketServer } = require("ws");

const PORT = process.env.WS_PORT || 1234;
const wss = new WebSocketServer({ port: PORT });

const roomSockets = new Map();

function getRoom(roomId) {
  if (!roomSockets.has(roomId)) roomSockets.set(roomId, new Set());
  return roomSockets.get(roomId);
}

wss.on("connection", (ws) => {
  let roomId = null;
  let role = null;

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "join" && msg.roomId) {
        roomId = msg.roomId;
        role = msg.role || "candidate";
        const room = getRoom(roomId);
        room.add(ws);
        ws.roomId = roomId;
        ws.role = role;
        const broadcast = (payload) => {
          room.forEach((s) => {
            if (s !== ws && s.readyState === 1) s.send(JSON.stringify(payload));
          });
        };
        broadcast({ type: "participant_joined", role });
      } else if (roomId && msg.type === "broadcast") {
        const room = getRoom(roomId);
        room.forEach((s) => {
          if (s !== ws && s.readyState === 1) s.send(raw.toString());
        });
      }
    } catch {
      if (roomId) {
        const room = getRoom(roomId);
        room.forEach((s) => {
          if (s !== ws && s.readyState === 1) s.send(raw.toString());
        });
      }
    }
  });

  ws.on("close", () => {
    if (roomId) {
      const room = getRoom(roomId);
      room.delete(ws);
      if (room.size === 0) roomSockets.delete(roomId);
    }
  });
});

console.log(`WebSocket server on ws://localhost:${PORT}`);
