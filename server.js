const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 8080 });

let players = {};
let id = 0;

wss.on("connection", (ws) => {
  const pid = id++;
  players[pid] = {
    x: Math.random() * 4000,
    y: Math.random() * 4000,
    name: "Unknown"
  };

  ws.send(JSON.stringify({ type: "init", id: pid }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      return;
    }

    if (data.type === "join") {
      players[pid].name = data.name;
    } else if (data.type === "move") {
      players[pid].x = data.x;
      players[pid].y = data.y;
    }
  });

  ws.on("close", () => {
    delete players[pid];
  });
});

setInterval(() => {
  const state = JSON.stringify({ type: "state", players });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(state);
    }
  }
}, 50);


