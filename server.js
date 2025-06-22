const WebSocket = require('ws');
const server = new WebSocket.Server({ port: process.env.PORT || 8080 });

let players = {};
let nextId = 1;

server.on('connection', (socket) => {
  let id;

  socket.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'join') {
        id = nextId++;
        players[id] = { id, username: data.username, x: 0, y: 0 };
        socket.send(JSON.stringify({ type: 'init', id }));
      } else if (data.type === 'move' && players[id]) {
        players[id].x = data.x;
        players[id].y = data.y;
      }
    } catch (err) {
      console.error('Error parsing message:', err);
    }
  });

  socket.on('close', () => {
    delete players[id];
  });
});

setInterval(() => {
  const snapshot = JSON.stringify({ type: 'state', players });
  for (const client of server.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(snapshot);
    }
  }
}, 50);
