const { WebSocketServer } = require("ws");
const wss = new WebSocketServer({ port: 8080 });

let players = {};
let id = 0;

wss.on("connection", (ws) => {
  const playerId = id++;
  players[playerId] = { x: Math.random() * 4000, y: Math.random() * 4000, name: "Unknown" };

  ws.send(JSON.stringify({ type: "init", id: playerId }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (e) {
      return;
    }

    if (data.type === "join") {
      players[playerId].name = data.name;
    } else if (data.type === "move") {
      players[playerId].x = data.x;
      players[playerId].y = data.y;
    }
  });

  ws.on("close", () => {
    delete players[playerId];
  });
});

setInterval(() => {
  const state = JSON.stringify({ type: "state", players });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(state);
    }
  });
}, 1000 / 20);

